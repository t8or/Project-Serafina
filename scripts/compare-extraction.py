"""Compare complete native evidence, scoring facts, and ordered tables across capture settings."""
import collections
import json
from pathlib import Path
import sys

def load(folder):
    if Path(folder).is_file():
        return json.loads(Path(folder).read_text())
    summary=json.loads((Path(folder)/'benchmark.json').read_text())
    return json.loads(Path(summary['result']['evidence_file']).read_text())
a,b=map(load,sys.argv[1:3])
def table_key(t):
    return (t['page_number'],json.dumps([t['original_headers'],t['cells']],ensure_ascii=False,sort_keys=True))
a_tables=collections.Counter(table_key(t) for t in a['tables'])
b_tables=collections.Counter(table_key(t) for t in b['tables'])
removed=a_tables-b_tables;added=b_tables-a_tables
result={'pages':[len(a['pages']),len(b['pages'])], 'tables':[len(a['tables']),len(b['tables'])],
 'native_text_identical':[p['native_text'] for p in a['pages']]==[p['native_text'] for p in b['pages']],
 'layout_text_identical':[p.get('layout_text') for p in a['pages']]==[p.get('layout_text') for p in b['pages']],
 'text_provenance_identical':[p.get('text_items') for p in a['pages']]==[p.get('text_items') for p in b['pages']],
 'scoring_facts_identical':a['scoring']==b['scoring'],
 'coverage':[a['coverage'],b['coverage']],
 'changed_tables':{'removed':sum(removed.values()),'added':sum(added.values()),'pages':sorted(set(k[0] for k in removed)|set(k[0] for k in added))},
 'details':{'removed':[{'page':p,'data':json.loads(data)} for p,data in removed],'added':[{'page':p,'data':json.loads(data)} for p,data in added]}}
print(json.dumps(result,indent=2))
if not result['native_text_identical'] or not result['scoring_facts_identical'] or len(a['pages'])!=len(b['pages']) or b['coverage']['status']!='complete':sys.exit(1)
# Raw differences require inspection; equality provides a strict regression gate when requested.
if '--exact-tables' in sys.argv and (removed or added):sys.exit(2)
if '--exact-layout' in sys.argv and not (result['layout_text_identical'] and result['text_provenance_identical']):sys.exit(3)

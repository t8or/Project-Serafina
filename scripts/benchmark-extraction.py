"""Cold extraction timing harness; isolates outputs and records evidence for comparison."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('pdf',type=Path)
parser.add_argument('output',type=Path)
parser.add_argument('--batch-pages',type=int,default=8)
parser.add_argument('--stage-batch',type=int,default=4)
parser.add_argument('--ocr-engine',choices=['easyocr','ocrmac'],default='easyocr')
parser.add_argument('--table-mode',choices=['accurate','fast'],default='accurate')
args=parser.parse_args()
if args.output.exists():raise SystemExit('Use a new output directory for a cold benchmark')
started=time.perf_counter()
from src.services.processors.docling_full_processor import DoclingFullProcessor
from docling.datamodel.base_models import InputFormat
imported=time.perf_counter()
processor=DoclingFullProcessor(max_pages=args.batch_pages,table_mode=args.table_mode,ocr_engine=args.ocr_engine)
processor.converter.format_to_options[InputFormat.PDF].pipeline_options.layout_batch_size=args.stage_batch
processor.converter.format_to_options[InputFormat.PDF].pipeline_options.table_batch_size=args.stage_batch
processor.converter.format_to_options[InputFormat.PDF].pipeline_options.ocr_batch_size=args.stage_batch
from docling.datamodel.settings import settings
settings.debug.profile_pipeline_timings=True
batch_profiles=[]
convert=processor.converter.convert
def profiled_convert(*a,**kw):
    result=convert(*a,**kw)
    batch_profiles.append({'pages':kw.get('page_range'),'timings':{k:v.model_dump(mode='json') for k,v in result.timings.items()}})
    return result
processor.converter.convert=profiled_convert
configured=time.perf_counter()
result=processor.process(str(args.pdf.resolve()),str(args.output.resolve()))
finished=time.perf_counter()
summary={'source':str(args.pdf.resolve()),'batch_pages':args.batch_pages,'stage_batch':args.stage_batch,'table_mode':args.table_mode,'ocr_engine':args.ocr_engine,'batch_profiles':batch_profiles,
 'seconds':{'imports':imported-started,'configure':configured-imported,'process':finished-configured,'total':finished-started},'result':result}
(args.output/'benchmark.json').write_text(json.dumps(summary,indent=2))
print(json.dumps({'seconds':summary['seconds'],'coverage':result['coverage'],'evidence':result['evidence_file']}))

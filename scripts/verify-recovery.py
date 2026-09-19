"""Opt-in real Docling interruption/resume check. Uses a temporary 24-page fixture."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import pypdfium2 as pdfium

root=Path(__file__).resolve().parents[1]
work=Path(tempfile.mkdtemp(prefix='serafina-recovery-'))
source=pdfium.PdfDocument(root/'Hawks Landing CoStar.pdf')
fixture=pdfium.PdfDocument.new()
fixture.import_pages(source,list(range(24)))
fixture.save(work/'fixture.pdf');fixture.close();source.close()
command=[sys.executable,str(root/'src/services/processors/docling_full_processor.py'),str(work/'fixture.pdf'),str(work/'output'),'8']
env={**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'}
log=(work/'interrupted.log').open('w')
process=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=log,env=env)
interrupted=False
try:
    deadline=time.monotonic()+180
    while process.poll() is None and time.monotonic()<deadline:
        reports=list((work/'output').glob('*_report.json')) if (work/'output').exists() else []
        if reports:
            evidence=json.loads(reports[0].read_text())
            if evidence['coverage'].get('layout_pages',0)>=8:
                process.terminate();process.wait(timeout=10);interrupted=True;break
        time.sleep(.25)
finally:
    if process.poll() is None:process.kill();process.wait()
    log.close()
assert interrupted,'Did not reach the intended interruption point'
checkpoint=next((work/'output'/'.checkpoints').rglob('1-8.json'))
mtime=checkpoint.stat().st_mtime_ns
with (work/'resumed.log').open('w') as resumed_log:
    result=subprocess.run(command,env=env,stdout=subprocess.PIPE,stderr=resumed_log,text=True,timeout=300,check=True)
report=json.loads(result.stdout)
assert report['coverage']['layout_pages']==24,report
assert report['coverage']['status']=='complete',report
assert checkpoint.stat().st_mtime_ns==mtime,'Completed batch was unnecessarily recomputed'
assert 'Reusing verified checkpoint 1-8' in (work/'resumed.log').read_text()
print(json.dumps({'work':str(work),'interrupted_after_pages':8,'resumed_pages':24,'checkpoint_reused':True}))

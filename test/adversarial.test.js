import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'serafina-adversarial-'));
process.env.SERAFINA_DATA_DIR = root;
const {db, initDb} = await import('../src/config/database.js');
const {ScoringService} = await import('../src/services/scoring_service.js');
const {parseNumericValue, findTableValue} = await import('../src/services/costar_extract.js');
const {assemblePropertyData} = await import('../src/services/property_data_assembler.js');
const {validateAnswer, searchEvidence, tablesCsv} = await import('../src/services/report_library.js');
const {ExtractionJobs} = await import('../src/services/extraction_jobs.js');
const {FileUploadService} = await import('../src/services/fileUploadService.js');
await initDb();
after(async()=>{db.close();await fs.rm(root,{recursive:true,force:true})});

test('unexpected numeric formats cannot change signs, lose zero, or create plausible garbage',()=>{
  for (const [input,expected] of [[0,0],['−3.5%',-.035],['(3.5)%',-.035],['(3.5%)',-.035],['$1,234',1234],['—',null],['1,23',null],['12abc',null],[true,null],[Infinity,null]]) assert.equal(parseNumericValue(input),expected,String(input));
});
test('missing radius never substitutes the neighboring geography',()=>{
  assert.equal(findTableValue([{rows:[{label:'Income','1 Mile':'$40,000','5 Mile':'$60,000'}]}],'Income','3 Mile'),null);
  assert.equal(findTableValue([{rows:[{label:'Income','13 Mile':'$40,000'}]}],'Income','3 Mile'),null);
});
test('missing, nonfinite, blank, and boolean score inputs cannot publish rejection',()=>{
  const s=new ScoringService();
  for(const value of [null,undefined,'',false,NaN,Infinity]){
    const data={};for(const f of Object.values(s.config.factors)){const keys=f.dataPath.split('.');let o=data;for(const key of keys.slice(0,-1))o=o[key]??={};o[keys.at(-1)]=value}
    const r=s.calculateScore(data);assert.equal(r.score,null);assert.equal(r.decision,'Insufficient data');assert.equal(r.eligible,false);
  }
  assert.equal(s.getSummaryStatistics([s.calculateScore({})]).dontMove,0);
});
test('conflicted native evidence cannot reappear through reference or Docling fallback',()=>{
  const r=assemblePropertyData({demographics:{scoring_metrics:{population_3mile:500},scoring_conflicts:{population_3mile:[{value:500},{value:600}]}}},{},{demographics:{population_3mile:900}});
  assert.equal(r.demographics.population_3mile,undefined);
});
test('SQLite repeated and out-of-order parameters retain their meaning; failed publication rolls back',async()=>{
  assert.deepEqual((await db.query('SELECT $2 AS a, $1 AS b, $2 AS c',['first','second'])).rows[0],{a:'second',b:'first',c:'second'});
  assert.throws(()=>db.transaction(c=>{c.query("INSERT INTO files(filename,original_filename,file_type,file_size,storage_path) VALUES ('x','x','pdf',1,'x')");throw Error('crash')}),/crash/);
  assert.equal((await db.query('SELECT * FROM files')).rows.length,0);
  assert.throws(()=>db.transaction(async()=>{}),/synchronous/);
});
test('concurrent duplicate extraction requests invoke the processor once and retain failure status',async()=>{
  const row=(await db.query("INSERT INTO files(filename,original_filename,file_type,file_size,storage_path) VALUES ('x','x','pdf',1,'x') RETURNING *")).rows[0];
  let calls=0;let finish;const gate=new Promise(resolve=>finish=resolve);
  const jobs=new ExtractionJobs({async run(){calls++;await gate;throw Error('malformed PDF')}});
  const [a,b]=await Promise.all([jobs.start(row.id),jobs.start(row.id)]);assert.equal(a.id,b.id);finish();await jobs.tail;
  assert.equal(calls,1);assert.equal((await jobs.get(a.id)).status,'failed');
});
test('fake PDF MIME cannot write non-PDF content',async()=>{
  const upload=new FileUploadService();await assert.rejects(()=>upload.uploadFile({mimetype:'application/pdf',buffer:Buffer.from('<script>'),originalname:'report.pdf'}),/not a PDF/);
});
test('question answer refuses fabricated quotations and page identities',()=>{
  const passages=[{id:'p96',page:96,text:'Median Household Income $80,544'}];
  assert.throws(()=>validateAnswer({answer:'$99,999',citations:[{id:'p96',quote:'$99,999'}]},passages),/not in/);
  assert.throws(()=>validateAnswer({answer:'$80,544',citations:[{id:'p1',quote:'$80,544'}]},passages),/not in/);
  assert.throws(()=>validateAnswer({answer:'It is $80,544',citations:[]},passages),/no supporting/);
  assert.equal(validateAnswer({answer:'$80,544',citations:[{id:'p96',quote:'$80,544'}]},passages).citations[0].page,96);
});
test('unknown appendix fields and repeated table headings survive reusable exports',()=>{
  const report={source_sha256:'hash',pages:[{page_number:150,native_text:'Alien metric: 423',section:'unknown'}],tables:[{table_id:'t1',page_number:150,original_headers:['Value','Value'],cells:[['=HYPERLINK("bad")',423]]}]};
  assert.equal(searchEvidence(report,'alien metric')[0].page,150);
  const csv=tablesCsv(report);assert.match(csv,/'=HYPERLINK/);assert.match(csv,/'?423/);assert.equal(csv.split('\r\n').length,3);
});

test('live-discovered model column error is prevented by header-bound table answers', async()=>{
  const {answerRadiusQuestion}=await import('../src/services/report_library.js');
  const report={tables:[{table_id:'income',page_number:79,original_headers:['Population','1 Mile','3 Mile','5 Mile'],cells:[['Median Household Income','$50,132','$53,216','$51,062'],['2023 Population','6,349','41,435','71,231'],['2028 Population','6,588','42,440','72,514']]}]};
  assert.match(answerRadiusQuestion(report,'What is the 3-mile median household income?').answer,/53,216/);
  assert.doesNotMatch(answerRadiusQuestion(report,'What is the 3-mile median household income?').answer,/51,062/);
  assert.match(answerRadiusQuestion(report,'3 mile population in 2028').answer,/42,440/);
  assert.equal(answerRadiusQuestion(report,'7 mile median household income').status,'insufficient_evidence');
});

test('one data directory cannot have two runtime writers',async()=>{
  const {acquireRuntimeLock}=await import('../src/services/runtime_lock.js');
  const release=await acquireRuntimeLock(root);
  await assert.rejects(()=>acquireRuntimeLock(root),/already uses/);
  await release();const again=await acquireRuntimeLock(root);await again();
});

test('a rescore started against an old revision cannot overwrite newer accepted evidence',async()=>{
  const {PropertyService}=await import('../src/services/property_service.js');
  const properties=new PropertyService();const property=await properties.createProperty({name:'Revision race'});
  const file=(await db.query("INSERT INTO files(filename,original_filename,file_type,file_size,storage_path) VALUES ('revision.pdf','revision.pdf','application/pdf',1,'revision.pdf') RETURNING *")).rows[0];
  const first=(await db.query("INSERT INTO report_revisions(file_id,property_id,source_sha256,evidence_path,coverage_json) VALUES ($1,$2,'a','first.json','{}') RETURNING *",[file.id,property.id])).rows[0];
  await db.query("INSERT INTO report_revisions(file_id,property_id,source_sha256,evidence_path,coverage_json) VALUES ($1,$2,'b','second.json','{}')",[file.id,property.id]);
  await assert.rejects(()=>properties.saveScore(property.id,{score:9,decision:'Move Forward',decisionColor:'green',breakdown:{}},{reportRevisionId:first.id}),/revision changed/);
  assert.equal((await db.query('SELECT * FROM scores WHERE property_id=$1',[property.id])).rows.length,0);
});

test('file deletion cannot remove a retained source before SQLite rejects its references',async()=>{
  const express=(await import('express')).default;
  const router=(await import('../src/api/filesHandler.js')).default;
  const app=express();app.use('/',router);const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try {
    const upload=new FileUploadService();const source=Buffer.from('%PDF-1.7 protected fixture');
    const file=await upload.uploadFile({mimetype:'application/pdf',buffer:source,size:source.length,originalname:'protected.pdf'});
    await db.query("INSERT INTO report_revisions(file_id,source_sha256,evidence_path,coverage_json) VALUES ($1,'protected','extracted/protected_report.json','{}')",[file.id]);
    const response=await fetch(`http://127.0.0.1:${server.address().port}/${file.id}`,{method:'DELETE'});
    assert.equal(response.status,409);
    assert.deepEqual(await fs.readFile(await upload.getFilePath(file.id)),source);
    assert.ok((await db.query('SELECT id FROM files WHERE id=$1',[file.id])).rows.length);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('permanent property deletion removes its revision artifacts but preserves shared source evidence',async()=>{
  const {PropertyService}=await import('../src/services/property_service.js');
  const {UPLOADS_DIR,EXTRACTED_DIR}=await import('../src/config/runtime_paths.js');
  const properties=new PropertyService();const one=await properties.createProperty({name:'Remove'});const two=await properties.createProperty({name:'Retain'});
  const upload=new FileUploadService();const source=Buffer.from('%PDF-1.7 shared fixture');
  const file=await upload.uploadFile({mimetype:'application/pdf',buffer:source,size:source.length,originalname:'shared.pdf'});
  const hash='a'.repeat(64);const cache=path.join(EXTRACTED_DIR,'.checkpoints',hash);await fs.mkdir(cache,{recursive:true});await fs.writeFile(path.join(cache,'batch.json'),'{}');
  for(const property of [one,two]){
    await properties.linkDocument(property.id,{filename:file.filename,originalFilename:file.original_filename,fileType:file.file_type,fileSize:file.file_size,storagePath:file.storage_path});
    const evidence=`extracted/delete-${property.id}.json`;await fs.writeFile(path.join(UPLOADS_DIR,evidence),'{}');
    await db.query('INSERT INTO report_revisions(file_id,property_id,source_sha256,evidence_path,coverage_json) VALUES ($1,$2,$3,$4,$5)',[file.id,property.id,hash,evidence,'{}']);
  }
  await properties.permanentDelete(one.id);
  assert.equal((await db.query('SELECT id FROM report_revisions WHERE property_id=$1',[one.id])).rows.length,0);
  await assert.rejects(()=>fs.access(path.join(EXTRACTED_DIR,`delete-${one.id}.json`)));
  await fs.access(path.join(UPLOADS_DIR,file.storage_path));await fs.access(cache);
  await properties.permanentDelete(two.id);
  await assert.rejects(()=>fs.access(path.join(UPLOADS_DIR,file.storage_path)));
  await assert.rejects(()=>fs.access(cache));
});

test('merged cover identity and five-digit street numbers cannot corrupt geographic facts',async()=>{
  const {AddressExtractor}=await import('../src/services/address_extractor.js');const extract=new AddressExtractor();
  const hawks=extract.extractFromSubjectProperty({pages:[{headers:[{text:'2778 2nd St NE'}],text_items:[{text:'Hawks Landing Luxury Apartments 144 Unit Apartment Building Hickory, North Carolina - Outer City Of Hickory Neighborhood'}]}]});
  assert.equal(hawks.city,'Hickory');assert.equal(hawks.stateAbbr,'NC');assert.equal(hawks.propertyName,'Hawks Landing Luxury Apartments');
  const serafina=extract.extractFromSubjectProperty({pages:[{headers:[{text:'11025 S 51st St - Serafina'}],text_items:[{text:'Henry Metcalf, MRED'},{text:'Phoenix, Arizona - Ahwatukee Neighborhood'}]}],tables:[{rows:[{Population:'85044'}]}]});
  assert.equal(serafina.city,'Phoenix');assert.equal(serafina.zipCode,null);
  assert.equal(extract.extractFromSubjectProperty({raw_text:'11025 S 51st St\nPhoenix, AZ 85044'}).zipCode,'85044');
  assert.equal(extract.extractFromSubjectProperty({raw_text:'Henry Metcalf, MRED'}).stateAbbr,null);
  assert.equal(extract.extractFromAllSections({demographics:{raw_text:'Other City, Texas'}}).city,null);
});

test('impossible domain values and percent-unit mistakes cannot become business scores',()=>{
  const service=new ScoringService();
  for(const [factor,value] of [['population',-1],['submarketVacancy',9.7],['renterHouseholdsPercent',75],['schoolRatings',100],['walkScore',101],['violentCrimeRate',-10]]){
    const config=service.config.factors[factor];const data={};const keys=config.dataPath.split('.');let obj=data;
    for(const key of keys.slice(0,-1))obj=obj[key]??={};obj[keys.at(-1)]=value;
    const result=service.calculateScore(data);assert.equal(result.breakdown[factor].rawValue,null);assert.equal(result.score,null);
  }
  const decline=service.calculateScore({demographics:{population_growth_3mile:-.04}});
  assert.equal(decline.breakdown.populationGrowth.rawValue,-.04);
});

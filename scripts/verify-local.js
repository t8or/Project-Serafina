/** Explicit live validation against a running isolated fixture workspace. Never runs under npm test. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {LOCAL_PYTHON_PATH} from '../src/config/runtime_paths.js';
import {spawnSync} from 'node:child_process';
const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
async function json(route, body) {
  const response = await fetch(origin + route, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : undefined);
  const data = await response.json();
  assert.ok(response.ok, `${route}: ${JSON.stringify(data)}`);
  return data;
}
const reports = (await json('/api/reports')).reports;
const properties = (await json('/api/scoring/properties')).properties;
for (const [name, city, state] of [['Hawks Landing Luxury Apartments','Hickory','NC'],['Serafina','Phoenix','AZ']]) {
  const property=properties.find(p=>p.propertyName===name);assert.ok(property);
  assert.equal(property.address.city,city);assert.equal(property.address.stateAbbr,state);
  assert.equal(property.address.zipCode,null,'Unsupported ZIP must not be derived from another number');
}
const verification = {timestamp:new Date().toISOString(), origin, reports:[]};
for (const [name, pages, income] of [['Hawks Landing CoStar.pdf',127,'53,216'],['Serafina CoStart Report.pdf',152,'80,544']]) {
  const revision = reports.find(report => report.original_filename === name);
  assert.ok(revision, `Extract ${name} first`);
  const report = await json(`/api/reports/${revision.id}/export`);
  assert.equal(report.pages.length,pages);
  assert.equal(report.coverage.layout_pages,pages);
  assert.equal(report.coverage.status,'complete');
  assert.equal(new Set(report.pages.map(p=>p.page_number)).size,pages);
  assert.ok(report.tables.every(t=>Array.isArray(t.cells)&&Array.isArray(t.structure.table_cells)));
  assert.ok(report.pages.some(p=>p.section==='demographics'));
  const original = Buffer.from(await fetch(origin+`/api/files/${revision.file_id}/download`).then(r=>r.arrayBuffer()));
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'),report.source_sha256);
  const answer = await json(`/api/reports/${revision.id}/ask`,{question:'What is the 3-mile median household income?'});
  assert.equal(answer.status,'table_lookup');assert.ok(answer.answer.includes(income),answer.answer);
  const workbook = await json('/api/fill/template',{templatePath:'Serafina UW Phoenix AZ Feb 14 2025.xlsx',fileId:revision.file_id});
  assert.equal(workbook.readiness,'draft');assert.equal(workbook.summary.errors,0);assert.ok(workbook.summary.filled>10);
  const propertyWorkbook = await json('/api/fill/template',{templatePath:'Serafina UW Phoenix AZ Feb 14 2025.xlsx',propertyId:revision.property_id});
  assert.equal(propertyWorkbook.dataSource,'report_revision');assert.equal(propertyWorkbook.summary.errors,0);
  verification.reports.push({name,revisionId:revision.id,pages,tables:report.tables.length,answer:answer.answer,workbook,propertyWorkbook});
}
const scanned = reports.find(report=>report.original_filename==='scanned-unfamiliar-report.pdf');
assert.ok(scanned,'Extract the synthetic scanned fixture before live validation');
if(scanned){
 const report=await json(`/api/reports/${scanned.id}/export`);
 assert.equal(report.coverage.native_text_pages,0);assert.equal(report.coverage.layout_pages,2);
 const search=await json(`/api/reports/${scanned.id}/search?q=solar`);
 assert.ok(search.passages.some(p=>p.text.includes('317')));
 const answer=await json(`/api/reports/${scanned.id}/ask`,{question:'What solar capacity is stated in the report? Quote the source.'});
 assert.ok(answer.answer.includes('317'),JSON.stringify(answer));assert.ok(answer.citations.length>0);
 verification.scanned={revisionId:scanned.id,answer};
}
const aggregation = await json('/api/scoring/aggregate?groupBy=city');
assert.equal(aggregation.summary.rejected,0);
assert.ok(aggregation.groups.every(group => group.rejected===0));
const foreign = await fetch(origin+'/api/scoring/calculate',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'});
assert.equal(foreign.status,403);
const score=await json('/api/scoring/calculate',{propertyData:{}});assert.equal(score.decision,'Insufficient data');assert.equal(score.score,null);
await fs.writeFile('/tmp/serafina-live-validation.json',JSON.stringify(verification,null,2));
const checked = spawnSync(LOCAL_PYTHON_PATH, ['scripts/verify-workbooks.py', '/tmp/serafina-live-validation.json'], {stdio:'inherit'});
assert.equal(checked.status, 0, 'Artifact facts failed independent verification');
console.log(JSON.stringify(verification,null,2));

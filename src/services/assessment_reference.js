import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {db} from '../config/database.js';
import {resolveUploadPath} from '../config/runtime_paths.js';
import {LocalReferenceData, normalizeReferenceAddress} from './local_reference_data.js';
import {assemblePropertyData, ensureScoringConfigLoaded, getScoringService} from './property_data_assembler.js';
import {PropertyService} from './property_service.js';

export const REFERENCE_FIELDS = {
  renterHouseholdsPercent: {path:['demographics','renter_households_pct_3mile'], min:0, max:100, divisor:100, scope:'3_mile'},
  violentCrimeRate: {path:['crime','violent_crime_index'], min:1, max:100, scope:'zip_code'},
  propertyCrimeRate: {path:['crime','property_crime_index'], min:1, max:100, scope:'zip_code'},
  schoolRatings: {path:['schools','average_rating'], min:1, max:10, scope:'assigned_schools'},
  walkScore: {path:['walkScore','walk_score'], min:0, max:100, scope:'property'},
  transitScore: {path:['walkScore','transit_score'], min:0, max:100, scope:'property'},
};
const refs = new LocalReferenceData();
export function validateObservations(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Reference inputs are required.');
  const output = {};
  for (const [key, observation] of Object.entries(input)) {
    const field = REFERENCE_FIELDS[key];
    if (!field) throw new Error('Unknown assessment input.');
    if (observation === null) {output[key] = null; continue;}
    const {value, sourceUrl, observedAt, scope, notes = ''} = observation;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) throw new Error(`${key} must be between ${field.min} and ${field.max}.`);
    let url; try {url = new URL(sourceUrl);} catch {throw new Error(`${key} needs a source URL.`);}
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public http or https source URL.');
    if (scope !== field.scope) throw new Error(`${key} requires ${field.scope} geography.`);
    if (typeof observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now()+86400000) throw new Error('Enter the date the source was checked.');
    if (typeof notes !== 'string' || notes.length > 2000) throw new Error('Source notes must be at most 2,000 characters.');
    if ((key === 'violentCrimeRate' || key === 'propertyCrimeRate') && (!/(^|\.)bestplaces\.net$/.test(url.hostname) || !/^\/crime\/zip-code\/[^/]+\/[^/]+\/\d{5}\/?$/.test(url.pathname))) throw new Error('Use the BestPlaces ZIP-code crime page (1–100 index). City figures and rates per population use different geography or scales.');
    output[key] = {value,sourceUrl:url.href,observedAt,scope,notes,method:observation.method === 'public_listing' ? 'public_listing' : 'manual', ...(typeof observation.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(observation.sourceHash) ? {sourceHash:observation.sourceHash} : {})};
  }
  return output;
}
export function applyObservations(data, observations) {
  const next = structuredClone(data || {});
  next.observations ||= {};
  for (const [key, observation] of Object.entries(observations)) {
    const field = REFERENCE_FIELDS[key]; const [group, prop] = field.path;
    next[group] ||= {};
    if (observation === null) { delete next[group][prop]; delete next.observations[key]; }
    else { next[group][prop] = observation.value/(field.divisor || 1); next.observations[key] = observation; }
  }
  return next;
}
export async function loadPropertyAssessment(id) {
  const property = (await db.query('SELECT * FROM properties WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
  if (!property) throw new Error('Property not found.');
  const address = {street:property.address_street, city:property.address_city, stateAbbr:property.address_state_abbr, zipCode:property.address_zip};
  const revision = (await db.query('SELECT * FROM report_revisions WHERE property_id=$1 ORDER BY id DESC LIMIT 1',[id])).rows[0];
  const sections = {};
  if (revision) {
    const report = JSON.parse(await fs.readFile(resolveUploadPath(revision.evidence_path),'utf8'));
    if (report.source_sha256 !== revision.source_sha256) throw new Error('Report source identity mismatch.');
    for (const filename of report.section_files) {
      const section = JSON.parse(await fs.readFile(resolveUploadPath(path.join('extracted',path.basename(filename))),'utf8'));
      sections[section.section] = section;
    }
  } else {
    const files = (await db.query('SELECT * FROM extracted_files WHERE property_id=$1 AND deleted_at IS NULL AND superseded=0 ORDER BY id',[id])).rows;
    for (const file of files) sections[file.section_type] = JSON.parse(await fs.readFile(resolveUploadPath(file.storage_path),'utf8'));
  }
  const reference = await refs.lookup(address);
  const projection = assemblePropertyData(sections,address,reference.available ? reference.data : undefined);
  projection.referenceSnapshotId = reference.provenance?.snapshotId ?? null;
  if (revision) {projection.reportRevisionId = revision.id; projection.coverage = JSON.parse(revision.coverage_json);}
  return {property,address,revision,sections,reference,projection};
}
export async function recalculateProperty(id) {
  await ensureScoringConfigLoaded();
  const context = await loadPropertyAssessment(id);
  const service = getScoringService();
  const result = service.calculateScore(context.projection);
  await new PropertyService().saveScore(id,result,context.projection,service.getConfig());
  return result;
}
export async function saveReferenceInputs(id, input, expectedSnapshotId, expectedRevisionId) {
  const observations = validateObservations(input);
  await ensureScoringConfigLoaded();
  const context = await loadPropertyAssessment(id);
  if (!context.address.street || !context.address.city || !context.address.stateAbbr) throw new Error('Add a complete property address before saving reference inputs.');
  const currentId = context.reference.provenance?.snapshotId ?? null;
  if (currentId !== expectedSnapshotId || (context.revision?.id ?? null) !== expectedRevisionId) throw new Error('This assessment changed. Reload before saving.');
  const data = applyObservations(context.reference.data,observations);
  const asOf = new Date().toISOString();
  const records = [{address:context.address,...data}];
  const snapshot = {source:'Public website lookup',asOf,records};
  const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const projection = assemblePropertyData(context.sections,context.address,data);
  if (context.revision) {projection.reportRevisionId = context.revision.id; projection.coverage = JSON.parse(context.revision.coverage_json);}
  const service = getScoringService(); const score = service.calculateScore(projection);
  return db.transaction(client => {
    const latest = client.query('SELECT id FROM report_revisions WHERE property_id=$1 ORDER BY id DESC LIMIT 1',[id]).rows[0];
    if ((latest?.id ?? null) !== expectedRevisionId) throw new Error('The report changed. Reload before saving.');
    // Recheck the reference version inside the publication transaction.
    const snapshots = client.query('SELECT id,records_json FROM reference_snapshots ORDER BY as_of DESC, imported_at DESC, id DESC').rows;
    const latestReference = snapshots.find(s => s.records_json.some(r => normalizeReferenceAddress(r.address) === normalizeReferenceAddress(context.address)));
    if ((latestReference?.id ?? null) !== expectedSnapshotId) throw new Error('Reference inputs changed. Reload before saving.');
    const current = client.query('SELECT address_normalized, deleted_at FROM properties WHERE id=$1',[id]).rows[0];
    if (!current || current.deleted_at || current.address_normalized !== context.property.address_normalized) throw new Error('The property changed. Reload before saving.');
    const inserted = client.query('INSERT INTO reference_snapshots(source,as_of,content_hash,records_json) VALUES ($1,$2,$3,$4) RETURNING id',[snapshot.source,asOf,hash,records]).rows[0];
    projection.external.provenance = {snapshotId:inserted.id,source:snapshot.source,asOf};
    projection.referenceSnapshotId = inserted.id;
    client.query(`INSERT INTO scores(property_id,score,decision,decision_color,breakdown,raw_data,config_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(property_id) DO UPDATE SET score=excluded.score,decision=excluded.decision,decision_color=excluded.decision_color,breakdown=excluded.breakdown,raw_data=excluded.raw_data,config_snapshot=excluded.config_snapshot,calculated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`,
      [id,score.score,score.decision,score.decisionColor,score.breakdown,projection,service.getConfig()]);
    return {snapshotId:inserted.id,score};
  });
}

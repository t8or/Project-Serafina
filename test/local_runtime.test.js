import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'serafina-local-runtime-'));
process.env.SERAFINA_DATA_DIR = dataDir;

const { db, initDb } = await import('../src/config/database.js');
const { LocalReferenceData } = await import('../src/services/local_reference_data.js');
const { PropertyService } = await import('../src/services/property_service.js');
const { FileProcessor } = await import('../src/services/file_processor.js');
const { verifyDoclingArtifacts } = await import('../src/services/local_artifacts.js');
const {
  assertLocalStatePath,
  assertLoopbackHost,
  isLoopbackUrl,
  resolveUploadPath,
} = await import('../src/config/runtime_paths.js');

before(async () => {
  await initDb();
});

after(async () => {
  db.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('local database preserves the existing query interface and JSON score fields', async () => {
  const properties = new PropertyService();
  const property = await properties.findOrCreateByAddress({
    street: '123 Main St',
    city: 'Phoenix',
    stateAbbr: 'AZ',
    zipCode: '85001',
    fullAddress: '123 Main St, Phoenix, AZ 85001',
  }, 'Local Test Property');

  await properties.saveScore(
    property.id,
    { score: 8.5, decision: 'Move Forward', decisionColor: 'green', breakdown: { quality: 8.5 } },
    { property: { units: 100 } },
    { weights: { quality: 1 } }
  );

  const related = await properties.getWithRelatedData(property.id);
  assert.equal(related.name, 'Local Test Property');
  assert.deepEqual(related.score.breakdown, { quality: 8.5 });
  assert.deepEqual(related.score.raw_data, { property: { units: 100 } });

  await properties.softDelete(property.id);
  assert.equal((await properties.getById(property.id)), null);
  await properties.restore(property.id);
  assert.equal((await properties.getById(property.id)).id, property.id);
});

test('reference data comes only from an imported local snapshot and retains provenance', async () => {
  const referenceData = new LocalReferenceData();
  const imported = await referenceData.importSnapshot({
    source: 'Local fixture dataset',
    asOf: '2026-07-01',
    records: [{
      address: { street: '123 Main St', city: 'Phoenix', stateAbbr: 'AZ', zipCode: '85001' },
      crime: { violent_crime_index: 12 },
      schools: { average_rating: 8 },
      walkScore: { walk_score: 72 },
    }],
  });
  assert.equal(imported.alreadyImported, false);

  const found = await referenceData.lookup({
    street: '123 MAIN ST', city: 'Phoenix', stateAbbr: 'AZ', zipCode: '85001',
  });
  assert.equal(found.available, true);
  assert.equal(found.data.schools.average_rating, 8);
  assert.equal(found.provenance.source, 'Local fixture dataset');

  const missing = await referenceData.lookup({
    street: '999 Unknown Ave', city: 'Phoenix', stateAbbr: 'AZ', zipCode: '85001',
  });
  assert.deepEqual(missing, {
    available: false,
    reason: 'No local reference snapshot contains this property address',
  });

  await db.query(
    `INSERT INTO reference_snapshots (source, as_of, content_hash, records_json)
     VALUES ($1, $2, $3, $4)`,
    ['Corrupt fixture', '2027-01-01', 'f'.repeat(64), 'not-json']
  );
  await assert.rejects(
    () => referenceData.lookup({ street: '404 Missing St', city: 'Phoenix', stateAbbr: 'AZ' }),
    /malformed records_json/
  );
});

test('runtime path guard rejects remote and traversal paths', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:11434'), true);
  assert.equal(isLoopbackUrl('https://ollama.com'), false);
  assert.throws(() => assertLoopbackHost('0.0.0.0'), /loopback-only/);
  assert.equal(assertLocalStatePath(dataDir, 'test data'), dataDir);
  assert.throws(() => assertLocalStatePath(process.cwd(), 'test workspace'), /outside the source checkout/);
  assert.throws(() => resolveUploadPath('../outside.pdf'), /Invalid upload storage path/);
});

test('Docling artifacts require a complete local checksum manifest', async () => {
  const artifactsDir = path.join(dataDir, 'docling-artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  await assert.rejects(() => verifyDoclingArtifacts(artifactsDir), /artifact manifest is required/);

  const artifactPath = path.join(artifactsDir, 'layout.bin');
  await fs.writeFile(artifactPath, 'local-artifact');
  const digest = crypto.createHash('sha256').update('local-artifact').digest('hex');
  await fs.writeFile(path.join(artifactsDir, 'serafina-artifacts.manifest.json'), JSON.stringify({
    version: 1,
    files: [{ path: 'layout.bin', sha256: digest }],
  }));
  assert.deepEqual(await verifyDoclingArtifacts(artifactsDir), {
    manifestPath: path.join(artifactsDir, 'serafina-artifacts.manifest.json'),
    fileCount: 1,
  });

  await fs.writeFile(artifactPath, 'tampered');
  await assert.rejects(() => verifyDoclingArtifacts(artifactsDir), /checksum mismatch/);
});

test('file processing invokes only the injected Docling-full adapter', async () => {
  const inputPath = path.join(dataDir, 'input.pdf');
  const outputDir = path.join(dataDir, 'extracted-output');
  await fs.writeFile(inputPath, 'pdf fixture');
  let calls = 0;
  const processor = new FileProcessor(outputDir, {
    doclingBridge: {
      async processFull(filePath, destination) {
        calls += 1;
        assert.equal(filePath, inputPath);
        assert.equal(destination, outputDir);
        return { processing_status: 'success', metadata: {}, section_files: [] };
      },
      async checkAvailability() { return { available: true }; },
    },
  });

  const result = await processor.process_file(inputPath, 'input.pdf');
  assert.equal(calls, 1);
  assert.equal(result.metadata.pdf_processor_type, 'docling_full');
  const invalid = await processor.process_file(path.join(dataDir, 'not-a-pdf.txt'));
  assert.equal(invalid.processing_status, 'error');
  assert.equal(calls, 1);
});

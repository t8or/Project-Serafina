/** Durable status with one local extraction writer. Retrying resumes validated Python batches. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { EXTRACTED_DIR } from '../config/runtime_paths.js';
import { db } from '../config/database.js';
import { ExtractionPipeline } from './extraction_pipeline.js';

export class ExtractionJobs {
  constructor(pipeline = new ExtractionPipeline()) {
    this.pipeline = pipeline;
    this.tail = Promise.resolve();
    this.pending = new Map();
  }
  async start(fileId) {
    const id = Number(fileId);
    if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Invalid file ID'), {statusCode: 400});
    if (this.pending.has(id)) return this.pending.get(id);
    if (!(await db.query('SELECT id FROM files WHERE id = $1', [id])).rows.length) {
      throw Object.assign(new Error('File not found'), {statusCode: 404});
    }
    // Recheck after awaiting so simultaneous requests share the same queued work.
    if (this.pending.has(id)) return this.pending.get(id);
    const job = db.querySync("INSERT INTO extraction_jobs (file_id, status) VALUES ($1, 'queued') RETURNING *", [id]).rows[0];
    this.pending.set(id, job);
    this.tail = this.tail.catch(() => {}).then(async () => {
      await db.query("UPDATE extraction_jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id]);
      try {
        const result = await this.pipeline.run({fileId: id});
        await db.query("UPDATE extraction_jobs SET status = $1, result_json = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
          [result.processingResult?.coverage?.status === 'complete' ? 'completed' : 'partial', JSON.stringify(result), job.id]);
      } catch (error) {
        await db.query("UPDATE extraction_jobs SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [error.message, job.id]);
      } finally { this.pending.delete(id); }
    });
    return job;
  }
  async get(id) {
    const job = (await db.query('SELECT * FROM extraction_jobs WHERE id = $1', [id])).rows[0];
    let progress = null;
    if (job?.status === 'running') {
      const file = (await db.query('SELECT filename FROM files WHERE id = $1', [job.file_id])).rows[0];
      const prefix = `e_${path.parse(file.filename).name}_`;
      const names = (await fs.readdir(EXTRACTED_DIR)).filter(name => name.startsWith(prefix) && name.endsWith('_report.json'));
      const candidates = await Promise.all(names.map(async name => ({name, modified: (await fs.stat(path.join(EXTRACTED_DIR, name))).mtimeMs})));
      candidates.sort((a,b) => b.modified - a.modified);
      if (candidates.length) {
        try { progress = JSON.parse(await fs.readFile(path.join(EXTRACTED_DIR, candidates[0].name), 'utf8')).coverage; }
        catch { /* Atomic publication will be visible at the next poll. */ }
      }
    }
    return job ? { ...job, progress, result: job.result_json ? JSON.parse(job.result_json) : null, result_json: undefined } : null;
  }
}
export const extractionJobs = new ExtractionJobs();

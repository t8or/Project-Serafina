/**
 * Local Docling adapter.
 *
 * Interface:
 *   processFull(filePath, outputDir) -> Docling full-processor result
 *   checkAvailability() -> { available, version?, error? }
 *
 * The implementation starts a local Python subprocess and supplies the local
 * artifact directory. It deliberately has no remote Docling endpoint and no
 * parser fallback: an unavailable local environment is a startup error.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { DOCLING_ARTIFACTS_PATH, LOCAL_PYTHON_PATH } from '../../config/runtime_paths.js';
import { verifyDoclingArtifacts } from '../local_artifacts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FULL_PROCESSOR_PATH = path.join(__dirname, 'docling_full_processor.py');
const DEFAULT_MAX_PDF_PAGES = 32;
const activeChildren = new Set();
export function stopDoclingProcesses() {
  for (const child of activeChildren) child.kill('SIGKILL');
}

export function resolveMaxPdfPages(value) {
  const maxPages = value === undefined || value === '' ? DEFAULT_MAX_PDF_PAGES : Number(value);
  if (!Number.isInteger(maxPages) || maxPages < 4 || maxPages > 64) {
    throw new Error(`SERAFINA_DOCLING_BATCH_PAGES (or SERAFINA_MAX_PDF_PAGES) must be an integer from 4 to 64; received ${value}`);
  }
  return maxPages;
}

class DoclingBridge {
  constructor(options = {}) {
    this.pythonPath = options.pythonPath || LOCAL_PYTHON_PATH;
    this.artifactsPath = options.artifactsPath || DOCLING_ARTIFACTS_PATH;
    this.timeout = options.timeout || 7_200_000;
    this.maxPages = resolveMaxPdfPages(
      options.maxPages ?? process.env.SERAFINA_DOCLING_BATCH_PAGES ?? process.env.SERAFINA_MAX_PDF_PAGES
    );
  }

  async processFull(filePath, outputDir) {
    const started = performance.now();
    await fs.access(filePath);
    await verifyDoclingArtifacts(this.artifactsPath);
    await fs.mkdir(outputDir, { recursive: true });

    try {
      const rawResult = await this._execute(
        [FULL_PROCESSOR_PATH, filePath, outputDir, String(this.maxPages)],
        this.timeout
      );
      const result = JSON.parse(rawResult);
      result.timings = {...result.timings, application_seconds: (performance.now() - started) / 1000};
      return result;
    } catch (error) {
      return { processing_status: 'error', error_message: error.message };
    }
  }

  async checkAvailability() {
    try {
      const artifacts = await verifyDoclingArtifacts(this.artifactsPath);
      const version = await this._execute([
        '-c',
        'from importlib.metadata import version; print(version("docling"))',
      ], 30_000);
      return { available: true, version: version.trim(), artifactsPath: this.artifactsPath, ...artifacts };
    } catch (error) {
      return { available: false, error: error.message, artifactsPath: this.artifactsPath };
    }
  }

  _execute(args, timeout) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DOCLING_ARTIFACTS_PATH: this.artifactsPath,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
        },
      });
      activeChildren.add(child);
      let stdout = '';
      let stderr = '';
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
        force.unref();
        reject(new Error(`Docling process timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-64_000); });
      child.on('error', (error) => {
        activeChildren.delete(child);
        clearTimeout(timeoutId);
        reject(new Error(`Failed to start local Python (${this.pythonPath}): ${error.message}`));
      });
      child.on('close', (code) => {
        activeChildren.delete(child);
        clearTimeout(timeoutId);
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `Docling processor exited with code ${code}`));
      });
    });
  }
}

export { DoclingBridge };

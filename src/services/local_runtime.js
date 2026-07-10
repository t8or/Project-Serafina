/**
 * LocalRuntime — verifies the explicit runtime contract before the app starts.
 *
 * Interface:
 *   inspectLocalRuntime() -> diagnostic report
 *   assertLocalRuntimeReady() -> report or throws a consolidated error
 *
 * TODO(local-runtime): Keep this strict. A missing model/artifact must be fixed
 * during machine provisioning, not worked around with a remote call at runtime.
 */

import { spawn } from 'child_process';
import { DoclingBridge } from './processors/docling_bridge.js';
import { OllamaService } from './ollama_service.js';
import { verifyDoclingArtifacts } from './local_artifacts.js';
import {
  DATA_DIR,
  DOCLING_ARTIFACTS_PATH,
  LOCAL_PYTHON_PATH,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  assertLoopbackUrl,
  assertLocalStatePath,
} from '../config/runtime_paths.js';

function check(name, ok, detail) {
  return { name, ok, detail };
}

async function executableVersion(command, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('error', (error) => resolve({ ok: false, detail: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, detail: output.trim() || `exit ${code}` }));
  });
}

export async function inspectLocalRuntime() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(check('node', nodeMajor === 26, `Node ${process.versions.node}; Serafina requires Node 26 Current`));

  try {
    assertLocalStatePath(DATA_DIR, 'SERAFINA_DATA_DIR');
    assertLocalStatePath(DOCLING_ARTIFACTS_PATH, 'SERAFINA_DOCLING_ARTIFACTS_PATH');
    checks.push(check('local_paths', true, DATA_DIR));
  } catch (error) {
    checks.push(check('local_paths', false, error.message));
  }

  try {
    assertLoopbackUrl(OLLAMA_BASE_URL, 'SERAFINA_OLLAMA_BASE_URL');
    checks.push(check('ollama_endpoint', true, OLLAMA_BASE_URL));
  } catch (error) {
    checks.push(check('ollama_endpoint', false, error.message));
  }

  const python = await executableVersion(LOCAL_PYTHON_PATH);
  checks.push(check('python', python.ok, `${LOCAL_PYTHON_PATH}: ${python.detail}`));

  try {
    const artifacts = await verifyDoclingArtifacts();
    checks.push(check('docling_artifacts', true, `${artifacts.fileCount} verified files`));
  } catch (error) {
    checks.push(check('docling_artifacts', false, error.message));
  }

  const docling = await new DoclingBridge().checkAvailability();
  checks.push(check('docling', docling.available, docling.available ? `Docling ${docling.version}` : docling.error));

  try {
    const ollama = await new OllamaService().checkAvailability();
    checks.push(check('ollama_model', ollama.available, ollama.available
      ? `${OLLAMA_MODEL} is installed`
      : `${ollama.error}. Installed: ${ollama.installedModels.join(', ') || '(none)'}`));
  } catch (error) {
    checks.push(check('ollama_model', false, error.message));
  }

  return { ok: checks.every((item) => item.ok), dataDir: DATA_DIR, checks };
}

export async function assertLocalRuntimeReady() {
  const report = await inspectLocalRuntime();
  if (!report.ok) {
    const failures = report.checks.filter((item) => !item.ok).map((item) => `- ${item.name}: ${item.detail}`);
    throw new Error(`Local runtime is not provisioned:\n${failures.join('\n')}`);
  }
  return report;
}

import { inspectLocalRuntime } from '../src/services/local_runtime.js';

const report = await inspectLocalRuntime();
console.log(`Local data directory: ${report.dataDir}`);
for (const item of report.checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
}
if (!report.ok) process.exitCode = 1;

/** Enforce the single-writer runtime contract before recovering durable jobs. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config/runtime_paths.js';
export async function acquireRuntimeLock(directory = DATA_DIR) {
  await fs.mkdir(directory, {recursive: true});
  const lockPath = path.join(directory, 'runtime.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
      await handle.close();
      return async () => {
        const owner = JSON.parse(await fs.readFile(lockPath, 'utf8').catch(()=>'{}'));
        if (owner.pid === process.pid) await fs.unlink(lockPath);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await fs.readFile(lockPath, 'utf8')); }
      catch { throw new Error(`Unreadable runtime lock at ${lockPath}; inspect before restarting`); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid runtime lock owner');
      try { process.kill(owner.pid, 0); }
      catch (probe) {
        if (probe.code === 'ESRCH') { await fs.unlink(lockPath); continue; }
        throw probe;
      }
      throw new Error(`Serafina already uses this data directory (process ${owner.pid})`);
    }
  }
  throw new Error('Could not acquire Serafina runtime lock');
}

import {spawnSync} from 'node:child_process';
import {LOCAL_PYTHON_PATH} from '../src/config/runtime_paths.js';
for (const [command,args] of [[process.execPath,['--test']], [LOCAL_PYTHON_PATH,['-m','unittest','discover','-s','test','-p','test_*.py']]]) {
  const result = spawnSync(command,args,{stdio:'inherit'});
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}

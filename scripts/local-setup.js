import { initDb } from '../src/config/database.js';
import { DATA_DIR, LOCAL_RUNTIME_PROVISIONING_NOTE } from '../src/config/runtime_paths.js';

const result = await initDb();
console.log(`Initialized local Serafina data at ${DATA_DIR}`);
console.log(`Database: ${result.path}`);
console.log(LOCAL_RUNTIME_PROVISIONING_NOTE);

/**
 * CLI entry for database initialization.
 *
 * Schema lives in database.js (initDb). This file only invokes that —
 * do not maintain a second CREATE TABLE copy here.
 *
 * Usage: node src/config/init-db.js
 */

import { initDb } from './database.js';

initDb()
  .then(() => {
    console.log('Database initialization complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });

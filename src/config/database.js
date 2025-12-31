import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;

// Load environment variables
dotenv.config();

console.log('=== Database Configuration Initialization ===');
console.log('Loading environment variables...');

const {
  DB_USER,
  DB_HOST,
  DB_NAME = 'serafina_db',
  DB_PORT = 5432,
  DB_PASSWORD,
  NODE_ENV
} = process.env;

console.log('Environment variables loaded:', {
  DB_USER,
  DB_HOST,
  DB_NAME,
  DB_PORT,
  NODE_ENV
});

// Create connection pool
const pool = new Pool({
  user: DB_USER,
  host: DB_HOST,
  database: DB_NAME,
  password: DB_PASSWORD,
  port: DB_PORT,
  // Pool configuration
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

console.log('Pool configuration:', {
  user: pool.options.user,
  host: pool.options.host,
  database: pool.options.database,
  port: pool.options.port
});

// Connection event handlers
pool.on('connect', (client) => {
  console.log('=== New Database Connection ===');
  console.log('Client connected:', {
    user: client.connectionParameters.user,
    database: client.connectionParameters.database,
    host: client.connectionParameters.host,
    pid: client.processID
  });
});

pool.on('error', (err) => {
  console.error('=== Database Pool Error ===');
  console.error('Error details:', {
    name: err.name,
    message: err.message,
    code: err.code,
    stack: err.stack
  });
});

// Test the connection
async function validateConnection() {
  try {
    const client = await pool.connect();
    console.log('Successfully connected to database');
    const result = await client.query('SELECT current_database() as db, current_user as user');
    console.log('Database connection details:', result.rows[0]);
    client.release();
    return true;
  } catch (err) {
    console.error('Failed to validate database connection:', err);
    return false;
  }
}

// Initialize database tables
async function initDb() {
  console.log('=== Initializing Database Tables ===');
  try {
    const client = await pool.connect();
    
    // Log current tables
    const tablesQuery = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log('Existing tables:', tablesQuery.rows);

    // Legacy files table (kept for backward compatibility during migration)
    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        user_id VARCHAR(100) DEFAULT '000',
        storage_path TEXT NOT NULL,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active',
        is_extracted BOOLEAN DEFAULT false,
        extracted_text TEXT
      )
    `);

    // Properties: Central entity representing a real estate property
    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        address_street VARCHAR(255),
        address_city VARCHAR(100),
        address_state VARCHAR(50),
        address_state_abbr VARCHAR(2),
        address_zip VARCHAR(20),
        address_full TEXT,
        address_normalized VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);

    // Documents: Uploaded PDF files linked to properties
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        storage_path TEXT NOT NULL,
        user_id VARCHAR(100) DEFAULT '000',
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);

    // Extracted Files: JSON data extracted from documents
    await client.query(`
      CREATE TABLE IF NOT EXISTS extracted_files (
        id SERIAL PRIMARY KEY,
        property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        section_type VARCHAR(100) NOT NULL,
        storage_path TEXT NOT NULL,
        data_hash VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);

    // Scores: Persisted scoring results for properties
    await client.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE UNIQUE,
        score DECIMAL(4, 2) NOT NULL,
        decision VARCHAR(100) NOT NULL,
        decision_color VARCHAR(20) NOT NULL,
        breakdown JSONB,
        raw_data JSONB,
        config_snapshot JSONB,
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Generated Files: Spreadsheets and reports generated for properties
    await client.query(`
      CREATE TABLE IF NOT EXISTS generated_files (
        id SERIAL PRIMARY KEY,
        property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
        file_type VARCHAR(50) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        storage_path TEXT NOT NULL,
        template_used VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);

    // Create indexes for better query performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_address_normalized ON properties(address_normalized)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_deleted_at ON properties(deleted_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_property_id ON documents(property_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_extracted_files_property_id ON extracted_files(property_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scores_property_id ON scores(property_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_generated_files_property_id ON generated_files(property_id)`);

    // Create trigger function for updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    // Apply triggers (drop first to avoid duplicates)
    await client.query(`DROP TRIGGER IF EXISTS update_properties_updated_at ON properties`);
    await client.query(`
      CREATE TRIGGER update_properties_updated_at
        BEFORE UPDATE ON properties
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column()
    `);

    await client.query(`DROP TRIGGER IF EXISTS update_scores_updated_at ON scores`);
    await client.query(`
      CREATE TRIGGER update_scores_updated_at
        BEFORE UPDATE ON scores
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column()
    `);

    console.log('Database tables initialized successfully');
    client.release();
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

// Validate connection on startup
validateConnection();

export { pool as db, initDb }; 
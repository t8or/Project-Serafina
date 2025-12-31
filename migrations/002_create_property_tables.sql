-- Migration: Create property-centric data model
-- This migration creates tables for the property CRUD lifecycle with soft delete support

-- Properties: Central entity representing a real estate property
-- Properties are identified by normalized address
CREATE TABLE IF NOT EXISTS properties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),                          -- Property name (e.g., "Serafina", "Urban 148")
    address_street VARCHAR(255),                -- Street address
    address_city VARCHAR(100),                  -- City
    address_state VARCHAR(50),                  -- State (full name or abbreviation)
    address_state_abbr VARCHAR(2),              -- State abbreviation
    address_zip VARCHAR(20),                    -- ZIP code
    address_full TEXT,                          -- Full formatted address for display
    address_normalized VARCHAR(255),            -- Normalized address for matching (lowercase, no punctuation)
    status VARCHAR(50) DEFAULT 'active',        -- 'active', 'deleted'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP                        -- NULL = not deleted, timestamp = soft deleted
);

-- Index for address-based property lookup
CREATE INDEX IF NOT EXISTS idx_properties_address_normalized ON properties(address_normalized);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_deleted_at ON properties(deleted_at);

-- Documents: Uploaded PDF files linked to properties
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,             -- Stored filename (with unique ID)
    original_filename VARCHAR(255) NOT NULL,    -- Original uploaded filename
    file_type VARCHAR(100) NOT NULL,            -- MIME type or extension
    file_size BIGINT NOT NULL,                  -- File size in bytes
    storage_path TEXT NOT NULL,                 -- Path relative to uploads directory
    user_id VARCHAR(100) DEFAULT '000',         -- User who uploaded (for future auth)
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP                        -- Soft delete timestamp
);

CREATE INDEX IF NOT EXISTS idx_documents_property_id ON documents(property_id);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);

-- Extracted Files: JSON data extracted from documents
-- Each document can have multiple sections (subject_property, demographics, etc.)
CREATE TABLE IF NOT EXISTS extracted_files (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    section_type VARCHAR(100) NOT NULL,         -- 'subject_property', 'demographics', 'construction', etc.
    storage_path TEXT NOT NULL,                 -- Path to JSON file
    data_hash VARCHAR(64),                      -- SHA-256 hash of content for change detection
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extracted_files_property_id ON extracted_files(property_id);
CREATE INDEX IF NOT EXISTS idx_extracted_files_document_id ON extracted_files(document_id);
CREATE INDEX IF NOT EXISTS idx_extracted_files_section_type ON extracted_files(section_type);

-- Scores: Persisted scoring results for properties
-- Stores the calculated score along with config snapshot for audit trail
CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE UNIQUE,
    score DECIMAL(4, 2) NOT NULL,               -- Score from 0.00 to 10.00
    decision VARCHAR(100) NOT NULL,             -- 'Move Forward', 'Needs Review', 'Rejected'
    decision_color VARCHAR(20) NOT NULL,        -- 'green', 'yellow', 'red'
    breakdown JSONB,                            -- Detailed scoring breakdown by factor
    raw_data JSONB,                             -- Input data used for scoring (demographics, submarket, etc.)
    config_snapshot JSONB,                      -- Scorecard config at time of calculation
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scores_property_id ON scores(property_id);
CREATE INDEX IF NOT EXISTS idx_scores_decision ON scores(decision);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score);

-- Generated Files: Spreadsheets and reports generated for properties
CREATE TABLE IF NOT EXISTS generated_files (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    file_type VARCHAR(50) NOT NULL,             -- 'xlsx', 'pdf', etc.
    file_name VARCHAR(255) NOT NULL,            -- Filename
    storage_path TEXT NOT NULL,                 -- Path relative to uploads directory
    template_used VARCHAR(255),                 -- Template file used for generation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generated_files_property_id ON generated_files(property_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_file_type ON generated_files(file_type);

-- Add trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DROP TRIGGER IF EXISTS update_properties_updated_at ON properties;
CREATE TRIGGER update_properties_updated_at
    BEFORE UPDATE ON properties
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_extracted_files_updated_at ON extracted_files;
CREATE TRIGGER update_extracted_files_updated_at
    BEFORE UPDATE ON extracted_files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scores_updated_at ON scores;
CREATE TRIGGER update_scores_updated_at
    BEFORE UPDATE ON scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


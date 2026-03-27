-- Migration: 20260327_002_create_client_config_sessions.sql
-- Purpose: Create client_config_sessions table for WhatsApp Configuration Management session state
-- Date: 2026-03-27
-- Feature: WhatsApp Client Configuration Management

CREATE TABLE IF NOT EXISTS client_config_sessions (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL UNIQUE,
    phone_number VARCHAR(20) NOT NULL,
    client_id VARCHAR(50) NOT NULL,
    current_stage VARCHAR(30) NOT NULL CHECK (current_stage IN ('selecting_client', 'viewing_config', 'selecting_group', 'modifying_config', 'confirming_changes')),
    configuration_group VARCHAR(50),
    pending_changes JSONB NOT NULL DEFAULT '{}',
    original_state JSONB NOT NULL DEFAULT '{}',
    timeout_extensions INTEGER NOT NULL DEFAULT 0 CHECK (timeout_extensions >= 0 AND timeout_extensions <= 3),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for phone number lookups (most common query)
CREATE INDEX IF NOT EXISTS idx_client_config_sessions_phone 
  ON client_config_sessions (phone_number);

-- Index for session ID lookups
CREATE INDEX IF NOT EXISTS idx_client_config_sessions_session_id 
  ON client_config_sessions (session_id);

-- Index for client ID lookups (for conflict detection)
CREATE INDEX IF NOT EXISTS idx_client_config_sessions_client_id 
  ON client_config_sessions (client_id);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_client_config_sessions_expires_at 
  ON client_config_sessions (expires_at);

-- Index for current stage filtering
CREATE INDEX IF NOT EXISTS idx_client_config_sessions_stage 
  ON client_config_sessions (current_stage);

-- Composite index for active session lookups
CREATE INDEX IF NOT EXISTS idx_client_config_sessions_phone_expires 
  ON client_config_sessions (phone_number, expires_at);

-- Update the updated_at column automatically
CREATE OR REPLACE FUNCTION update_client_config_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_config_sessions_updated_at
    BEFORE UPDATE ON client_config_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_client_config_sessions_updated_at();
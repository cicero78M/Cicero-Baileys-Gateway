-- Migration: 20260327_001_create_administrator_authorization.sql
-- Purpose: Create administrator_authorization table for WhatsApp Configuration Management
-- Date: 2026-03-27
-- Feature: WhatsApp Client Configuration Management

CREATE TABLE IF NOT EXISTS administrator_authorization (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    permission_level VARCHAR(20) NOT NULL CHECK (permission_level IN ('full', 'specific_clients', 'readonly')),
    client_access_scope TEXT[], -- Array of client IDs for specific_clients permission level
    is_authorized BOOLEAN NOT NULL DEFAULT false,
    last_access_attempt TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster phone number lookups
CREATE INDEX IF NOT EXISTS idx_administrator_authorization_phone 
  ON administrator_authorization (phone_number);

-- Index for permission level queries
CREATE INDEX IF NOT EXISTS idx_administrator_authorization_permission 
  ON administrator_authorization (permission_level);

-- Index for authorization status
CREATE INDEX IF NOT EXISTS idx_administrator_authorization_authorized 
  ON administrator_authorization (is_authorized);

-- Update the updated_at column automatically
CREATE OR REPLACE FUNCTION update_administrator_authorization_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER administrator_authorization_updated_at
    BEFORE UPDATE ON administrator_authorization
    FOR EACH ROW
    EXECUTE FUNCTION update_administrator_authorization_updated_at();
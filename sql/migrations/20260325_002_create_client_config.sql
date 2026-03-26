-- Migration: 20260325_002_create_client_config.sql
-- Purpose: Create client_config table for per-client and DEFAULT config key/value pairs.
-- Idempotent: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS client_config (
  id           SERIAL          PRIMARY KEY,
  client_id    VARCHAR(100)    NOT NULL REFERENCES clients(client_id),
  config_key   VARCHAR(100)    NOT NULL,
  config_value TEXT            NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, config_key)
);

CREATE INDEX IF NOT EXISTS idx_client_config_client_id
  ON client_config (client_id);

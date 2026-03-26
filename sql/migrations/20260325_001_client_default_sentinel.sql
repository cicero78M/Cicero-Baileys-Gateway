-- Migration: 20260325_001_client_default_sentinel.sql
-- Purpose: Insert DEFAULT sentinel row into clients table for use as
--          fallback client_id in client_config lookups.
-- Idempotent: ON CONFLICT DO NOTHING

INSERT INTO clients (client_id, nama, client_status)
VALUES ('DEFAULT', 'DEFAULT CONFIG SENTINEL', FALSE)
ON CONFLICT (client_id) DO NOTHING;

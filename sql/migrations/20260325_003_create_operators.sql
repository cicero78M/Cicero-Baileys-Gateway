-- Migration: 20260325_003_create_operators.sql
-- Purpose: Create operators table — maps WA phone numbers to registered client/satker.
-- Idempotent: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS operators (
  phone_number  VARCHAR(30)   PRIMARY KEY,
  client_id     VARCHAR(100)  NOT NULL REFERENCES clients(client_id),
  satker_name   VARCHAR(200)  NOT NULL,
  registered_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operators_client_id
  ON operators (client_id);
CREATE INDEX IF NOT EXISTS idx_operators_is_active
  ON operators (is_active);

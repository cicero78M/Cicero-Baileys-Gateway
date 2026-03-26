-- Migration: 20260325_004_create_operator_registration_sessions.sql
-- Purpose: Create operator_registration_sessions table for 3-step dialog state machine.
--          No FK to operators — the number is not yet registered when a session exists.
-- Idempotent: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS operator_registration_sessions (
  phone_number      VARCHAR(30)   PRIMARY KEY,
  stage             VARCHAR(30)   NOT NULL,
  -- valid values: 'awaiting_confirmation', 'awaiting_satker_choice'
  original_message  TEXT          NOT NULL,
  expires_at        TIMESTAMPTZ   NOT NULL,
  attempt_count     SMALLINT      NOT NULL DEFAULT 1,
  first_attempt_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_op_sessions_expires_at
  ON operator_registration_sessions (expires_at);

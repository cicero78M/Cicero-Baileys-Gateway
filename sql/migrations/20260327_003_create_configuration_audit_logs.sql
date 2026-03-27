-- Migration: 20260327_003_create_configuration_audit_logs.sql
-- Purpose: Create configuration_audit_logs table for WhatsApp Configuration Management audit trail
-- Date: 2026-03-27
-- Feature: WhatsApp Client Configuration Management

CREATE TABLE IF NOT EXISTS configuration_audit_logs (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL,
    client_id VARCHAR(50) NOT NULL,
    administrator_phone VARCHAR(20) NOT NULL,
    action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('create_session', 'modify_config', 'confirm_changes', 'cancel_session', 'extend_session', 'rollback_session')),
    configuration_key VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for session-based queries (most common for audit trails)
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_session 
  ON configuration_audit_logs (session_id);

-- Index for client-based audit queries
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_client 
  ON configuration_audit_logs (client_id);

-- Index for administrator activity tracking
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_admin 
  ON configuration_audit_logs (administrator_phone);

-- Index for action type filtering
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_action 
  ON configuration_audit_logs (action_type);

-- Index for timestamp-based queries (chronological audit trails)
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_created_at 
  ON configuration_audit_logs (created_at);

-- Index for configuration key tracking
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_config_key 
  ON configuration_audit_logs (configuration_key);

-- Composite index for administrator activity by date
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_admin_date 
  ON configuration_audit_logs (administrator_phone, created_at);

-- Composite index for client configuration changes by date  
CREATE INDEX IF NOT EXISTS idx_configuration_audit_logs_client_date 
  ON configuration_audit_logs (client_id, created_at);
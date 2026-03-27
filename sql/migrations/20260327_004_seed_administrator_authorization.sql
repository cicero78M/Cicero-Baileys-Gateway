-- Migration: 20260327_004_seed_administrator_authorization.sql
-- Purpose: Seed initial administrator authorization data for testing WhatsApp Configuration Management
-- Date: 2026-03-27
-- Feature: WhatsApp Client Configuration Management

-- Insert test administrators for development/testing
-- Note: Replace with actual administrator phone numbers in production

INSERT INTO administrator_authorization (phone_number, permission_level, client_access_scope, is_authorized) VALUES
-- Full access admin (can access all clients and modify any configuration)
('+6281234567890', 'full', NULL, true),

-- Specific clients admin (can only access specific clients)
('+6281234567891', 'specific_clients', ARRAY['client1', 'client2'], true),

-- Read-only admin (can view configurations but not modify)
('+6281234567892', 'readonly', NULL, true)

ON CONFLICT (phone_number) DO UPDATE SET
    permission_level = EXCLUDED.permission_level,
    client_access_scope = EXCLUDED.client_access_scope,
    is_authorized = EXCLUDED.is_authorized,
    updated_at = CURRENT_TIMESTAMP;

-- Note: In production, you should:
-- 1. Replace the test phone numbers above with actual administrator phone numbers
-- 2. Consider using environment variables or separate configuration for phone numbers
-- 3. Remove or comment out this seeding migration after initial setup
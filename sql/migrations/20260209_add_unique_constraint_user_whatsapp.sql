-- Migration: Add unique constraint to user.whatsapp field
-- Purpose: Enforce one WhatsApp number per user account (one-to-one relationship)
-- Date: 2026-02-09

-- Before adding the unique constraint, we need to handle any existing duplicates
-- First, let's identify and clean up duplicate WhatsApp numbers (keep the earliest created_at)

-- Step 1: Clear duplicate WhatsApp numbers (keep only the first created user with each number)
-- Use created_at as primary sort, user_id as tie-breaker for deterministic results
UPDATE "user" u1
SET whatsapp = NULL, updated_at = NOW()
WHERE u1.whatsapp IS NOT NULL 
  AND u1.whatsapp != ''
  AND EXISTS (
    SELECT 1 
    FROM "user" u2 
    WHERE u2.whatsapp = u1.whatsapp 
      AND (u2.created_at < u1.created_at 
           OR (u2.created_at = u1.created_at AND u2.user_id < u1.user_id))
  );

-- Step 2: Add unique constraint on whatsapp field
-- This ensures one WhatsApp number can only be associated with one user account
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_whatsapp_unique 
ON "user"(whatsapp) 
WHERE whatsapp IS NOT NULL AND whatsapp != '';

-- Note: We use a partial unique index to allow multiple NULL or empty string values
-- This way, users without a WhatsApp number linked won't conflict with each other

-- Migration: 20260325_006_alter_tiktok_post_task_columns.sql
-- Purpose: Add task_source and operator_phone columns to tiktok_post.
--          Nullable so existing rows are unaffected.
-- Idempotent: IF NOT EXISTS

ALTER TABLE tiktok_post
  ADD COLUMN IF NOT EXISTS task_source    VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS operator_phone VARCHAR(30)  DEFAULT NULL;

COMMENT ON COLUMN tiktok_post.task_source IS
  'broadcast_wa = sourced from operator WA broadcast; NULL = standard crawl';
COMMENT ON COLUMN tiktok_post.operator_phone IS
  'Phone number of operator who submitted this task via WA broadcast';

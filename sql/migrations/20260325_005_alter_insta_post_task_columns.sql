-- Migration: 20260325_005_alter_insta_post_task_columns.sql
-- Purpose: Add task_source and operator_phone columns to insta_post.
--          Nullable so existing rows are unaffected.
-- Idempotent: IF NOT EXISTS

ALTER TABLE insta_post
  ADD COLUMN IF NOT EXISTS task_source    VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS operator_phone VARCHAR(30)  DEFAULT NULL;

COMMENT ON COLUMN insta_post.task_source IS
  'broadcast_wa = sourced from operator WA broadcast; NULL = standard crawl';
COMMENT ON COLUMN insta_post.operator_phone IS
  'Phone number of operator who submitted this task via WA broadcast';

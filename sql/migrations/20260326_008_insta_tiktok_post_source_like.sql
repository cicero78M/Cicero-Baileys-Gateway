-- Migration: add like_count and source_type to insta_post / insta_post_khusus, source_type to tiktok_post
-- context: broadcast WA task input pipeline now stores engagement and source metadata

ALTER TABLE insta_post
  ADD COLUMN IF NOT EXISTS like_count  INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(30)  DEFAULT NULL;

ALTER TABLE insta_post_khusus
  ADD COLUMN IF NOT EXISTS like_count  INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(30)  DEFAULT NULL;

ALTER TABLE tiktok_post
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(30)  DEFAULT NULL;

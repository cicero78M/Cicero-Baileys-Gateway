-- Add index to improve performance of login_log queries
-- This index optimizes queries that filter by actor_id, login_source, and logged_at
-- which are commonly used in attendance and login tracking reports

CREATE INDEX IF NOT EXISTS idx_login_log_actor_source_time
ON login_log (actor_id, login_source, logged_at DESC);

-- Add index for login_source alone to speed up queries that only filter by source
CREATE INDEX IF NOT EXISTS idx_login_log_source_time
ON login_log (login_source, logged_at DESC);

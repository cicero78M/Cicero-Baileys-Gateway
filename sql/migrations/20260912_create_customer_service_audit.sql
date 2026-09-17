CREATE TABLE IF NOT EXISTS customer_service_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  sender_hash CHAR(64) NOT NULL,
  message_hash CHAR(64),
  user_id VARCHAR,
  intent VARCHAR(64),
  "authorization" VARCHAR(32),
  model VARCHAR(128),
  prompt_version VARCHAR(64),
  knowledge_source VARCHAR(128),
  response_status VARCHAR(32),
  latency_ms INTEGER,
  estimated_cost_usd NUMERIC(12, 8),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_audit_created_at
  ON customer_service_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_service_audit_user_id
  ON customer_service_audit (user_id, created_at DESC);

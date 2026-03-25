# Data Model: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Feature**: `003-sosmed-task-autoresponse`  
**Date**: 2026-03-25

---

## Summary of Schema Changes

| Type | Table | Action |
|---|---|---|
| ALTER | `clients` | Seed sentinel row `client_id = 'DEFAULT'` |
| CREATE | `client_config` | New — konfigurasi per `client_id` |
| CREATE | `operators` | New — mapping nomor WA operator ↔ `client_id` |
| CREATE | `operator_registration_sessions` | New — state sesi registrasi interaktif |
| ALTER | `insta_post` | Add `task_source VARCHAR(30)`, `operator_phone VARCHAR(30)` |
| ALTER | `tiktok_post` | Add `task_source VARCHAR(30)`, `operator_phone VARCHAR(30)` |

---

## Migration Order

Migrations MUST be applied in this order due to FK dependencies:

```
1. 20260325_001_client_default_sentinel.sql
2. 20260325_002_create_client_config.sql
3. 20260325_003_create_operators.sql
4. 20260325_004_create_operator_registration_sessions.sql
5. 20260325_005_alter_insta_post_task_columns.sql
6. 20260325_006_alter_tiktok_post_task_columns.sql
7. 20260325_007_seed_client_config_defaults.sql
```

---

## Table Definitions

### Migration 1: Sentinel Row `clients`

```sql
-- 20260325_001_client_default_sentinel.sql
INSERT INTO clients (client_id, nama, client_status)
VALUES ('DEFAULT', 'DEFAULT CONFIG SENTINEL', FALSE)
ON CONFLICT (client_id) DO NOTHING;
```

**Notes**:
- `client_status = FALSE` so the sentinel row is never treated as an active client.
- `ON CONFLICT DO NOTHING` makes migration idempotent.

---

### Migration 2: `client_config`

```sql
-- 20260325_002_create_client_config.sql
CREATE TABLE IF NOT EXISTS client_config (
  id           SERIAL          PRIMARY KEY,
  client_id    VARCHAR(100)    NOT NULL REFERENCES clients(client_id),
  config_key   VARCHAR(100)    NOT NULL,
  config_value TEXT            NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, config_key)
);

CREATE INDEX IF NOT EXISTS idx_client_config_client_id
  ON client_config (client_id);
```

**Access pattern**: Lookup by `(client_id, config_key)`. First checks per-client row; falls back to `client_id = 'DEFAULT'` if not found.

**Relationships**:
- `client_id` → `clients(client_id)` (FK, includes sentinel `'DEFAULT'`)

---

### Migration 3: `operators`

```sql
-- 20260325_003_create_operators.sql
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
```

**Upsert pattern** (used by `operatorRepository.upsertOperator`):

```sql
INSERT INTO operators (phone_number, client_id, satker_name)
VALUES ($1, $2, $3)
ON CONFLICT (phone_number) DO UPDATE
  SET client_id     = EXCLUDED.client_id,
      satker_name   = EXCLUDED.satker_name,
      registered_at = NOW(),
      updated_at    = NOW(),
      is_active     = TRUE;
```

**Notes**:
- `phone_number` is stored without JID suffix (e.g., `628123456789`, not `628123456789@s.whatsapp.net`).
- `satker_name` is denormalized from `clients.nama` at registration time.
- `is_active = FALSE` set manually by admin via DB; no automated lifecycle in this feature.

---

### Migration 4: `operator_registration_sessions`

```sql
-- 20260325_004_create_operator_registration_sessions.sql
CREATE TABLE IF NOT EXISTS operator_registration_sessions (
  phone_number      VARCHAR(30)   PRIMARY KEY,
  stage             VARCHAR(30)   NOT NULL,
  -- 'awaiting_confirmation' | 'awaiting_satker_choice'
  original_message  TEXT          NOT NULL,
  expires_at        TIMESTAMPTZ   NOT NULL,
  attempt_count     SMALLINT      NOT NULL DEFAULT 1,
  first_attempt_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_op_sessions_expires_at
  ON operator_registration_sessions (expires_at);
```

**Notes**:
- `first_attempt_at` tracks the start of the rate-limit window (required for FR-019 cooldown calculation; not in spec DDL but required by implementation).
- `attempt_count` increments each time a new session is started for this phone number.
- The window check: if `attempt_count >= max_attempts AND NOW() - first_attempt_at < cooldown_interval`, bot silences. On conflict, if the cooldown window has expired (`NOW() - first_attempt_at >= cooldown_interval`), reset `attempt_count = 1` and `first_attempt_at = NOW()` instead of incrementing — prevents permanent rate-limiting after the first violation window.
- `updated_at` updates to `NOW()` on every `upsertSession` conflict update.
- Sessions are hard-deleted after completion or upon expiry cleanup.

---

### Migration 5: Alter `insta_post`

```sql
-- 20260325_005_alter_insta_post_task_columns.sql
ALTER TABLE insta_post
  ADD COLUMN IF NOT EXISTS task_source    VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS operator_phone VARCHAR(30)  DEFAULT NULL;

COMMENT ON COLUMN insta_post.task_source IS
  'broadcast_wa = sourced from operator WA broadcast; NULL = standard crawl';
COMMENT ON COLUMN insta_post.operator_phone IS
  'Phone number of operator who submitted this task via WA broadcast';
```

**Notes**:
- Both columns are nullable — existing rows are unaffected (`DEFAULT NULL`).
- `task_source = 'broadcast_wa'` identifies operator-sourced entries.

---

### Migration 6: Alter `tiktok_post`

```sql
-- 20260325_006_alter_tiktok_post_task_columns.sql
ALTER TABLE tiktok_post
  ADD COLUMN IF NOT EXISTS task_source    VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS operator_phone VARCHAR(30)  DEFAULT NULL;

COMMENT ON COLUMN tiktok_post.task_source IS
  'broadcast_wa = sourced from operator WA broadcast; NULL = standard crawl';
COMMENT ON COLUMN tiktok_post.operator_phone IS
  'Phone number of operator who submitted this task via WA broadcast';
```

---

### Migration 7: Seed Default Config

```sql
-- 20260325_007_seed_client_config_defaults.sql
INSERT INTO client_config (client_id, config_key, config_value, description) VALUES
  ('DEFAULT', 'broadcast_trigger_keywords',      'pagi,siang,sore,malam',
   'Kata salam waktu pemicu deteksi broadcast'),
  ('DEFAULT', 'broadcast_action_keywords',       'like,comment,share,follow,subscribe,repost',
   'Kata aksi sosmed wajib dalam broadcast'),
  ('DEFAULT', 'broadcast_required_phrase',       'mohon izin dibantu',
   'Frasa wajib dalam setiap broadcast tugas'),
  ('DEFAULT', 'operator_unregistered_prompt',
   'Anda mengirim pesan tugas untuk dieksekusi, tapi database kami belum membaca Satker Asal anda. Apakah anda ingin mendaftarkan nomor anda sebagai operator tugas? (ya/tidak)',
   'Pesan konfirmasi ke nomor belum terdaftar'),
  ('DEFAULT', 'operator_satker_list_header',     'Pilih Satker Anda dengan membalas nomor urut:',
   'Header daftar pilihan satker'),
  ('DEFAULT', 'operator_registration_ack',
   'Nomor Anda berhasil terdaftar sebagai operator untuk {satker_name}. Anda dapat mengirim pesan tugas kembali.',
   'Konfirmasi registrasi berhasil'),
  ('DEFAULT', 'operator_registration_declined',  'Baik, pendaftaran dibatalkan.',
   'Pesan saat operator menolak registrasi'),
  ('DEFAULT', 'operator_invalid_choice',         'Pilihan tidak valid. Silakan balas dengan nomor urut.',
   'Pesan saat pilihan satker tidak valid'),
  ('DEFAULT', 'operator_no_satker',              'Tidak ada Satker aktif. Hubungi administrator.',
   'Pesan saat tidak ada satker aktif tersedia'),
  ('DEFAULT', 'operator_session_ttl_seconds',    '300',
   'TTL sesi registrasi dalam detik'),
  ('DEFAULT', 'operator_registration_max_attempts', '5',
   'Maks percobaan sesi registrasi sebelum bot diam'),
  ('DEFAULT', 'operator_registration_cooldown_minutes', '60',
   'Window cooldown untuk menghitung attempt_count (menit)'),
  ('DEFAULT', 'task_input_ack',
   'Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.',
   'Ack tugas berhasil direkam')
ON CONFLICT (client_id, config_key) DO NOTHING;
```

---

## Entity Relationship Summary

```
clients (existing)
  ├── client_config (NEW) — client_id FK
  │     └── config_key/config_value pairs per satker
  ├── operators (NEW) — client_id FK
  │     └── phone_number → client_id mapping
  ├── insta_post (ALTERED) — client_id FK
  │     └── +task_source, +operator_phone
  └── tiktok_post (ALTERED) — client_id FK
        └── +task_source, +operator_phone

operator_registration_sessions (NEW, standalone)
  └── phone_number PK, no FK (operators not yet registered)
```

---

## Validation Rules

| Field | Rule |
|---|---|
| `operators.phone_number` | Strip `@s.whatsapp.net` suffix; numeric string only |
| `client_config.config_value` | Non-empty string |
| `operator_registration_sessions.stage` | Must be `'awaiting_confirmation'` or `'awaiting_satker_choice'` |
| `insta_post.task_source` | If set, must be `'broadcast_wa'` |
| `client_config.client_id` | Must exist in `clients(client_id)` |

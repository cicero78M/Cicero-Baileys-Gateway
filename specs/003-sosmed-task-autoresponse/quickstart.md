# Quickstart: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Feature**: `003-sosmed-task-autoresponse`  
**Branch**: `003-sosmed-task-autoresponse`

---

## Prerequisites

- Node.js ≥ 20
- PostgreSQL running (local or Docker)
- Redis running (local or Docker)
- `.env` file configured (copy `.env.example` and fill in `DB_*`, `REDIS_URL`, `RAPIDAPI_KEY`)
- All dependencies installed: `npm install`
- Migrations from `001-wa-complaint-task-autoresponse` already applied (or apply all from scratch via `sql/schema.sql`)

---

## 1. Apply Database Migrations

Run migrations **in order**:

```bash
node scripts/run_migration.js sql/migrations/20260325_001_client_default_sentinel.sql
node scripts/run_migration.js sql/migrations/20260325_002_create_client_config.sql
node scripts/run_migration.js sql/migrations/20260325_003_create_operators.sql
node scripts/run_migration.js sql/migrations/20260325_004_create_operator_registration_sessions.sql
node scripts/run_migration.js sql/migrations/20260325_005_alter_insta_post_task_columns.sql
node scripts/run_migration.js sql/migrations/20260325_006_alter_tiktok_post_task_columns.sql
node scripts/run_migration.js sql/migrations/20260325_007_seed_client_config_defaults.sql
```

Verify:

```sql
-- Should return 13 rows
SELECT config_key FROM client_config WHERE client_id = 'DEFAULT';

-- Should return the sentinel
SELECT client_id, client_status FROM clients WHERE client_id = 'DEFAULT';
```

---

## 2. Configure a Test Client

Insert a test client and its group config:

```sql
-- Insert a test client (skip if already exists)
INSERT INTO clients (client_id, nama, client_status, client_group)
VALUES ('TEST_SATKER', 'Satker Test', TRUE, '628123456789-123456789@g.us')
ON CONFLICT DO NOTHING;

-- Override client_group_jid for this client
INSERT INTO client_config (client_id, config_key, config_value)
VALUES ('TEST_SATKER', 'client_group_jid', '628123456789-123456789@g.us')
ON CONFLICT (client_id, config_key) DO UPDATE SET config_value = EXCLUDED.config_value;
```

---

## 3. Register a Test Operator

Either let the bot auto-register via DM (see Step 6), or manually insert:

```sql
INSERT INTO operators (phone_number, client_id, satker_name)
VALUES ('628123456789', 'TEST_SATKER', 'Satker Test')
ON CONFLICT (phone_number) DO UPDATE
  SET client_id = EXCLUDED.client_id, satker_name = EXCLUDED.satker_name, is_active = TRUE;
```

---

## 4. Start the Gateway

```bash
# Development (with nodemon)
npm run dev

# Production
node app.js
```

Wait for log output:
```
{"level":"info","msg":"WA client ready","client_id":"..."}
```

---

## 5. Test: Broadcast from Registered Group

Send from a WhatsApp number registered as operator to the configured group:

```
Selamat pagi, mohon izin dibantu untuk like dan comment postingan berikut:
https://www.instagram.com/reel/AbCdEfGhIjK/
```

**Expected bot responses** (3 messages in sequence):
1. Ack message
2. Status summary with engagement data
3. Task recap detail

**Expected DB state**:
```sql
SELECT shortcode, task_source, operator_phone
FROM insta_post
WHERE task_source = 'broadcast_wa'
ORDER BY created_at DESC LIMIT 5;
```

---

## 6. Test: Self-Registration Flow

Send from an **unregistered** number to the bot's DM:

```
Selamat pagi, mohon izin dibantu untuk like postingan ini:
https://www.instagram.com/reel/AbCdEfGhIjK/
```

**Expected dialog**:
1. Bot replies with confirmation prompt
2. Reply `ya`
3. Bot sends numbered satker list
4. Reply with the number of your satker
5. Bot confirms registration and processes original broadcast

**Verify**:
```sql
SELECT phone_number, client_id, satker_name, is_active
FROM operators
WHERE phone_number = '62XXXXXXXXXX';
```

---

## 7. Run Tests and Lint

```bash
npm run lint
npm test
```

All existing tests must pass. New tests for this feature are in:
- `tests/clientConfigRepository.test.js`
- `tests/operatorRepository.test.js`
- `tests/operatorRegistrationSessionRepository.test.js`
- `tests/clientConfigService.test.js`
- `tests/operatorRegistrationService.test.js`
- `tests/waAutoSosmedTaskService.test.js` (updated)

---

## 8. Docker Compose

To run the full stack with Docker:

```bash
docker-compose up -d --build
```

Apply migrations inside the container:

```bash
docker-compose exec app node scripts/run_migration.js sql/migrations/20260325_001_client_default_sentinel.sql
# repeat for all 7 migrations...
```

# Tasks: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Feature**: `003-sosmed-task-autoresponse`  
**Input**: `specs/003-sosmed-task-autoresponse/` — plan.md, spec.md, data-model.md, contracts/wa-message-contract.md, research.md, quickstart.md  
**Branch**: `003-sosmed-task-autoresponse`  
**Date**: 2026-03-25

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete-task dependencies)
- **[US1]**: User Story 1 — Bot Merespons Broadcast Tugas Sosmed dari Grup (P1)
- **[US2]**: User Story 2 — Self-Registrasi Operator via Broadcast Tugas (P1)
- All paths relative to repository root

---

## Phase 1: Setup

**Purpose**: Branch + prerequisite verification before any code is written

- [ ] T001 Checkout branch `003-sosmed-task-autoresponse` and verify Node.js ≥ 20, PostgreSQL, and Redis are reachable; confirm `npm install` is clean per quickstart.md prerequisites
- [ ] T001b Add `options: '-c timezone=Asia/Jakarta'` to the pg Pool config in `src/db/postgres.js` — ensures all DB connections use Jakarta timezone so `NOW()` returns WIB and `TIMESTAMPTZ` values are serialized as WIB; verify by running `SELECT NOW()` via pool and checking the offset is `+07:00`

**Checkpoint**: Environment confirmed — database migration phase can begin

---

## Phase 2: Foundational — Database Layer

**Purpose**: All 7 schema migrations + schema.sql sync. Must complete before any JS code can be written or tested (repositories depend on these tables/columns).

**⚠️ CRITICAL**: No repository or service work can begin until T002–T009 are complete and all migrations are applied.

- [ ] T002 Create `sql/migrations/20260325_001_client_default_sentinel.sql` — `INSERT INTO clients (client_id, nama, client_status) VALUES ('DEFAULT', 'DEFAULT CONFIG SENTINEL', FALSE) ON CONFLICT (client_id) DO NOTHING`
- [ ] T003 [P] Create `sql/migrations/20260325_002_create_client_config.sql` — `CREATE TABLE IF NOT EXISTS client_config` with `id SERIAL PK`, `client_id VARCHAR(100) NOT NULL REFERENCES clients(client_id)`, `config_key VARCHAR(100) NOT NULL`, `config_value TEXT NOT NULL`, `description TEXT`, `created_at`/`updated_at TIMESTAMPTZ DEFAULT NOW()`, `UNIQUE(client_id, config_key)`, index `idx_client_config_client_id` (note: table creation does not require the T002 sentinel row — only T008 seed INSERT does; T003 can run in parallel with T004–T007)
- [ ] T004 [P] Create `sql/migrations/20260325_003_create_operators.sql` — `CREATE TABLE IF NOT EXISTS operators` with `phone_number VARCHAR(30) PK`, `client_id VARCHAR(100) NOT NULL REFERENCES clients(client_id)`, `satker_name VARCHAR(200) NOT NULL`, `registered_at TIMESTAMPTZ DEFAULT NOW()`, `is_active BOOLEAN DEFAULT TRUE`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`; indices `idx_operators_client_id` and `idx_operators_is_active`
- [ ] T005 [P] Create `sql/migrations/20260325_004_create_operator_registration_sessions.sql` — `CREATE TABLE IF NOT EXISTS operator_registration_sessions` with `phone_number VARCHAR(30) PK`, `stage VARCHAR(30) NOT NULL`, `original_message TEXT NOT NULL`, `expires_at TIMESTAMPTZ NOT NULL`, `attempt_count SMALLINT DEFAULT 1`, `first_attempt_at TIMESTAMPTZ DEFAULT NOW()`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`; index `idx_op_sessions_expires_at`
- [ ] T006 [P] Create `sql/migrations/20260325_005_alter_insta_post_task_columns.sql` — `ALTER TABLE insta_post ADD COLUMN IF NOT EXISTS task_source VARCHAR(30) DEFAULT NULL, ADD COLUMN IF NOT EXISTS operator_phone VARCHAR(30) DEFAULT NULL` with COMMENT on each column
- [ ] T007 [P] Create `sql/migrations/20260325_006_alter_tiktok_post_task_columns.sql` — `ALTER TABLE tiktok_post ADD COLUMN IF NOT EXISTS task_source VARCHAR(30) DEFAULT NULL, ADD COLUMN IF NOT EXISTS operator_phone VARCHAR(30) DEFAULT NULL` with COMMENT on each column
- [ ] T008 Create `sql/migrations/20260325_007_seed_client_config_defaults.sql` — `INSERT INTO client_config ... ON CONFLICT (client_id, config_key) DO NOTHING` for all 13 DEFAULT rows: `broadcast_trigger_keywords`, `broadcast_action_keywords`, `broadcast_required_phrase`, `operator_unregistered_prompt`, `operator_satker_list_header`, `operator_registration_ack`, `operator_registration_declined`, `operator_invalid_choice`, `operator_no_satker`, `operator_session_ttl_seconds`, `operator_registration_max_attempts`, `operator_registration_cooldown_minutes`, `task_input_ack` (depends on T003)
- [ ] T009 Apply all 7 migrations in order using `node scripts/run_migration.js` per quickstart.md Section 1; verify: `SELECT COUNT(*) FROM client_config WHERE client_id = 'DEFAULT'` returns 13; `SELECT client_id FROM clients WHERE client_id = 'DEFAULT'` returns row
- [ ] T009b Sync `sql/schema.sql` canonical schema immediately after migrations: add `client_config`, `operators`, `operator_registration_sessions` table definitions; add `task_source` and `operator_phone` columns to `insta_post` and `tiktok_post`; add all new indices (Constitution VI: MUST be kept in sync with applied migrations)

**Checkpoint**: Database schema ready — all 3 repository files can now be implemented

---

## Phase 3: User Story 1 — Bot Merespons Broadcast Tugas Sosmed dari Grup (Priority: P1) 🎯 MVP

**Goal**: Bot detects a broadcast tugas message sent to a registered client group, records all IG/TikTok URLs to DB, and sends **one hardcoded ack** (Response A) within ≤ 5 seconds. **No live fetch on the group path.** All config from `client_config` table; group ack text hardcoded per FR-006a.

**Independent Test**: Send a message matching Contract 1 (salam waktu + "mohon izin dibantu" + aksi keyword + IG/TikTok URL) to the configured test group JID. Verify: (1) bot replies with **Response A only** (hardcoded ack text with date + URL count); (2) `insta_post` / `tiktok_post` rows with `task_source = 'broadcast_wa'` inserted; (3) **no** live fetch calls made and **no** Response B/C sent from group path.

### Tests for User Story 1

- [ ] T010 [P] [US1] Create `tests/clientConfigRepository.test.js` — test `getConfigValue` cache miss returns null, hit returns value; `getConfigValueWithDefault` falls back to `client_id='DEFAULT'` when per-client row absent; `setConfigValue` executes parameterized upsert INSERT ... ON CONFLICT DO UPDATE; all DB pool calls mocked
- [ ] T011 [P] [US1] Create `tests/clientConfigService.test.js` — test cache hit avoids DB call on second access within 60s TTL; cache miss triggers `clientConfigRepository.getConfigValueWithDefault` and stores result; TTL expiry (mock `Date.now`) forces re-fetch; expired entries are removed by proactive eviction `setInterval` (assert `cache.size` shrinks after sweep interval fires); `getConfigOrDefault` returns fallback string when DB returns null; `resolveClientIdForGroup` queries `client_config` for `config_key='client_group_jid'` first, falls back to `clients.client_group` query; both DB calls mocked; use `jest.useFakeTimers()` to trigger eviction sweep deterministically (`jest.advanceTimersByTime(120_001)`); call `stopCacheEviction()` in `afterEach` to clear the interval and prevent test suite hangs
- [ ] T011b [P] [US1] Create `src/utils/broadcastMatcher.js` (ESM) — export `buildKeywordRegex(keywords)` (returns `/\b(word1|word2)\b/i` pattern from CSV string); export `hasAllKeywords(text, keywordsCsv)` (returns bool); export `hasAnyKeyword(text, keywordsCsv)` (returns bool); all regex operations case-insensitive with whole-word boundary (`\b`); no external dependencies; create `tests/broadcastMatcher.test.js` — test `buildKeywordRegex` produces correct regex pattern from CSV; `hasAllKeywords` returns true only when all words present; `hasAnyKeyword` returns true when any word present; boundary tests (partial word match MUST NOT trigger)
- [ ] T011c [P] [US1] Create `src/service/sosmedBroadcastParser.js` (ESM) — export `isBroadcastMessage(text, config)` (checks salam waktu keywords + `broadcast_required_phrase` + ≥1 action keyword using `broadcastMatcher.js` helpers, returns bool); export `extractUrls(text)` → `{ igUrls: string[], tiktokUrls: string[] }` (extracts Instagram URLs matching `instagram\.com|ig\.me` and TikTok URLs matching `tiktok\.com|vm\.tiktok\.com` via regex; non-platform URLs ignored per FR-007); export `formatDate(dateObj)` (returns Indonesian long-form date e.g. `"Selasa, 25 Maret 2026"`); create `tests/sosmedBroadcastParser.test.js` — test: `isBroadcastMessage` returns `true` for valid broadcast text, `false` when missing salam/phrase/action/URL; `extractUrls` captures IG + TikTok URLs, ignores other URLs (FR-007), handles mixed URL message; `formatDate` returns correct Indonesian day and month names; all imports mocked

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create `src/repository/clientConfigRepository.js` (ESM) — export `getConfigValue(pool, clientId, configKey)` (SELECT single row, return string or null), `getConfigValueWithDefault(pool, clientId, configKey)` (try clientId first, fallback to 'DEFAULT', return value or null), `setConfigValue(pool, clientId, configKey, configValue)` (INSERT ... ON CONFLICT (client_id, config_key) DO UPDATE SET config_value, updated_at); all queries parameterized (`$1`, `$2`)
- [ ] T013 [P] [US1] Create `src/service/clientConfigService.js` (ESM) — in-memory `Map<\`${clientId}:${configKey}\`, { value, expiresAt }>` cache with 60s lazy TTL + proactive `setInterval(() => { for (const [k,v] of cache) if (Date.now() > v.expiresAt) cache.delete(k); }, 120_000)` eviction to prevent unbounded growth; export `getConfig(clientId, configKey)` (check cache → DB on miss → store with `expiresAt = Date.now() + 60_000` → return value); export `getConfigOrDefault(clientId, configKey, fallback)` (wraps `getConfig`, returns fallback if null); export `resolveClientIdForGroup(groupJid)` (SELECT `client_id` FROM `client_config` WHERE `config_key='client_group_jid'` AND `config_value=$1`; fallback SELECT `client_id` FROM `clients` WHERE `client_group=$1 AND client_status=TRUE`); import pool from `src/db/`; export `stopCacheEviction()` → calls `clearInterval(evictionHandle)` — required for Jest test teardown to prevent timer leaks
- [ ] T014 [US1] Refactor group broadcast path in `src/service/waAutoSosmedTaskService.js` — update handler signature to `handleAutoSosmedTaskMessageIfApplicable({ text, chatId, senderPhone, messageKey, waClient })`; update all call sites in `src/handler/` to pass `{ text, chatId, senderPhone, messageKey, waClient }`; at handler entry (when `messageKey` is non-null) call `await waClient.readMessages([messageKey])` + `await new Promise(r => setTimeout(r, 1000))` before any processing branch (FR-009 seen-marking); add `status@broadcast` early-return guard (FR-010); add `isGroup = chatId.endsWith('@g.us')` routing; in group path: call `resolveClientIdForGroup(chatId)` imported from `clientConfigService.js` (T013 must be complete first), if no `clientId` log warn and return; replace `AUTO_TASK_CLIENT_ID` hardcode; replace all `waClient.sendMessage(chatId, ...)` calls with `enqueueSend(jid, { text })` from `src/service/waOutbox.js`; add `recordTasksToDB` function writing to `insta_post`/`tiktok_post` with `task_source='broadcast_wa'` and `operator_phone`; **group path only**: call `extractUrls(text)` (from `sosmedBroadcastParser.js`) → `recordTasksToDB(igUrls, tiktokUrls, clientId)` → `enqueueSend(groupJid, hardcodedAckText)` where `hardcodedAckText = \`Ack! Tugas broadcast sosmed ${formattedDate} berhasil direkam. ${n} URL telah dicatat.\``; **no live fetch, no Response B/C on group path**; DM registered operator live fetch is handled in T022 (depends on T011c, T012, T013)
- [ ] T015 [US1] Add pino logger instrumentation to group path in `src/service/waAutoSosmedTaskService.js` — `logger.info` on handler entry with `{ senderPhone, chatId, isGroup, instagramUrls, tiktokUrls }`; `logger.warn` when `clientId` not resolved; `logger.error({ err })` on DB insert failure; remove any `console.log` in production paths (FR-020)

**Checkpoint**: User Story 1 fully functional — registered group broadcasts receive **1 hardcoded ack** (Response A); URLs recorded in DB; no live fetch on group path

---

## Phase 4: User Story 2 — Self-Registrasi Operator via Broadcast Tugas (Priority: P1)

**Goal**: An unregistered number sending a broadcast-format message via DM triggers a 3-step interactive registration dialog (confirmation → satker choice → registered). After successful registration, the original broadcast is automatically reprocessed. Registered operators sending DM broadcasts have tasks recorded and receive ack only (no group recap).

> **Response labels D–I** referenced in this phase are defined in [`contracts/wa-message-contract.md`](./contracts/wa-message-contract.md).

**Independent Test**: (1) Send broadcast format from unregistered DM → bot replies with confirmation prompt (Response D). (2) Reply `ya` → bot sends numbered satker list (Response E). (3) Reply with valid satker number → bot confirms registration (Response F) and auto-processes original broadcast (task recorded in `insta_post`/`tiktok_post`). Verify: `SELECT phone_number, client_id FROM operators WHERE phone_number = '62XXXXXXXXXX'` returns row; `SELECT task_source FROM insta_post ORDER BY created_at DESC LIMIT 1` returns `'broadcast_wa'`.

### Tests for User Story 2

- [ ] T016 [P] [US2] Create `tests/operatorRepository.test.js` — test `findActiveOperatorByPhone` returns row when found and active, returns null when not found, returns null when `is_active=FALSE`; `upsertOperator` executes INSERT ON CONFLICT DO UPDATE and maps all columns; all DB pool calls mocked
- [ ] T017 [P] [US2] Create `tests/operatorRegistrationSessionRepository.test.js` — test `findActiveSession` returns row when `expires_at > NOW()`, returns null when expired or absent; `upsertSession(pool, phone, stage, msg, ttl, cooldownMinutes)` increments `attempt_count` when within cooldown window, resets `attempt_count=1`+`first_attempt_at=NOW()` when window has expired; `isRateLimited` returns true when `attempt_count >= max AND within cooldown window`, false when window expired; `purgeExpiredSessions` executes DELETE WHERE expires_at <= NOW(); all DB pool calls mocked
- [ ] T018 [P] [US2] Create `tests/operatorRegistrationService.test.js` — test `handleUnregisteredBroadcast` silently returns without `enqueueSend` when rate-limited; when not rate-limited calls `upsertSession` and `enqueueSend` with prompt D; `handleRegistrationDialog` stage `awaiting_confirmation` with each ya-token (`ya`,`iya`,`yes`,`y`,`ok`,`okay`,`setuju`,`benar`,`betul`,`daftar`) advances to `awaiting_satker_choice` **and sends Response E (satker list)**; with each tidak-token (`tidak`,`no`,`batal`,`cancel`,`n`,`stop`,`tolak`) deletes session and sends Response G; test ≥ 2 ya-variants and ≥ 2 tidak-variants explicitly; stage `awaiting_satker_choice` with valid index calls `upsertOperator`, deletes session, sends Response F, calls injected `replayBroadcast` callback; with invalid index resends Response H + Response E; stage `awaiting_satker_choice` when `clients WHERE client_status=TRUE` returns 0 rows → `enqueueSend` called with `operator_no_satker` config value (Response I); `resolveClientIdForGroup` test in `clientConfigService.test.js` (T011); all dependencies mocked

### Implementation for User Story 2

- [ ] T019 [P] [US2] Create `src/repository/operatorRepository.js` (ESM) — export `findActiveOperatorByPhone(pool, phoneNumber)` (SELECT WHERE phone_number=$1 AND is_active=TRUE, return row or null); export `upsertOperator(pool, phoneNumber, clientId, satkerName)` (INSERT ON CONFLICT phone_number DO UPDATE SET client_id, satker_name, registered_at=NOW(), updated_at=NOW(), is_active=TRUE); all queries parameterized
- [ ] T020 [P] [US2] Create `src/repository/operatorRegistrationSessionRepository.js` (ESM) — export `findActiveSession(pool, phoneNumber)` (SELECT WHERE phone_number=$1 AND expires_at > NOW(), return row or null); export `upsertSession(pool, phoneNumber, stage, originalMessage, ttlSeconds, cooldownMinutes)` (INSERT ON CONFLICT phone_number DO UPDATE SET stage, expires_at=NOW()+interval, `updated_at=NOW()`; if `NOW()-first_attempt_at >= cooldown_interval`: reset `attempt_count=1` and `first_attempt_at=NOW()`, else increment `attempt_count`); export `deleteSession(pool, phoneNumber)` (DELETE WHERE phone_number=$1); export `isRateLimited(pool, phoneNumber, maxAttempts, cooldownMinutes)` (check attempt_count >= max AND NOW()-first_attempt_at < cooldown interval, return boolean); export `purgeExpiredSessions(pool)` (DELETE WHERE expires_at <= NOW())
- [ ] T021 [US2] Create `src/service/operatorRegistrationService.js` (ESM) — implement 3-state dialog machine per research.md Decision 4; **no import of `waAutoSosmedTaskService`** (FR-018: replay is handled via `replayBroadcast` callback injected by the caller); export `handleUnregisteredBroadcast(phoneNumber, rawText, enqueueSend)` (fetch `cooldownMinutes` + `maxAttempts` + `ttl` from `getConfig('DEFAULT', ...)` → check `isRateLimited(pool, phone, maxAttempts, cooldownMinutes)` → log warn + return if limited; else `upsertSession(phone, 'awaiting_confirmation', rawText, ttl, cooldownMinutes)` + `enqueueSend(phone@s.whatsapp.net, { text: getConfig('DEFAULT','operator_unregistered_prompt') })`); export `handleRegistrationDialog(phoneNumber, replyText, enqueueSend, replayBroadcast)` (load session, route by stage; `awaiting_confirmation`: ya-tokens=`['ya','iya','yes','y','ok','okay','setuju','benar','betul','daftar']`, tidak-tokens=`['tidak','no','batal','cancel','n','stop','tolak']` case-insensitive (per Contract 2) → **advance+send E (satker list)** or decline+send G; `awaiting_satker_choice`: parse integer, validate against `SELECT clients WHERE client_status=TRUE ORDER BY nama`, on success: `upsertOperator` + `deleteSession` + send F + `await replayBroadcast(session.original_message)`; on empty list: send Response I (`getConfig('DEFAULT','operator_no_satker')`); on invalid: send H + resend E); depends on T019, T020
- [ ] T022 [US2] Extend DM routing in `src/service/waAutoSosmedTaskService.js` — wire DM path using services from T021: check `findActiveSession(senderPhone)` → call `handleRegistrationDialog`; else check `findActiveOperatorByPhone(senderPhone)` → `extractUrls(text)` → **`liveFetchAll(urls)` using `Promise.allSettled([...urls.map(url => withTimeout(fetchFn(url), 8000))])`** (8s timeout per URL; rejected/timed-out = "data tidak tersedia"; other URLs proceed uninterrupted) → `recordTasksToDB(igUrls, tiktokUrls, clientId, senderPhone)` → `enqueueSend(dmJid, engagementRecap)` **(Response B)** → `enqueueSend(dmJid, taskInputAck)` **(Response C**, `task_input_ack` config value with `{client_id}` interpolated via `configValue.replace('{client_id}', resolvedClientId)`); else → `handleUnregisteredBroadcast`; wire `purgeExpiredSessions(pool)` call to gateway startup in `app.js` — DB-only call, no WA dependency, safe to run before WA `ready` event (once at boot, log `{ purged: N }` at `info` level per Constitution V); add pino `logger.info`/`logger.warn`/`logger.error` for all DM path branches per FR-020 (depends on T014, T021)
- [ ] T023 [US2] Extend `tests/waAutoSosmedTaskService.test.js` — add test cases: `status@broadcast` chatId returns without processing; non-broadcast format text returns without processing; group valid JID → `resolveClientIdForGroup` resolves → **exactly 1 `enqueueSend` call** with hardcoded ack text containing formatted date and URL count + `recordTasksToDB` called; **no** live fetch calls, **no** Response B or C from group path; group unknown JID → `logger.warn` + no `enqueueSend`; DM registered operator → `findActiveOperatorByPhone` found → `recordTasksToDB` + **2 `enqueueSend` calls** (Response B engagement recap + Response C `task_input_ack`); verify Response B contains per-URL fetch results; DM unregistered no session → `handleUnregisteredBroadcast` called; DM with active session → `handleRegistrationDialog` called with injected `replayBroadcast` callback; DM from rate-limited number → `handleUnregisteredBroadcast` called → verify 0 `enqueueSend` calls (FR-019); all service/repository dependencies mocked (depends on T022)

**Checkpoint**: Both user stories fully functional and independently testable

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Schema sync, lint, test suite validation, and quickstart verification

- [ ] T024 ~~Update `sql/schema.sql`~~ — **superseded by T009b**; confirm T009b was completed in Phase 2 — if so, no action needed here. If T009b was skipped, apply schema.sql sync at this point.
- [ ] T025 [P] Run `npm run lint` — fix any ESLint errors or warnings in all new files (`clientConfigRepository.js`, `operatorRepository.js`, `operatorRegistrationSessionRepository.js`, `clientConfigService.js`, `operatorRegistrationService.js`) and modified file (`waAutoSosmedTaskService.js`); ensure no `console.log` present in production paths
- [ ] T026 Run `npm test` — verify all pre-existing tests pass plus all 6 new test files pass; confirm mocks for `pg` pool, `enqueueSend`, and API calls are in place; address any test isolation issues
- [ ] T027 [P] Execute quickstart.md end-to-end validation — apply all 7 migrations (Section 1), configure test client + operator (Sections 2–3), start gateway (Section 4), test group broadcast (Section 5), test self-registration flow (Section 6); verify DB state matches expected queries; also verify BullMQ jobs are durable through simulated `waClient` disconnect+reconnect cycle (SC-003)
- [ ] T028 [P] SC-001 latency validation — profile both broadcast paths using mock handlers; assert group path: **1 `enqueueSend` call** submitted within 5s (SC-001a); assert DM path (mock 8s fetch): **2 `enqueueSend` calls** (Response B + C) submitted within 15s total (SC-001b); document latency budget in quickstart.md Section 5

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user story phases**
- **US1 (Phase 3)**: Depends on Phase 2 (migrations applied, tables exist)
- **US2 (Phase 4)**: Depends on Phase 2 (migrations applied); can be worked in parallel with Phase 3 on separate files, but T022 depends on T014 (US1 group path) for the `resolveClientIdForGroup` integration
- **Polish (Phase 5)**: Depends on Phases 3 + 4 both complete

### User Story Dependencies

- **US1 (Phase 3)**: No dependency on US2 — implementations touch different files (`clientConfigRepository.js`, `clientConfigService.js`, group path of `waAutoSosmedTaskService.js`)
- **US2 (Phase 4)**: Independent from US1 for repositories and service (`operatorRepository.js`, `operatorRegistrationSessionRepository.js`, `operatorRegistrationService.js`); T022 integrates with T014's `waAutoSosmedTaskService.js` group path — coordinate file ownership

### Within Each Phase

- Tests (T010–T011, T016–T018) are written before or alongside implementation
- Repositories (T012, T019, T020) before services (T013, T021)
- Services before handler integration (T014, T022)
- Handler integration before full test extension (T023)

---

## Parallel Opportunities

### Phase 2 (Foundational) — Parallel within phase

```
T002 (sentinel) → T003 T004 T005 T006 T007 (all parallel, different files)
               → T008 (needs T003 for FK) → T009 (apply all) → T009b (schema.sql sync)
```

### Phase 3 — Parallel within US1

```
T010 T011 T011b T011c T012 T013 (all parallel — different files)
→ T014 (needs T011c T012 T013 complete)
→ T015 (extends T014, can overlap if on same file with coordination)
```

### Phase 4 — Parallel within US2

```
T016 T017 T018 T019 T020 (all parallel — different files, all mocked)
→ T021 (needs T019 T020)
→ T022 (needs T014 + T021)
→ T023 (needs T022)
```

### Phase 5 — Parallel

```
T024 T025 T027 (parallel)
→ T026 (needs T024 T025 to be complete first for accurate results)
```

---

## Implementation Strategy

**MVP Scope**: Phase 1 + Phase 2 + Phase 3 = US1 (group broadcast recap) is the minimum deliverable. This unblocks the core business value (real-time engagement recap) while US2 (operator registration) is a parallel track.

**Recommended execution order if single developer**:
1. Phases 1 → 2 (sequential, blocking)
2. Phase 3 US1: T011b → T011c → T012 → T013 → T014 → T015 (then tests T010, T011)
3. Phase 4 US2: T019 → T020 → T021 → T022 → T023 (then tests T016, T017, T018)
4. Phase 5: T024 → T025 → T026 → T027 (parallel with T028)

**Recommended execution order if two developers**:
- Dev A: Phases 1–2, then Phase 3 (US1)
- Dev B: Phases 1–2 (wait), then Phase 4 US2 repositories + service (T019–T021) in parallel with Dev A's Phase 3; coordinate T022 handoff

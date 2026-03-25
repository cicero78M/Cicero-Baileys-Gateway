# Implementation Plan: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Branch**: `003-sosmed-task-autoresponse` | **Date**: 2026-03-25 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/003-sosmed-task-autoresponse/spec.md`

## Summary

Build an auto-response system that detects WhatsApp broadcast messages containing social media task instructions (like/comment/share, IG/TikTok URLs). Group path records URLs to DB and sends a hardcoded ack. DM path from registered operators performs live fetch engagement via existing `instagramApi.js`/`tiktokApi.js` and sends a full recap. DM from unregistered numbers triggers a 3-step interactive registration dialog, then replays the original broadcast. All new DB state (config, operators, sessions) is PostgreSQL-backed; all outbound messages go through `waOutbox.js` (BullMQ).

## Technical Context

**Language/Version**: Node.js 22 ESM (`import`/`export`)  
**Primary Dependencies**: Baileys (WA), BullMQ + Redis (outbox), pg (PostgreSQL), pino (logging), Jest (tests)  
**Storage**: PostgreSQL — new tables `client_config`, `operators`, `operator_registration_sessions`; altered `insta_post` + `tiktok_post`  
**Testing**: Jest, Node.js v20+; all I/O mocked (no live API or DB calls in tests)  
**Target Platform**: Linux server (Docker)  
**Project Type**: WhatsApp auto-response gateway (single-process Node.js service)  
**Performance Goals**: Group ack ≤ 5s; DM recap ≤ 15s (includes live fetch with 8s timeout per URL)  
**Constraints**: ESM only; no `console.log` in production paths; BullMQ outbox for all outbound; parameterised SQL only  
**Scale/Scope**: Single WA client serving all registered group JIDs + DM registration flow

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Layered Architecture | All business logic in `src/service/`; DB in `src/repository/`; handler delegates to service | ✅ PASS |
| II. Naming Conventions | New files follow `camelCase`; DB columns `snake_case`; boolean helpers prefixed `is`/`has` | ✅ PASS |
| III. Test Coverage | All new services, repositories, handlers ship with Jest unit tests; no live I/O in tests | ✅ PASS |
| IV. Security-First | SQL parameterised; no secrets hardcoded; input validated (phone number strip, URL pattern match) | ✅ PASS |
| V. Observability | pino used throughout; no `console.log` in production; all errors caught + logged with `err` object | ✅ PASS |
| VI. DB & Migration Discipline | 7 versioned migration files; idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`); `created_at`/`updated_at` on all tables | ✅ PASS |
| VII. WA Gateway Reliability | All outbound via `waOutbox.js`; handlers idempotent via dedup; no memory-unbounded structures | ✅ PASS |
| VIII. Simplicity & YAGNI | No new dependencies; config cache is in-memory Map (no extra Redis layer); group ack hardcoded (no unnecessary config key) | ✅ PASS |

**Security Requirements**:

| Concern | Control Applied |
|---|---|
| SQL injection | Parameterised queries (`$1`, `$2`) in all repositories |
| Input validation | Phone number regex-stripped; URL platform-checked before DB insert |
| Hardcoded secrets | None — all credentials via `src/config/env.js` |
| WA deduplication | `waEventAggregator` deduplicates incoming events before handler |

**Violations**: None. No complexity justification table needed.

## Project Structure

### Documentation (this feature)

```text
specs/003-sosmed-task-autoresponse/
├── plan.md              ← this file
├── research.md          ← decision log (updated)
├── data-model.md        ← schema + migrations
├── quickstart.md        ← dev setup guide
├── contracts/
│   └── wa-message-contract.md   ← inbound/outbound message schemas
└── tasks.md             ← Phase 2 output (from /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── handler/
│   └── fetchabsensi/
│       └── sosmedTask.js          ← MODIFY: main WA message handler (entry point)
├── service/
│   ├── waAutoSosmedTaskService.js ← MODIFY: refactor group + DM routing, outbox, pino
│   ├── clientConfigService.js     ← CREATE: read client_config with 60s in-mem cache
│   ├── operatorRegistrationService.js  ← CREATE: registration dialog orchestration
│   └── sosmedBroadcastParser.js   ← CREATE: keyword detection + URL extraction
├── repository/
│   ├── clientConfigRepository.js  ← CREATE: DB access for client_config
│   ├── operatorRepository.js      ← CREATE: DB access for operators
│   └── operatorSessionRepository.js ← CREATE: DB access for operator_registration_sessions
├── utils/
│   └── broadcastMatcher.js        ← CREATE: keyword regex helpers (whole-word, case-insensitive)
sql/
└── migrations/
    ├── 20260325_001_client_default_sentinel.sql
    ├── 20260325_002_create_client_config.sql
    ├── 20260325_003_create_operators.sql
    ├── 20260325_004_create_operator_registration_sessions.sql
    ├── 20260325_005_alter_insta_post_task_columns.sql
    ├── 20260325_006_alter_tiktok_post_task_columns.sql
    └── 20260325_007_seed_client_config_defaults.sql
tests/
├── sosmedBroadcastParser.test.js  ← unit: keyword + URL extraction
├── clientConfigService.test.js    ← unit: cache + DB fallback + DEFAULT override
├── operatorRepository.test.js     ← unit: upsert, findActiveByPhone
├── operatorSessionRepository.test.js ← unit: create, findActive, delete, purgeExpired
├── operatorRegistrationService.test.js ← unit: dialog state machine transitions
└── waAutoSosmedTaskService.test.js ← unit: group path, DM registered path, replay
```

**Structure Decision**: Single-project Node.js ESM. Follows existing `src/` layered structure. All new files fit within existing layer directories \u2014 no new top-level folders needed.

---

## Architecture Overview

### Message Flow

```
baileysAdapter.js
  └─ messages.upsert event
       └─ waEventAggregator (dedup)
            └─ sosmedTask.js (handler — entry point)
                 ├─ [status@broadcast] → ignore
                 ├─ FR-009: markMessageSeen (skip if isReplay)
                 ├─ isBroadcastMessage() → broadcastMatcher.js
                 │    ├─ false → ignore / hand off to other handlers
                 │    └─ true →
                 │         ├─ isGroup (@g.us)?
                 │         │    ├─ not registered group → ignore
                 │         │    └─ registered group →
                 │         │         ├─ extractUrls() → [igUrls, ttUrls]
                 │         │         ├─ recordTasksToDb(igUrls, ttUrls, clientId) — insta_post / tiktok_post
                 │         │         └─ enqueueSend(groupJid, ackText)  ← Response A (hardcoded)
                 │         └─ isDM (@s.whatsapp.net)?
                 │              ├─ active registration session? → operatorRegistrationService.handleDialog()
                 │              │    ├─ stage=awaiting_confirmation → confirm/decline
                 │              │    └─ stage=awaiting_satker_choice → list / choose / register
                 │              │         └─ on success: upsertOperator() → DELETE session → replay(originalMsg, isReplay:true)
                 │              ├─ registered operator? →
                 │              │    ├─ extractUrls()
                 │              │    ├─ liveFetchAll(urls) via Promise.allSettled + 8s timeout
                 │              │    ├─ recordTasksToDb(igUrls, ttUrls, clientId, phone)
                 │              │    ├─ enqueueSend(dmJid, engagementRecap)   ← Response B
                 │              │    └─ enqueueSend(dmJid, taskAck)           ← Response C
                 │              └─ unregistered (no session) →
                 │                   ├─ INSERT session (PK guard for race condition)
                 │                   └─ enqueueSend(dmJid, registrationPrompt) ← Response D
```

### Handler Responsibilities

| File | Layer | Responsibility |
|---|---|---| 
| `sosmedTask.js` | handler | Entry point; routing decision; seen-marking; dedup guard |
| `waAutoSosmedTaskService.js` | service | Group-path orchestration; DM-path orchestration; live fetch coordination |
| `sosmedBroadcastParser.js` | service | `isBroadcastMessage(text, config)` → bool; `extractUrls(text)` → `{igUrls, ttUrls}` |
| `operatorRegistrationService.js` | service | Registration dialog state machine; rate-limit `attempt_count` check (FR-019) |
| `clientConfigService.js` | service | `getConfig(clientId, key)` → string; in-mem 60s cache with DEFAULT fallback |
| `broadcastMatcher.js` | utils | Regex builders for whole-word case-insensitive keyword matching |
| `clientConfigRepository.js` | repository | `findConfig(clientId, key)`, `listAll(clientId)` |
| `operatorRepository.js` | repository | `findActiveByPhone(phone)`, `upsertOperator(phone, clientId, satkerName)` |
| `operatorSessionRepository.js` | repository | `findActiveSession(phone)`, `createSession(...)`, `updateSession(...)`, `deleteSession(phone)`, `purgeExpiredSessions()` |

---

## Phase 0: Research

**Status**: ✅ Complete — see [research.md](research.md)

Key decisions:
1. Route by JID suffix (`@g.us` vs `@s.whatsapp.net`)
2. All outbound via `waOutbox.enqueueSend()`
3. Config cache: in-memory Map, 60s TTL, DEFAULT fallback
4. Registration state machine: 3 paths (registered / active session / unregistered)
5. `first_attempt_at` column added to sessions for FR-019 cooldown window
6. Task storage: `insta_post`/`tiktok_post` with `task_source='broadcast_wa'`
7. Constitution alignment: `created_at`/`updated_at` on all new tables
8. Refactor `waAutoSosmedTaskService.js` in-place
9. DM path: 2 sequential messages (recap + ack); group path: 1 hardcoded ack
10. Group ack hardcoded (not from `client_config`) — FR-016 exception documented
11. One `client_group_jid` per `client_id` — equality check
12. FR-018 replay: pass `originalMessage` as-is + `isReplay: true` flag
13. PII logging: full phone number, no masking (internal system)

---

## Phase 1: Design

**Status**: ✅ Complete

### Data Model
See [data-model.md](data-model.md) — 7 migrations, all idempotent.

### Contracts
See [contracts/wa-message-contract.md](contracts/wa-message-contract.md) — **9 outbound response schemas (A–I)**; 3 inbound trigger contracts.

**Key contract revision** (clarify pass 3):
- **Response A** (group): hardcoded ack + date + URL count. No engagement data.
- **Response B** (DM): full engagement recap with per-URL fetch result + participant list.
- **Response C** (DM): `task_input_ack` from `client_config` with `{client_id}` interpolated.
- Responses D–I: registration dialog chain (D = prompt, E = satker list, F = success, G = decline, H = invalid choice, I = no satker).

### Quickstart
See [quickstart.md](quickstart.md) — 7-step migration sequence, test client config, smoke test instructions.

---

## Phase 2: Tasks

**Status**: ⏳ Pending — generate via `/speckit.tasks`

See [tasks.md](tasks.md) for implementation tasks (to be generated).

**Anticipated task groupings**:
- Phase A: Database migrations (7 files)
- Phase B: Utility + parser layer (`broadcastMatcher.js`, `sosmedBroadcastParser.js`)
- Phase C: Repository layer (3 new repositories)
- Phase D: Service layer (`clientConfigService.js`, `operatorRegistrationService.js`, refactor `waAutoSosmedTaskService.js`)
- Phase E: Handler wiring (`sosmedTask.js`)
- Phase F: Unit tests (6 test files)
- Phase G: Integration / smoke test + lint gate

---

## Implementation Notes

### Critical Constraints for Implementors

1. **No live fetch from group path** — `instagramApi.js`/`tiktokApi.js` are never called when `isGroup === true`.
2. **All outbound via `enqueueSend`** — `waClient.sendMessage()` direct calls must be replaced in `waAutoSosmedTaskService.js`.
3. **Hardcoded group ack** — do not read this text from `client_config`; format: `Ack! Tugas broadcast sosmed {date} berhasil direkam. {n} URL telah dicatat.`
4. **`task_input_ack` DM-only** — only interpolate `{client_id}` on DM registered operator path.
5. **`client_group_jid` equality check** — `incomingJid === configuredJid` (not includes/array check).
6. **FR-018 replay** — call handler synchronously, pass `{ ...originalMsg }` with `isReplay: true` in context; skip `markMessageSeen` when `isReplay === true`.
7. **Race condition guard** — catch PG error code `23505` (unique violation) on session INSERT; log `logger.warn`; no duplicate response.
8. **Session lifecycle** — `DELETE` session row immediately on success or decline (not TTL wait); `purgeExpiredSessions` only cleans unanswered TTL-expired rows.
9. **Timezone** — `src/db/postgres.js` Pool already configured with `options: '-c timezone=Asia/Jakarta'`; no per-query timezone conversion needed.
10. **pino logging** — all log calls use `logger.info/warn/error` from `src/utils/logger.js`; phone numbers logged in full (no masking).

### Existing Files to Modify

| File | Change |
|---|---|
| `src/service/waAutoSosmedTaskService.js` | Add group/DM routing split; replace direct `sendMessage` with `enqueueSend`; remove hardcoded `AUTO_TASK_CLIENT_ID`; add pino logging |
| `src/handler/fetchabsensi/sosmedTask.js` | Add `isReplay` flag handling; integrate new service functions |
| `sql/schema.sql` | Add new table definitions to canonical schema (sync with migrations) |
| `app.js` | Call `purgeExpiredSessions(pool)` once at startup (imported from `operatorSessionRepository.js`); log `{ purged: N }` at `info` level per Constitution V — DB-only call, safe before WA `ready` event |

### New Files to Create

| File | Purpose |
|---|---|
| `src/utils/broadcastMatcher.js` | Whole-word regex helpers |
| `src/service/sosmedBroadcastParser.js` | Keyword detection + URL extraction |
| `src/service/clientConfigService.js` | Config cache + DEFAULT fallback |
| `src/service/operatorRegistrationService.js` | Registration state machine |
| `src/repository/clientConfigRepository.js` | `client_config` DB access |
| `src/repository/operatorRepository.js` | `operators` DB access |
| `src/repository/operatorSessionRepository.js` | `operator_registration_sessions` DB access |
| `sql/migrations/20260325_001-007_*.sql` | 7 migration files per data-model.md |


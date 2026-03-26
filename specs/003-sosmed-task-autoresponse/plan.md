# Implementation Plan: WhatsApp Gateway — Input Tugas Post Sosmed via Pesan WA

**Branch**: `003-sosmed-task-autoresponse` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-sosmed-task-autoresponse/spec.md`

**Note**: The core service (`waAutoSosmedTaskService.js`) and registration flow (`operatorRegistrationService.js`) were implemented in 5 prior phases. This plan covers the **delta** between that implementation and the clarified spec (FR-021 and FR-002/FR-005/FR-006b edge cases). Only 5 gaps require new code; all design artifacts are complete.

## Summary

Auto-detect WhatsApp broadcast-format messages containing IG/TikTok URLs, record tasks to PostgreSQL, live-fetch engagement (likes/comments), and reply to registered operators with a 3-message DM sequence (engagement recap → ack → today's task list). Group clients receive a single ack only. Unregistered senders enter a 3-step self-registration dialog; the original broadcast is replayed on completion.

**Delta scope** (clarification pass — 2026-03-26): (1) URL cap at 10 per broadcast, (2) group zero-URL silence, (3) DM zero-URL error response, (4) `logger.warn` on DB read failure in recap, (5) in-memory operator broadcast rate limit (FR-021). Plus one new migration for 2 new config keys.

## Technical Context

**Language/Version**: JavaScript — Node.js ≥ 20, ESM (`import`/`export` only; no CommonJS `require`)
**Primary Dependencies**: `@whiskeysockets/baileys` (WA adapter), `bullmq` + `ioredis` (outbox queue), `pg` (PostgreSQL client), `pino` (logger), `jest` (unit tests)
**Storage**: PostgreSQL (8 migrations total after delta migration); Redis (BullMQ backing only — no direct key access in this service)
**Testing**: Jest — `npm test`; all external services mocked; Node.js ≥ 20 required
**Target Platform**: Linux server; Docker Compose (production), PM2 (bare-metal fallback)
**Project Type**: WhatsApp auto-response gateway service (single-process, multi-tenant by `client_id`)
**Performance Goals**: ≤15s DM response best-effort (≤3 URLs, happy path); ≤5s group ack; ≤90s hard cap (worst-case: 10 URLs × 8s per-URL timeout)
**Constraints**: No `console.log` in production; no CommonJS; no hardcoded credentials; all outbound WA messages via `enqueueSend(jid, { text })`; all SQL parameterized ($1/$2/...); pino logger only
**Scale/Scope**: Single-process gateway; tens of registered operators; max 10 URLs per broadcast; multi-tenant

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| Layered architecture (handler → service → repository) | ✅ PASS | `waAutoSosmedTaskService` delegates to repositories and `operatorRegistrationService`; no DB calls from routes or handlers |
| camelCase JS, snake_case DB | ✅ PASS | All JS identifiers camelCase; all DB column/table names snake_case |
| ESM (`import`/`export`) | ✅ PASS | All files use ESM; no `require()` present or added |
| All outbound WA messages via `enqueueSend` | ✅ PASS | Every response uses `enqueueSend(jid, { text })`; no direct `waClient.sendMessage` |
| Parameterized SQL | ✅ PASS | All queries use `$1, $2, ...` placeholders; no string interpolation in SQL |
| Pino logger, no `console.log` | ✅ PASS | All log calls use `logger.*`; gap fix adds missing `logger.warn` on DB read failure |
| Unit tests for every new service/repo function | ✅ PASS | Existing tests pass; delta gaps each require at least one new Jest test case |
| Memory-unbounded data structures prohibited | ⚠️ JUSTIFIED EXCEPTION | FR-021 uses in-memory `Map` for operator rate-limit — see Complexity Tracking |

**Post-design re-check**: All gates pass after Phase 1 design. Exception is justified below.

## Project Structure

### Documentation (this feature)

```text
specs/003-sosmed-task-autoresponse/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command) — 18 decisions
├── data-model.md        # Phase 1 output (/speckit.plan command) — 8 migrations; 13 DEFAULT rows in Migration 7 + 2 in Migration 8 (009) = 15 total
├── quickstart.md        # Phase 1 output (/speckit.plan command) — env setup + verify steps
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── wa-message-contract.md   # Responses A–K, inbound contract, delivery rules
└── tasks.md             # Phase 2 output (/speckit.tasks command — NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── service/
│   ├── waAutoSosmedTaskService.js        # MODIFY: URL cap, zero-URL paths, FR-021 rate limit, logger.warn
│   ├── sosmedBroadcastParser.js          # no change
│   ├── operatorRegistrationService.js    # no change
│   ├── clientConfigService.js            # no change
│   └── waOutbox.js                       # no change
├── repository/
│   ├── operatorRepository.js             # no change
│   ├── operatorRegistrationSessionRepository.js  # no change
│   └── clientConfigRepository.js         # no change
└── (all other files — no change)

sql/migrations/
└── 20260326_009_add_operator_rate_limit_config.sql  # NEW: seed 2 new DEFAULT config keys

tests/
└── waAutoSosmedTaskService.test.js  # MODIFY: add 6 new delta test cases (existing tests unchanged)
```

**Structure Decision**: Single-service architecture — all delta changes isolated to one service file and one new migration. No new source files required.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| In-memory `Map` for FR-021 operator rate-limit counter | FR-021 requires capping broadcast frequency per registered operator (max 20/hr). Counter must survive intra-session calls but intentionally resets on gateway restart (acceptable — rate limit is a soft guard, not a security control). | **Redis `INCR`/`EXPIRE`**: adds Redis dependency to service logic and requires `ioredis` calls for a trivial guard — disproportionate. **DB column `broadcast_count`**: adds a DB write per processed broadcast (latency) plus a new table/column for a non-critical counter. **`bottleneck` library**: designed for outbound throttle, not inbound rate-limit; adds a dependency. The in-memory `Map` is bounded by the number of registered operators (tens in this deployment) — not unbounded in practice. Entries self-expire after the 60-min window check, keeping Map size O(active operators). |

---

## Implementation Phases

### Phase 0: Research ✅ COMPLETE

`research.md` contains 18 decisions. All NEEDS CLARIFICATION resolved. Key decisions informing delta implementation:

| Decision | Summary |
|---|---|
| D14 | URL cap: max 10 per broadcast; excess silently ignored + `logger.warn` |
| D15 | FR-021 rate limit: in-memory `Map<phoneNumber, {count, windowStart}>`; 60-min rolling window; default limit 20 from `client_config` |
| D16 | Zero-URL handling: DM path → send `operator_no_valid_url`; group path → silent + `logger.warn` |
| D17 | Session re-hydration: per-message DB query (already implemented correctly in current code) |
| D18 | DB read failure in recap: show count, omit `Partisipan:` line, call `logger.warn` |

### Phase 1: Design ✅ COMPLETE

All design artifacts generated and up to date:

| Artifact | Status | Key Content |
|---|---|---|
| `research.md` | ✅ Complete | 18 decisions; D14–D18 added this session |
| `data-model.md` | ✅ Complete | 8 migrations; 13 DEFAULT config rows in Migration 7 seed + 2 in Migration 8 (009) = 15 total; entities for operators, sessions, client_config |
| `contracts/wa-message-contract.md` | ✅ Complete | Responses A–K; delivery rules; URL cap note; group zero-URL = silent note |
| `quickstart.md` | ✅ Complete | Env setup; verify query "15 rows"; smoke test Step 5 |

### Phase 2: Implementation — 6 Delta Items

The core service is already implemented. The following 6 targeted changes bring it to full spec compliance.

---

#### Delta 1 — URL Cap: Max 10 per Broadcast (FR-005 step 1)

**File**: `src/service/waAutoSosmedTaskService.js`
**Where**: DM registered operator path — after `const { igUrls, tiktokUrls } = extractUrls(text);`
**Change**: Declare `igUrls`/`tiktokUrls` as `let` instead of `const`. After extraction, if total URL count > 10, cap the combined array at 10 (preserve original IG/TikTok split order) and log `logger.warn`.

```js
let { igUrls, tiktokUrls } = extractUrls(text);
const totalUrls = igUrls.length + tiktokUrls.length;
if (totalUrls > 10) {
  logger.warn({ phoneNumber, clientId, total: totalUrls },
    'waAutoSosmedTask: URL cap applied, URLs beyond 10 ignored');
  const allCapped = [...igUrls, ...tiktokUrls].slice(0, 10);
  igUrls = allCapped.filter(u => /instagram\.com|ig\.me/i.test(u));
  tiktokUrls = allCapped.filter(u => /tiktok\.com/i.test(u));
}
```

---

#### Delta 2 — Group Zero-URL Silence (FR-002 exception)

**File**: `src/service/waAutoSosmedTaskService.js`
**Where**: Group path — between `extractUrls(text)` and `recordTasksToDB(...)` call
**Change**: If `igUrls.length + tiktokUrls.length === 0`, log `logger.warn` and return `false` without sending the ack.

```js
if (igUrls.length + tiktokUrls.length === 0) {
  logger.warn({ clientId, chatId },
    'waAutoSosmedTask: group broadcast with zero valid URLs, suppressing ack');
  return false;
}
```

---

#### Delta 3 — DM Zero-URL Error Response (FR-006b exception)

**File**: `src/service/waAutoSosmedTaskService.js`
**Where**: DM registered operator path — after URL extraction (and after Delta 1 URL cap), before `recordTasksToDB`
**Change**: If total URLs === 0, fetch `operator_no_valid_url` from config, send one error message, and return.

```js
if (igUrls.length + tiktokUrls.length === 0) {
  const noUrlMsg = await getConfigOrDefault(
    clientId, 'operator_no_valid_url',
    'Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda.');
  await enqueueSend(dmJid, { text: noUrlMsg });
  return true;
}
```

---

#### Delta 4 — DB Read Failure `logger.warn` in Recap (FR-006b)

**File**: `src/service/waAutoSosmedTaskService.js`
**Where**: `buildEngagementRecapText` function — the two `catch { /* non-fatal */ }` blocks
**Change**: Replace the silent catches with `logger.warn` calls including the error and relevant ID.

```js
// IG partisipan catch:
} catch (err) {
  logger.warn({ err, shortcode }, 'waAutoSosmedTask: DB read for IG partisipan failed, omitting');
}

// TikTok partisipan catch:
} catch (err) {
  logger.warn({ err, videoId }, 'waAutoSosmedTask: DB read for TikTok partisipan failed, omitting');
}
```

---

#### Delta 5 — Operator Broadcast Rate Limit (FR-021)

**File**: `src/service/waAutoSosmedTaskService.js`
**Where**: Module-level (add Map + helper), then DM registered operator path after broadcast detection
**Change**: Add module-level in-memory rate limit counter and check before processing.

```js
// Module-level (near other module-level declarations)
const _operatorRateLimit = new Map(); // Map<phoneNumber, { count, windowStart }>

function isOperatorRateLimited(phoneNumber, limitPerHour) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entry = _operatorRateLimit.get(phoneNumber);
  if (!entry || now - entry.windowStart >= windowMs) {
    _operatorRateLimit.set(phoneNumber, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= limitPerHour) return true;
  entry.count += 1;
  return false;
}
```

```js
// In DM registered operator path — after isBroadcastMessage() returns true, before URL extraction:
const rateLimit = parseInt(
  await getConfigOrDefault(clientId, 'operator_broadcast_rate_limit', '20'), 10);
if (isOperatorRateLimited(phoneNumber, rateLimit)) {
  logger.warn({ phoneNumber, clientId },
    'waAutoSosmedTask: operator broadcast rate limit exceeded, suppressing');
  return true;
}
```

---

#### Delta 6 — Migration: Seed New Config Keys

**File**: `sql/migrations/20260326_009_add_operator_rate_limit_config.sql` *(new file)*

```sql
-- Migration 009: Add operator broadcast rate limit and no-valid-URL config defaults
INSERT INTO client_config (client_id, config_key, config_value, description)
VALUES
  ('DEFAULT', 'operator_broadcast_rate_limit', '20',
   'Maks jumlah broadcast per operator terdaftar per jam (window 60 menit bergulir)'),
  ('DEFAULT', 'operator_no_valid_url',
   'Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda.',
   'Pesan error saat broadcast operator terdaftar tidak mengandung URL IG/TikTok valid')
ON CONFLICT (client_id, config_key) DO NOTHING;
```

Run via: `node scripts/run_migration.js sql/migrations/20260326_009_add_operator_rate_limit_config.sql`

---

### Phase 3: Test Coverage

Add test cases to `tests/waAutoSosmedTaskService.test.js` for each delta:

| # | Test Description | What to Assert |
|---|---|---|
| T1 | **Group broadcast, zero URLs extracted** | `enqueueSend` not called; function returns `false` |
| T2 | **DM registered operator, zero URLs** | Exactly 1 `enqueueSend` call; text matches `operator_no_valid_url` config value; no second/third message |
| T3 | **DM registered operator, 12 URLs provided** | `recordTasksToDB` (via `query` spy) called with ≤10 URLs; `logger.warn` called once for URL cap |
| T4 | **DM registered operator, 21st broadcast in same hour** | After 20 successful calls reset counter, 21st returns `true` with zero `enqueueSend` calls; `logger.warn` called with rate-limit context |
| T5 | **`buildEngagementRecapText`, IG DB read failure** | `logger.warn` called; recap text still contains `✅ url — N likes`; does not contain `Partisipan:` |
| T6 | **`buildEngagementRecapText`, TikTok DB read failure** | `logger.warn` called; recap text still contains `✅ url — N komentar`; does not contain `Partisipan:` |

All 13 existing tests must continue to pass unchanged.

---

### Phase 4: Smoke Test Checklist

Verify in dev environment after deploying all 6 delta items:

- [ ] Registered operator sends broadcast with 12 URLs → 3 messages sent; only 10 URLs saved to DB; `logger.warn` in log for URL cap
- [ ] Registered operator sends broadcast with only non-platform text (no IG/TikTok URLs) → 1 error message sent matching `operator_no_valid_url`; no recap/ack/task-list
- [ ] Group client receives broadcast with only non-platform text → bot does NOT reply; `logger.warn` in log
- [ ] Registered operator sends 21 broadcasts within 60 minutes → 21st broadcast: no bot reply; `logger.warn` with "rate limit exceeded" in log
- [ ] Registered operator broadcasts with API success but DB partisipan query throws → recap delivered with count but no `Partisipan:` line; `logger.warn` in log
- [ ] `npm test` → all tests pass (≥19 total after 6 new cases)
- [ ] `npm run lint` → no errors

# Implementation Plan: WhatsApp Complaint Auto-Response

**Branch**: `001-wa-complaint-autoresponse` | **Date**: 2026-04-14 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/001-wa-complaint-autoresponse/spec.md`

---

## Summary

Implement automated triage and response for "Pesan Komplain" WhatsApp messages sent to registered CICERO client groups or as DMs to the gateway number. The bot parses structured complaint messages, looks up the reporter in the CICERO PostgreSQL database, evaluates the reporter's social media profile health via RapidAPI, computes audit activity counts, and replies with a structured triage result.

This plan closes **10 implementation gaps** (GAP-001 through GAP-010) identified during codebase analysis:
- GAP-001: BullMQ outbox worker not wired on WA ready event
- GAP-002: Profile condition checks incomplete (NO_PROFILE_PHOTO, NO_CONTENT as distinct codes, profile links missing)
- GAP-003: FR-013 dual-account RapidAPI fetch for USERNAME_MISMATCH not implemented
- GAP-004: FR-014 PendingConfirmation store + DM not implemented
- GAP-005: FR-015 "ya konfirmasi" DM handler + DB UPDATE not implemented
- GAP-006: FR-016 ALREADY_PARTICIPATED check + latest post URL query not implemented
- GAP-007: FR-001 client group filter needs `allowedGroupIds` wiring
- GAP-008: `waAutoComplaintService.js` uses direct `waClient.sendMessage` instead of `enqueueSend`
- GAP-009: `complaintParser.js` missing min-length (< 3 chars) check after normalization
- GAP-010: Response templates missing for new triage codes + profile links

**Scope**: 3 User Stories, 16 Functional Requirements, 10 triage codes.

---

## Technical Context

**Language/Version**: Node.js 22, ESM (`"type": "module"`)  
**Primary Dependencies**: `@whiskeysockets/baileys`, `bullmq`, `bottleneck`, `pg`, `pino`, `axios`  
**Storage**: PostgreSQL — `"user"` table (PK: `user_id`, social cols: `insta`, `tiktok`); `insta_post` (PK: `shortcode`); `tiktok_post` (PK: `video_id`); `insta_like` (JSONB); `tiktok_comment` (JSONB); `clients` (`client_group` for group JID→clientId)  
**Testing**: Jest (unit, mocked I/O — no live WA / DB / RapidAPI)  
**Target Platform**: Linux server (Docker via `docker-compose.yml`)  
**Project Type**: Web service / WhatsApp gateway  
**Performance Goals**: Complaint response ≤ 10 s end-to-end (SC-001); single-threaded Node.js event loop (no CPU-bound ops)  
**Constraints**: All outbound WA messages via BullMQ `enqueueSend` (FR-010, Constitution VII); pino logger only, no `console.*` in new code (Constitution V); all RapidAPI calls apply `RAPIDAPI_TIMEOUT_MS` timeout (default 5 000 ms — SC-001 guard for dual-fetch path FR-013)  
**Scale/Scope**: ~hundreds of complaints/day across all registered groups; 1 WA gateway process

---

## Constitution Check

*GATE: Must pass before implementation. Violations require justification.*

| Rule | Status | Notes |
|------|--------|-------|
| I — Single Responsibility | ⚠️ REQUIRED | Each file has one concern. **C2 (new)**: Pre-existing `getUserByNrp` and audit-count queries in `complaintTriageService.js` violate layer boundaries; T027 migrates them to `complaintRepository.js`. New `pendingConfirmationStore.js` is a single-responsibility module. |
| II — Minimal Surface | ✅ PASS | No new routes or external APIs added |
| III — Test Coverage | ✅ PASS | All new service logic + triage codes must have Jest unit tests |
| IV — No Secrets in Code | ✅ PASS | `RAPIDAPI_KEY` via env; DB via `DATABASE_URL`; no hardcoded secrets added |
| V — Structured Logging | ⚠️ REQUIRED | New code MUST use `logger` from `src/utils/logger.js` (pino). `console.*` forbidden in any new or modified code. Pre-existing `console.*` in `waService.js` is deferred. |
| VI — Parameterized Queries | ✅ PASS | All DB writes use parameterized queries (`$1`, `$2`); FR-015 UPDATE uses `$1/$2` parameters |
| VII — No Unbounded Memory | ⚠️ REQUIRED | `waEventAggregator.js` uses TTL Map (24 h) but **lacks a max-entries cap** — entries accumulate unchecked between hourly sweeps. **T028 adds a 10 000-entry LRU eviction policy** enforced on every `seenMessages.set()` call (evicts oldest-insertion-order entry when at capacity). `pendingConfirmationStore.js` must use TTL Map (15 min) with **max 1 000 entries (LRU eviction)**. No plain `Set` or unbounded `Map` in any new or modified file. |
| VIII — Queue All Sends | ✅ PASS (after GAP-008 fix) | All `waClient.sendMessage` calls in complaint path replaced with `enqueueSend` |

**Post-design re-check**: All constitution rules satisfied in the design. GAP-008 fix is mandatory before any tests can pass.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-wa-complaint-autoresponse/
├── plan.md              # This file
├── research.md          # Phase 0 output (complete)
├── data-model.md        # Phase 1 output (complete)
├── quickstart.md        # Phase 1 output (complete)
├── contracts/
│   └── wa-messages.md   # Phase 1 output (complete)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code Changes

```text
src/
├── service/
│   ├── waService.js                   MODIFY — wire attachWorker on 'ready' event (GAP-001)
│   ├── waAutoComplaintService.js      MODIFY — replace sendMessage→enqueueSend (GAP-008),
│   │                                            add handleConfirmationDM export (GAP-005),
│   │                                            add pending confirmation creation (GAP-004)
│   ├── complaintTriageService.js      MODIFY — fix profile condition checks (GAP-002),
│   │                                            add FR-013 dual-RapidAPI fetch (GAP-003),
│   │                                            add FR-016 ALREADY_PARTICIPATED + post URL (GAP-006)
│   ├── complaintResponseTemplates.js  MODIFY — add templates for all 10 codes + profile links (GAP-010)
│   ├── complaintParser.js             MODIFY — add min-length < 3 char check (GAP-009)
│   └── pendingConfirmationStore.js    CREATE — TTL Map for FR-014/015 sessions

tests/
├── waServiceOutbox.test.js            CREATE — GAP-001: attachWorker called on 'ready'
├── complaintParserNormalize.test.js   CREATE — GAP-009: min-length, blocklist, URL normalization
├── complaintTriageProfileCodes.test.js CREATE — GAP-002/003/006: new triage codes
├── pendingConfirmationStore.test.js   CREATE — GAP-004: TTL expiry, set/get/delete
└── complaintConfirmationDM.test.js    CREATE — GAP-005: "ya konfirmasi" handler
```

---

## Implementation Gaps

### GAP-001 — BullMQ Worker Not Wired (`waService.js`)

**File**: `src/service/waService.js`  
**Problem**: `attachWorker(baileysAdapter)` from `waOutbox.js` is never called. Jobs are enqueued but never consumed.  
**Fix**: Import `attachWorker` from `waOutbox.js` and call `attachWorker(baileysSocketAdapter)` inside the `'connection.update'` handler when `connection === 'open'`.

```js
// src/service/waService.js (on 'connection.update')
if (connection === 'open') {
  attachWorker(baileysSocketAdapter);
  logger.info('WA client ready — outbox worker attached');
}
```

**Test**: Mock `attachWorker`, verify it is called exactly once when connection state becomes `'open'`.

---

### GAP-008 — Direct `sendMessage` in Complaint Path (`waAutoComplaintService.js`)

**File**: `src/service/waAutoComplaintService.js`  
**Problem**: `waClient.sendMessage(jid, { text })` is called directly, bypassing BullMQ rate limiting.  
**Fix**: Replace all `waClient.sendMessage(jid, payload)` calls in the complaint handler with `await enqueueSend(jid, payload)`. Import `enqueueSend` from `waOutbox.js`.

**Scope**: All calls inside `sendComplaintMessages()` and any direct send calls in `handleComplaintMessageIfApplicable`.

---

### GAP-009 — Missing Min-Length Check (`complaintParser.js`)

**File**: `src/service/complaintParser.js`  
**Problem**: After URL normalization, a value of `'p'` (from `instagram.com/p/ABC`) passes through and enters triage as a username. The spec requires values < 3 characters after normalization to be treated as missing.  
**Fix**: After calling `handleNormalizer.normalizeHandleValue(raw)`, add:

```js
if (!normalized || normalized.length < 3) return '';
```

This check happens **after** the `normalizeHandleValue` call (which already strips `@`, extracts from URLs, and rejects known path segments), so the min-length check is the final guard.

**Test cases**:
- `'p'` → `''` (length 1)
- `'ab'` → `''` (length 2)
- `'abc'` → `'abc'` (length 3, passes)
- `'https://instagram.com/p/ABC123/'` → `''` (normalizer returns `'p'`, then min-length blocks it)

---

### GAP-002 — Incomplete Profile Condition Checks (`complaintTriageService.js`)

**File**: `src/service/complaintTriageService.js`  
**Problem**: `assessLowTrust` conflates three distinct conditions (`isPrivate`, `!hasProfilePic`, `posts === 0`) into a single `LOW_TRUST` code. The spec requires them as separate triage codes with distinct actions.  
**Fix**: Refactor `assessLowTrust` into explicit, separate checks aligned to the triage priority chain:

```
ACCOUNT_PRIVATE   → profile.isPrivate === true
NO_PROFILE_PHOTO  → profile.hasProfilePic === false
NO_CONTENT        → profile.posts === 0  (and not private)
LOW_TRUST         → profile.posts === 0  (via NO_CONTENT: same condition, separate code)
```

**Clarification**: Per spec FR-005 and triage table, `NO_CONTENT` (media_count = 0) AND `LOW_TRUST` (media_count = 0 activates LOW_TRUST) are both triggered by `posts === 0`. These are reported as two separate diagnosis codes in multi-code output. The `LOW_TRUST` 4-step activation guide is appended when `NO_CONTENT` is present.

**Profile links**: Each condition that requires a profile link MUST include:
- IG: `https://instagram.com/${username}`
- TikTok: `https://tiktok.com/@${username}`

These are assembled inside `complaintTriageService` and stored in `triageResult.evidence.profileLinks`.

**Old `recentActivityScore < 10` check**: Remove — this was an internal scoring metric not aligned to spec. New spec ties `LOW_TRUST` to `media_count = 0` only.

---

### GAP-003 — FR-013 Dual-Account Comparison (`complaintTriageService.js`)

**File**: `src/service/complaintTriageService.js`  
**Problem**: When `USERNAME_MISMATCH` is detected (reported username ≠ DB username), only the reported username is fetched from RapidAPI. The DB username is not cross-checked.  
**Fix**: When mismatch is detected:
1. RapidAPI call 1: `mapProviderToSocialProfile(platform, reportedUsername)` → `reportedProfile`
2. RapidAPI call 2: `mapProviderToSocialProfile(platform, dbUsername)` → `dbProfile`
3. Both calls can be `Promise.all`'d for parallelism.
4. Relevance scoring: `score = followers + media_count`; penalize `isPrivate === true`.
5. Store `{ reportedProfile, dbProfile, moreRelevant: 'reported' | 'db' }` in `triageResult.evidence.mismatch`.

> **CRITICAL — Profile condition reuse (H1)**: The `reportedProfile` returned by this `Promise.all` dual-fetch MUST be passed directly to the GAP-002 profile condition checks (`assessProfileConditions(reportedProfile)`). **No third `mapProviderToSocialProfile` call may be issued for `reportedUsername` in the same triage execution.** The triage call sequence inside `complaintTriageService.triage()` must be: (1) mismatch dual-fetch via `Promise.all`, (2) forward `reportedProfile` to `assessProfileConditions` — bypassing any independent fetch for the same username. Worst-case SC-001 path: 2 calls × 5 000 ms timeout = 10 000 ms ≤ 10 s budget.

If either call throws, store the error and continue — the mismatch report uses whatever data is available.

---

### GAP-004 — PendingConfirmation Store (`pendingConfirmationStore.js`)

**File**: `src/service/pendingConfirmationStore.js` *(CREATE)*  
**Purpose**: In-memory TTL Map storing active username-change confirmation sessions.  
**Key**: `${senderJid}:${platform}` (e.g., `628123456789@c.us:instagram`)  
**TTL**: 15 minutes from creation  
**Max entries**: 1 000 entries (LRU eviction on overflow), consistent with the FR-009 dedup Map cap. Expired entries are also cleaned up eagerly on `get`.

```js
// Exported interface
export function setConfirmation(senderJid, platform, data) { ... }
export function getConfirmation(senderJid, platform) { ... } // returns null if expired
export function deleteConfirmation(senderJid, platform) { ... }
```

`data` shape: `{ senderJid, platform, oldUsername, newUsername, nrp, expiresAt: Date.now() + 15*60*1000 }`

`getConfirmation` MUST check `data.expiresAt > Date.now()` and return `null` if expired, deleting the stale entry.

---

### GAP-005 — FR-015 Confirmation DM Handler (`waAutoComplaintService.js`)

**File**: `src/service/waAutoComplaintService.js`  
**Add**: Export `handleConfirmationDM(msg, senderId)` function.

**Logic**:
1. Check message source is DM (not group): `!msg.key.remoteJid.endsWith('@g.us')`
2. Match body against `/ya konfirmasi (ig|tiktok)/i`
3. Resolve platform: `ig` → `instagram`, `tiktok` → `tiktok`
4. `getConfirmation(senderJid, platform)` → if null, silently return (no response)
5. Execute: `UPDATE "user" SET insta = $1 WHERE user_id = $2` (or `tiktok` column)
6. `enqueueSend(senderJid, { text: successMessage })`
7. `deleteConfirmation(senderJid, platform)`
8. Log the update via pino logger

**Wire in `waService.js`**: Before the complaint check, check for DM confirmation:

```js
if (!fromGroup && await handleConfirmationDM(msg, senderId)) return;
```

**DB call** (via repository — Constitution I + VI):
```js
import { updateUserSocialHandle } from '../repository/complaintRepository.js';
await updateUserSocialHandle(session.nrp, platform, session.newUsername);
// complaintRepository.updateUserSocialHandle(userId, platform, handle) issues:
//   UPDATE "user" SET insta = $1 WHERE user_id = $2  (platform === 'instagram')
//   UPDATE "user" SET tiktok = $1 WHERE user_id = $2  (platform === 'tiktok')
// Parameterized queries satisfy Constitution VI. SQL stays in src/repository/.
```

---

### GAP-006 — FR-016 ALREADY_PARTICIPATED + Latest Post URL (`complaintTriageService.js`)

**File**: `src/service/complaintTriageService.js`  
**Problem**: No check for all-time participation count > 0.  
**Fix**:
1. After computing audit counts (all-time like + comment), if `allTimeCount > 0` → add `ALREADY_PARTICIPATED` to diagnoses.
2. Call `complaintRepository.getLatestPost(clientId, platform)` — returns `{ shortcode }` (IG), `{ videoId }` (TikTok), or `null` if no post found. (SQL stays in `src/repository/complaintRepository.js` — Constitution I; parameterized — Constitution VI.)
3. Construct post URL from returned value:
   - IG: `https://instagram.com/p/${shortcode}`
   - TikTok: `https://tiktok.com/video/${videoId}`
4. Store in `triageResult.evidence.latestPostUrl` (null if no post found).

**Note**: `client_id` must be resolved from the group JID before calling the audit service — it's already available in `triageResult.context.clientId`.

---

### GAP-004 (continued) — FR-014 Send Mismatch DM (`waAutoComplaintService.js`)

After `USERNAME_MISMATCH` is detected and the group response is queued:
1. Build DM body using `complaintResponseTemplates.buildMismatchConfirmationDM(triageResult, parsed)`
2. `enqueueSend(senderJid, { text: dmBody })`
3. Call `setConfirmation(senderJid, platform, { senderJid, platform, oldUsername: dbUsername, newUsername: reportedUsername, nrp, expiresAt })`

---

### GAP-010 — Response Templates (`complaintResponseTemplates.js`)

**File**: `src/service/complaintResponseTemplates.js`  
**Add/update** template branches for:

| Code | New Content |
|------|------------|
| `ACCOUNT_PRIVATE` | Instruction to set account public + profile link |
| `NO_PROFILE_PHOTO` | Instruction to add profile photo + profile link |
| `NO_CONTENT` / `LOW_TRUST` | 4-step activation guide + profile link |
| `ALREADY_PARTICIPATED` | Participation notice + `latestPostUrl` + comment-again suggestion |
| `USERNAME_MISMATCH` | Dual-account metrics (`reportedProfile` vs `dbProfile`) + profile links |
| `buildMismatchConfirmationDM` | New function — DM body for FR-014 |

**Profile link helper**: Add `buildProfileLink(platform, username)` helper returning `https://instagram.com/${u}` or `https://tiktok.com/@${u}`.

---

## Data Flow

```
[WA message arrives]
        │
        ▼
waService.createHandleMessage()
        │
        ├── Is DM + "ya konfirmasi"?
        │      └── handleConfirmationDM() → UPDATE user SET insta/tiktok → enqueueSend ACK
        │
        └── Is "Pesan Komplain"?
               │
               ▼
           complaintParser.parseComplaintMessage()
               │  normalizeHandleValue() + min-length guard
               ▼
           complaintTriageService.triage(parsed, clientId)
               │
               ├── getUserByNrp(user_id)  ← DB lookup
               │      └── NRP_NOT_FOUND if null
               │
               ├── Username match check
               │      └── USERNAME_MISMATCH? → Promise.all([RapidAPI(reported), RapidAPI(db)])
               │
               ├── RapidAPI profile check (for reported username)
               │      ├── ACCOUNT_PRIVATE (isPrivate)
               │      ├── NO_PROFILE_PHOTO (!hasProfilePic)
               │      ├── NO_CONTENT + LOW_TRUST (posts === 0)
               │      └── EXTERNAL_NA on error
               │
               ├── Audit queries (30-min + all-time like/comment counts)
               │      ├── ALREADY_PARTICIPATED (allTime > 0)
               │      │      └── query insta_post/tiktok_post for latestPostUrl
               │      └── NO_ACTIVITY (allTime === 0, recent === 0)
               │
               └── OK (all clear)
                      │
                      ▼
           complaintResponseTemplates.buildOperatorResponse()
               └── enqueueSend(chatId, { text })

           complaintResponseTemplates.buildAdminSummary()
               └── enqueueSend(senderJid, { text })   [if group message]

           USERNAME_MISMATCH only:
           complaintResponseTemplates.buildMismatchConfirmationDM()
               └── enqueueSend(senderJid, { text })
               └── setConfirmation(senderJid, platform, session)
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/repository/complaintRepository.js` | `updateUserSocialHandle()` + `getLatestPost()` — new FR-015/016 queries (C1 fix); `getUserByNrp()` + `getAuditCounts()` — migration of existing FR-003/004 queries from service layer (C2 fix) |
| `src/service/pendingConfirmationStore.js` | TTL Map for FR-014/015 sessions |
| `tests/waServiceOutbox.test.js` | GAP-001 attachWorker wiring |
| `tests/complaintParserNormalize.test.js` | GAP-009 min-length + path-segment blocklist |
| `tests/complaintTriageProfileCodes.test.js` | GAP-002/003/006 profile conditions + ALREADY_PARTICIPATED |
| `tests/pendingConfirmationStore.test.js` | GAP-004 TTL expiry, set/get/delete |
| `tests/complaintConfirmationDM.test.js` | GAP-005 "ya konfirmasi" DM handler |

## Files to Modify

| File | Changes |
|------|---------|
| `src/service/waService.js` | Import + call `attachWorker` on `'open'`; wire `handleConfirmationDM` before complaint check |
| `src/service/waAutoComplaintService.js` | Replace `sendMessage`→`enqueueSend`; add `handleConfirmationDM`; add FR-014 DM send + `setConfirmation` call; call `complaintRepository.updateUserSocialHandle()` for DB update (C1) |
| `src/service/waEventAggregator.js` | Add 10 000-entry LRU eviction cap on `seenMessages` Map (T028 — H2 · FR-009 · Constitution VII) |
| `src/service/complaintTriageService.js` | Fix profile conditions; add FR-013 dual-fetch (reuse `reportedProfile` for GAP-002 — H1); add FR-016 ALREADY_PARTICIPATED + call `complaintRepository.getLatestPost()` (C1); **replace existing `getUserByNrp` + audit-count SQL with `complaintRepository.getUserByNrp()` + `complaintRepository.getAuditCounts()` (C2)** |
| `src/service/complaintResponseTemplates.js` | Add all missing code templates + profile links + `buildMismatchConfirmationDM` |
| `src/service/complaintParser.js` | Add min-length < 3 guard after `normalizeHandleValue` |

---

## Complexity Tracking

Three code issues remediated by this feature branch:
- **C1**: New DB queries for FR-015 (UPDATE user) and FR-016 (SELECT from insta/tiktok_post) are placed in a new `src/repository/complaintRepository.js` — not inline in service files (Constitution I).
- **C2**: Pre-existing `getUserByNrp` and audit-count queries in `complaintTriageService.js` are migrated to `complaintRepository.js` via T027 to complete Constitution I compliance in the service layer.
- **H2**: `waEventAggregator.js` TTL Map gains 10 000-entry LRU eviction cap (Constitution VII — previously unbounded between hourly cleanups).

---

## References

- [spec.md](spec.md) — Feature specification (v2, Ready for Planning)
- [research.md](research.md) — Gap analysis and codebase findings
- [data-model.md](data-model.md) — Entity model, TriageResult v2, state transitions
- [contracts/wa-messages.md](contracts/wa-messages.md) — Full message format contracts
- [quickstart.md](quickstart.md) — Dev setup, test commands, manual E2E test scripts

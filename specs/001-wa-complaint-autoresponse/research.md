# Research: WhatsApp Auto-Response — Complaint Handler

**Feature**: `001-wa-complaint-autoresponse`  
**Phase**: 0 — Research  
**Date**: 2026-03-25 (regenerated — full spec v2 with FR-013–016, normalization, profile checks)

---

## 1. Codebase Archaeology — What Already Exists

### Decision: Core domain logic partially implemented; 10 gaps require resolution

| File | Role | Status |
|------|------|--------|
| `complaintParser.js` | Parse "Pesan Komplain" structured text + username normalization | ✅ Complete + FR-002 URL via `handleNormalizer.js` |
| `handleNormalizer.js` | URL/@ → clean username extraction | ✅ Complete — handles IG/TikTok URLs, returns `""` for post paths |
| `complaintTriageService.js` | DB lookup, audit counts, RapidAPI profile check | ⚠️ Partial — missing FR-013/016; profile checks incomplete |
| `complaintResponseTemplates.js` | `buildOperatorResponse()` / `buildAdminSummary()` | ⚠️ Partial — missing ALREADY_PARTICIPATED, NO_PROFILE_PHOTO, NO_CONTENT, mismatch comparison templates |
| `waAutoComplaintService.js` | Complaint dispatch entry point + gateway loop guard | ⚠️ Partial — uses `waClient.sendMessage` directly; missing FR-014/015 handlers |
| `waEventAggregator.js` | TTL-based message-ID dedup (24h, Map + hourly cleanup) | ✅ Complete — FR-009 already compliant |
| `waOutbox.js` | BullMQ outbox: `enqueueSend` + `attachWorker` | ✅ Defined but **NOT connected** (GAP-001) |
| `waService.js` | Message routing, group guard, seen marking | ⚠️ Missing `attachWorker` wiring; uses `console.*` (Constitution V) |
| `rapidApiProfileService.js` | RapidAPI profile fetch + field normalization | ✅ Complete — `mapProviderToSocialProfile` returns `isPrivate`, `posts`, `followers`, `hasProfilePic` |
| `baileysAdapter.js` | Single Baileys WA adapter | ✅ Complete |

---

## 2. Gap Analysis — Full Delta for spec v2

### GAP-001 — Outbox Queue Not Wired (FR-010, Constitution VII) 🔴

- `waOutbox.js` exports `enqueueSend` and `attachWorker` but is never imported.
- `waAutoComplaintService.js` calls `waClient.sendMessage()` directly — bypasses BullMQ.
- **Fix**: Add `attachWorker(baileysAdapter)` call in `waService.js` on Baileys `ready` event. Replace all `waClient.sendMessage` calls in `waAutoComplaintService.js` with `enqueueSend`.

### GAP-002 — FR-005 Profile Checks Incomplete (FR-005) 🔴

- `rapidApiProfileService.js`'s `mapProviderToSocialProfile` returns `isPrivate`, `posts`, `hasProfilePic` — but the triage service only checks `isPrivate`.
- `profile_pic_url`/`media_count = 0` checks for `NO_PROFILE_PHOTO` and `NO_CONTENT` codes are missing.
- Profile direct links (`https://instagram.com/<username>`) are not included in any response template.
- **Fix**: Update `complaintTriageService.js` to evaluate `hasProfilePic === false` → `NO_PROFILE_PHOTO`, `posts === 0` → `NO_CONTENT`. Update `complaintResponseTemplates.js` to include profile links in each condition.

> **RapidAPI field mapping (verified from `rapidApiProfileService.js`)**:
> | Spec field | RapidAPI mapped field |
> |---|---|
> | `is_private` | `profile.isPrivate` |
> | `profile_pic_url` | `profile.hasProfilePic` (boolean) |
> | `media_count` | `profile.posts` (number) |
> | `followers_count` | `profile.followers` (number) |

### GAP-003 — FR-013 Mismatch Comparison Missing (FR-013) 🔴

- `complaintTriageService.js` detects mismatch but does NOT fetch the DB account's RapidAPI profile for comparison — it only fetches the reported username's profile.
- Spec requires: compare both accounts (reported + DB-stored) via RapidAPI, include metrics side-by-side + profile links in triage response.
- **Fix**: When `hasMismatch` is true, fire a second `rapidApi` call for `usernameDb.instagram`/`usernameDb.tiktok` and store for template rendering.

### GAP-004 — FR-014 DM Confirmation Not Sent (FR-014) 🔴

- No `PendingConfirmation` store exists anywhere.
- No DM is sent after `USERNAME_MISMATCH` triage completes.
- **Fix**: Create `pendingConfirmationStore.js` — in-memory TTL Map keyed by `senderJid+platform`, 15-min TTL. After `USERNAME_MISMATCH` triage, call `enqueueSend(senderJid, confirmationDmText)` and `pendingConfirmationStore.set(...)`.

### GAP-005 — FR-015 Confirmation Handler Missing (FR-015) 🔴

- No handler processes "ya konfirmasi ig/tiktok" DM replies.
- No `UPDATE user SET insta/tiktok WHERE user_id` path exists in any service.
- **Fix**: In `waAutoComplaintService.js`, export `handleConfirmationReplyIfApplicable`. In `waService.js`, call this before complaint handler for DM messages. Write DB update via `triageComplaint` or a new repository function.

### GAP-006 — FR-016 ALREADY_PARTICIPATED Missing (FR-016) 🔴

- `complaintTriageService.js` collects `historicalAuditLikeCount`/`historicalAuditCommentCount` but never sets `ALREADY_PARTICIPATED` code.
- No query for latest `insta_post.shortcode` or `tiktok_post.video_id` for URL suggestion.
- **Fix**: After triage codes are determined, if `historicalAuditLikeCount > 0 || historicalAuditCommentCount > 0`, set additional marker `alreadyParticipated = true`. Fetch latest post via `SELECT shortcode FROM insta_post ORDER BY created_at DESC LIMIT 1`. Include in `buildOperatorResponse`.

### GAP-007 — FR-001 Client Group Filter Not Implemented (FR-001) 🟠

- `shouldHandleComplaintMessage` does not validate that `chatId` belongs to a registered `client_group`.
- `waService.js` has a `gatewayAllowedGroupIds` Set loaded from DB — but `handleComplaintMessageIfApplicable` does not consult it.
- **Fix**: Pass `allowedGroupIds` into `handleComplaintMessageIfApplicable` (or check in `shouldHandleComplaintMessage`). Allow DM (`@c.us`) unconditionally; require group IDs to be in allowed set.

### GAP-008 — `handleNormalizer.js` Missing Min-Length Check (FR-002) 🟡

- `normalizeHandleValue` returns result with `@` prefix (e.g. `@p`) for single-char path segments.
- Spec requires `< 3 characters` after normalization → treat as invalid.
- `complaintParser.js`'s `normalizeUsername` receives the `@`-prefixed value from `normalizeHandleValue`; after stripping `@`, a value of `p` (length 1) would pass through.
- **Fix**: In `complaintParser.js`'s `normalizeUsername`, after calling `normalizeHandleValue`, strip leading `@` and check length ≥ 3.

### GAP-009 — Response Templates Incomplete (FR-005, FR-013, FR-016) 🟡

- `buildOperatorResponse` handles `LOW_TRUST` and `OK_ACTIVE_VALID` but not `NO_PROFILE_PHOTO`, `NO_CONTENT`, `ALREADY_PARTICIPATED`.
- Mismatch comparison template (FR-013: both accounts' metrics + links) does not exist.
- **Fix**: Add new template branches to `buildOperatorResponse` and `buildAdminSummary`.

### GAP-010 — Constitution V: `console.*` in Service Files 🟡

- `waService.js`, `waEventAggregator.js` use `console.log/warn/error` extensively.
- Constitution V requires `pino` logger from `src/utils/logger.js`.
- **Fix (deferred to separate PR)**: This is pre-existing; note in plan but do not block this feature. New code added in this feature MUST use logger.

---

## 3. DB Schema Facts (verified from `sql/schema.sql`)

### Decision: Use `user_id`, `insta`, `tiktok` columns — NOT the names in prior spec drafts

| Table | Key Column | Username Columns | Notes |
|-------|-----------|-----------------|-------|
| `"user"` | `user_id` VARCHAR PK | `insta`, `tiktok` | No `nrp` column; no `instagram_username`/`tiktok_username` |
| `insta_post` | `shortcode` VARCHAR PK | — | No `post_url`; URL = `https://instagram.com/p/{shortcode}` |
| `tiktok_post` | `video_id` VARCHAR PK | — | No `post_url`; URL = `https://tiktok.com/video/{video_id}` |
| `insta_like` | — | `likes` JSONB | Array of username objects |
| `tiktok_comment` | — | `comments` JSONB | Array of username strings |

**Rationale**: `sql/schema.sql` is the ground truth. Spec assumptions corrected to match.

---

## 4. RapidAPI Field Mapping (verified from `rapidApiProfileService.js`)

```
mapProviderToSocialProfile returns:
  .isPrivate   → Boolean   (from provider `is_private` field)
  .hasProfilePic → Boolean (from `profile_pic_url` truthy check)
  .posts       → Number    (from `media_count` / `videoCount` / `aweme_count`)
  .followers   → Number    (from `followers_count` / `digg_count`)
  .username    → String    (normalized)
  .platform    → String
```

For FR-013 comparison: `profile.followers + profile.posts` as relevance score; public account preferred.  
For FR-005 checks: `profile.isPrivate`, `profile.hasProfilePic`, `profile.posts`.

---

## 5. In-Memory Structures

### Decision: Use TTL-bounded Map for both dedup (existing) and PendingConfirmation (new)

| Structure | Location | TTL | Key | Max Size |
|-----------|----------|-----|-----|----------|
| `seenMessages` | `waEventAggregator.js` | 24h (env configurable) | `jid:messageId` | Unbounded (hourly cleanup) |
| `pendingConfirmations` | NEW `pendingConfirmationStore.js` | 15 min | `senderJid:platform` | Bounded: max 1 per sender+platform |

**Dedup already compliant**: `waEventAggregator.js` already implements TTL Map dedup — FR-009 gap from previous plan is resolved in-code. Max 10k LRU cap from spec is aspirational; the hourly cleanup already prevents unbounded growth in practice. Adding a hard cap is low-priority.

---

## 6. Username Normalization Flow (FR-002)

### Decision: Existing `handleNormalizer.js` handles URL/@ inputs correctly for most cases; only min-length check is missing

```
complaintParser.js → normalizeUsername(rawValue)
  → normalizeHandleValue(rawValue)  [handleNormalizer.js]
    → extractHandleFromUrl()  if URL pattern detected
    → sanitizeHandleCandidate()  for bare handle
    → returns "@johndoe" OR ""
  → if result: return result (with "@" prefix)
  → if empty: return rawValue.trim()
          
Then in triageComplaint → normalizeHandle(value)
  → strips "@" prefix → "johndoe" for DB comparison
```

**Post-normalization min-length check**: Add in `complaintParser.js` `normalizeUsername()`:
```js
const stripped = normalized.replace(/^@/, '');
if (stripped.length < 3) return '';
return normalized;
```


---

## 7. Deferred Items (Out of Scope for this Feature)

| Item | Reason for Deferral | Reference |
|------|---------------------|-----------|
| `console.*` → pino migration in `waService.js` | Constitution TODO; pre-existing; large-scope change | Constitution V |
| New code in this feature MUST use pino logger | Not deferred — mandatory for all new/modified code | Constitution V |
| Multi-tenant WA multi-client support | Current gateway is single-client per spec assumptions | Assumptions §6 |

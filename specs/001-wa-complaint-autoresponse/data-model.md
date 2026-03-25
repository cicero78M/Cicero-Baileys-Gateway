# Data Model: WhatsApp Auto-Response — Complaint Handler

**Feature**: `001-wa-complaint-autoresponse`  
**Phase**: 1 — Design  
**Date**: 2026-03-25 (regenerated — full spec v2)

---

## Overview

This feature **does not introduce new database tables or columns**. All required entities already exist in the CICERO PostgreSQL schema. The data model document describes the relevant existing entities, their validation rules, and how this feature reads/writes them.

---

## Existing Entities Used by This Feature

### 1. `user` (table)

Stores CICERO registered personnel. Used by complaint triage to validate NRP and match social media usernames.

| Column | Type | Constraints | Role in Feature |
|--------|------|-------------|-----------------|
| `user_id` | `varchar` | PK | Maps to reporter's NRP/NIP in complaint |
| `nama` | `varchar` | NOT NULL | Display name in triage result |
| `insta` | `varchar` | nullable | Stored Instagram username; matched against complaint's `igUsername` |
| `tiktok` | `varchar` | nullable | Stored TikTok username; matched against complaint's `tiktokUsername` |
| `updated_at` | `timestamptz` | NOT NULL | Shown in triage response as `lastUsernameUpdateAt` |

**Read path**: `complaintTriageService.triageComplaint` → `getUserByNrp(db, nrp)` →  
```sql
SELECT user_id, nama, insta, tiktok, updated_at FROM "user" WHERE user_id = $1 LIMIT 1
```
**Write path (FR-015 — confirmation)**: `UPDATE "user" SET insta = $1 WHERE user_id = $2` or TikTok variant  
```sql
UPDATE "user" SET insta = $1 WHERE user_id = $2
UPDATE "user" SET tiktok = $1 WHERE user_id = $2
```
Executed only when reporter responds "ya konfirmasi ig/tiktok" to a live PendingConfirmation session.

**Validation rules**: NRP provided in complaint must match `user_id` exactly (case-sensitive).  
If no match → `diagnosisCode: 'UNKNOWN'` with instruction to complete NRP.

---

### 2. `insta_like` (table)

Stores Instagram like data per post. Used to count audit like activity for complaint triage.

| Column | Type | Role in Feature |
|--------|------|-----------------|
| `shortcode` | `varchar` PK/FK → `insta_post` | Post identifier |
| `likes` | `jsonb` | Array of `{username: string}` objects; queried with LATERAL join |

**Read path (complaint triage)**:  
```sql
SELECT COUNT(DISTINCT p.shortcode) AS total
FROM insta_like l
JOIN insta_post p ON p.shortcode = l.shortcode
JOIN LATERAL (
  SELECT lower(replace(trim(COALESCE(elem->>'username', ...)), '@', '')) AS username
  FROM jsonb_array_elements(COALESCE(l.likes, '[]'::jsonb)) AS elem
) AS liked ON liked.username = $1
[WHERE p.created_at BETWEEN $2 AND $3]
```

**Write path**: Populated by separate data-collection processes (`fetchSinglePostKhusus`, `handleFetchLikesInstagram`). Out of scope for this feature — data is treated as read-only here.

---

### 3. `insta_post` (table)

Instagram post metadata. Joined with `insta_like` for time-windowed audit queries.

| Column | Type | Role |
|--------|------|------|
| `shortcode` | `varchar` PK | Post identifier |
| `client_id` | `varchar` FK → `clients` | Owner client |
| `created_at` | `timestamptz` | Used for 30-minute audit window |

**Read**: Joined in audit count queries.  
**Read (FR-016 — latest post URL suggestion)**:
```sql
SELECT shortcode FROM insta_post ORDER BY created_at DESC LIMIT 1
```
URL constructed as: `https://instagram.com/p/{shortcode}`  
**Write**: Populated by separate data-collection processes. Out of scope for this feature.

---

### 4. `tiktok_comment` (table)

TikTok comment data per video. Used for complaint triage comment audit.

| Column | Type | Role |
|--------|------|------|
| `video_id` | `varchar` PK/FK | Video identifier |
| `comments` | `jsonb` | Array of raw username strings |

**Read path (complaint triage)**:  
```sql
SELECT COUNT(DISTINCT c.video_id) AS total
FROM tiktok_comment c
JOIN tiktok_post p ON p.video_id = c.video_id
JOIN LATERAL (
  SELECT lower(replace(trim(raw_username), '@', '')) AS username
  FROM jsonb_array_elements_text(COALESCE(c.comments, '[]'::jsonb)) AS raw(raw_username)
) AS commenter ON commenter.username = $1
[WHERE p.created_at BETWEEN $2 AND $3]
```

**Write path**: Populated by separate data-collection processes. Out of scope for this feature.

---

### 5. `tiktok_post` (table)

TikTok post metadata. Joined with `tiktok_comment` for audit queries.

| Column | Type | Role |
|--------|------|------|
| `video_id` | `varchar` PK | Video identifier |
| `client_id` | `varchar` FK | Owner client |
| `created_at` | `timestamptz` | Used for time-windowed audit queries |

**Read (FR-016 — latest post URL suggestion)**:
```sql
SELECT video_id FROM tiktok_post ORDER BY created_at DESC LIMIT 1
```
URL constructed as: `https://tiktok.com/video/{video_id}`

---

### 6. `clients` (table)

CICERO client registry. Used by the complaint handler to validate that an incoming message is from a registered active client group.

| Column | Type | Role in Feature |
|--------|------|---------------|
| `client_id` | `varchar` PK | Used to scope audit queries (FR-004, FR-016) |
| `nama` | `varchar` | Human-readable client name |
| `client_group` | `varchar` | WhatsApp group JID; matched against incoming message `chatId` |
| `client_status` | `boolean` | Must be `true`; inactive clients excluded from group guard (FR-001) |

**Read path (group guard — waService.js)**:  
```sql
SELECT client_group FROM clients WHERE client_status = true AND client_group IS NOT NULL AND client_group <> ''
```

**Write**: None. This feature is read-only against `clients`.

---

## In-Memory / Transient Entities

### PendingConfirmation (in-memory, TTL 15 min) — NEW

Stored in `pendingConfirmationStore.js`. Keyed by `senderJid:platform`. One entry per sender+platform.

```js
{
  senderJid: string,       // e.g. "628xxxx@s.whatsapp.net"
  platform: 'ig' | 'tiktok',
  oldUsername: string,     // Current value in DB (insta or tiktok column)
  newUsername: string,     // Value from complaint message
  nrp: string,             // user_id value for DB update
  expiresAt: number,       // Date.now() + 15 * 60 * 1000
}
```

**Set**: After `USERNAME_MISMATCH` triage — `pendingConfirmationStore.set(key, entry)`  
**Get**: When DM received — `pendingConfirmationStore.get(senderJid, platform)`  
**Delete**: After successful confirmation (FR-015) or on expiry check  
**TTL enforcement**: `get()` must check `expiresAt > Date.now()` and return `null` if expired

---

### ParsedComplaint (service object)

Produced by `complaintParser.parseComplaintMessage(text)`. Not persisted.

```js
{
  isComplaint: boolean,        // false if header "Pesan Komplain" absent
  reporter: {
    nrp: string,               // NRP/NIP extracted from message
    nama: string,              // Reported name
    polres: string,            // Satker / Polres
    igUsername: string,        // Normalized Instagram handle
    tiktokUsername: string,    // Normalized TikTok handle
  },
  issues: string[],            // Lines under "Kendala" section
  raw: { normalizedText: string }
}
```

**Validation rules**:
- `isComplaint = true` requires line matching `/^pesan\s+komplain\b/i`
- `nrp` is required for triage to proceed; empty NRP → `UNKNOWN` diagnosis
- Usernames normalized via `handleNormalizer.normalizeHandleValue()`: strip `@`, lowercase

---

### TriageResult (service object)

Produced by `complaintTriageService.triageComplaint()`. Not persisted.

```js
{
  status: 'NEED_MORE_DATA' | 'OK' | 'ERROR',
  diagnosisCode: 'UNKNOWN' | 'NRP_NOT_FOUND' | 'USERNAME_MISMATCH' | 'ACCOUNT_PRIVATE'
               | 'NO_PROFILE_PHOTO' | 'NO_CONTENT' | 'LOW_TRUST' | 'ALREADY_PARTICIPATED'
               | 'NO_ACTIVITY' | 'OK_ACTIVE_VALID' | 'EXTERNAL_NA',
  alreadyParticipated: boolean,  // Set independently of primary diagnosisCode
  confidence: number,            // 0.0–1.0
  evidence: {
    internal: {
      usernameDb: { instagram: string, tiktok: string },
      lastUsernameUpdateAt: string | null,
      auditWindowStart: string,
      auditWindowEnd: string,
      auditLikeCount: number,
      auditCommentCount: number,
      historicalAuditLikeCount: number,
      historicalAuditCommentCount: number,
      latestInstaPostUrl?: string,   // For ALREADY_PARTICIPATED suggestions (FR-016)
      latestTiktokPostUrl?: string,
      auditTableStatus?: string
    },
    rapidapi: {
      instagram?: {
        posts: number, followers: number, isPrivate: boolean, hasProfilePic: boolean, username: string
      },
      instagramDb?: {    // DB account profile (for FR-013 comparison)
        posts: number, followers: number, isPrivate: boolean, username: string
      },
      tiktok?: object,
      tiktokDb?: object,
      providerError?: { status: number, message: string }
    }
  },
  nextActions: string[],
  operatorResponse: string,
  adminSummary: string,
}
```

---

### State Transitions (Complaint Processing Flow)

---

## State Transitions

### Complaint Processing Flow (full v2 with FR-013–016)

```
Incoming message (group or DM)
  ↓
[DM] handleConfirmationReplyIfApplicable()   ← FR-015 check first
  ↓ (pendingConfirmation exists + "ya konfirmasi" keyword)
    → UPDATE "user" SET insta/tiktok WHERE user_id
    → enqueueSend(senderJid, successMsg)
    → delete PendingConfirmation
    → return (do not continue to complaint handler)

  ↓ (no active confirmation || not DM || no keyword)
shouldHandleComplaintMessage()
  ↓ (false) → ignore
  ↓ (true)
parseComplaintMessage() → { isComplaint, reporter, issues }
  ↓ (missing required fields) → enqueueSend(senderJid, instructionMsg) + return

getUserByNrp(user_id) → (not found) → enqueueSend(reply NRP_NOT_FOUND)
  ↓ (found)
getAuditCounts() [30-min + all-time]
  ↓
fetchSocialProfile(reported username) [RapidAPI, FR-005]
  → if hasMismatch: fetchSocialProfile(DB username) [FR-013 comparison]
    → storeMismatchComparisonMetrics in evidence.rapidapi.instagramDb/tiktokDb
  ↓
Evaluate triage codes (priority order):
  ACCOUNT_PRIVATE → NO_PROFILE_PHOTO → NO_CONTENT → LOW_TRUST
  → USERNAME_MISMATCH  [if hasMismatch]
  ↓ (if USERNAME_MISMATCH)
    → add to PendingConfirmation (senderJid:ig / senderJid:tiktok, 15 min)  [FR-014]
  ↓
alreadyParticipated = historicalCount > 0  [FR-016]
  ↓ (alreadyParticipated)
    → fetch latestInstaPostUrl / latestTiktokPostUrl
  ↓
buildOperatorResponse(triage, parsed) → enqueueSend(chatId, operatorResponse)  [FR-006, FR-010]
buildAdminSummary(triage, parsed)     → enqueueSend(senderJid, adminSummary)   [FR-007, FR-010]
  ↓ (if USERNAME_MISMATCH)
    → enqueueSend(senderJid, confirmationDmText)  [FR-014]
```

### PendingConfirmation Lifecycle

```
Created: after USERNAME_MISMATCH triage → pendingConfirmationStore.set(key, { ..., expiresAt: now+15min })
Consumed: DM "ya konfirmasi ig/tiktok" → pendingConfirmationStore.get(key) → UPDATE DB → delete
Expired: get() returns null if expiresAt < now; no DB change
```


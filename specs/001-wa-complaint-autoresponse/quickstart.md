# Quickstart: WhatsApp Auto-Response — Complaint

**Feature**: `001-wa-complaint-autoresponse`  
**Branch**: `003-sosmed-task-autoresponse`

---

## Prerequisites

- Node.js v22 (ESM — `"type": "module"`)
- PostgreSQL (CICERO DB running and accessible)
- Redis (for BullMQ outbox queue)
- A `.env` file populated from `.env.example` (never commit `.env`)
- A registered WhatsApp session in the `WA_AUTH_DATA_PATH` directory

---

## Local Dev Setup

```bash
npm install
cp .env.example .env   # edit DATABASE_URL, REDIS_URL, RAPIDAPI_KEY, etc.
npm run dev            # starts gateway with nodemon (hot reload)
```

---

## Running Tests

```bash
# Lint first (Constitution III gate)
npm run lint

# Run the full test suite
npm test

# Run only tests related to this feature
npm test -- --testPathPattern="complaint|triage|complaintParser|pendingConfirmation|waService"
```

All tests are unit-level with mocked I/O. No live WhatsApp, PostgreSQL, or RapidAPI connections are needed.

---

## Manual End-to-End Test (Staging WA Group)

### Standard Complaint — Happy Path

1. Ensure the WA group JID is registered in `clients.client_group` with `client_status = true`.
2. Ensure the NRP `123456789` exists in the `user` table with matching `insta` / `tiktok` values.
3. Send to the registered group (or as a DM to the gateway number):

```
*Pesan Komplain*
NRP/NIP   : 123456789
Nama      : Budi Santoso
Polres    : Polres Demo
Username IG    : budi_ig_test
Username TikTok: budi_tiktok_test

*Kendala*
Like tidak masuk sejak kemarin
```

4. **Expected within 10 seconds**:
   - Bot marks message as read (1 s delay)
   - Bot replies in the group with triage summary from `buildOperatorResponse()`
   - Bot sends a private DM to the sender with admin summary from `buildAdminSummary()`

---

### Edge Case — NRP Not Registered

Replace `NRP/NIP: 123456789` with an NRP not in the `user` table.  
Expected: bot replies with `NRP_NOT_FOUND` template instructing to complete NRP.

---

### Edge Case — Username Mismatch + Confirmation Flow (FR-013/014/015)

1. Use an NRP that IS in `user` table with `insta = 'budi_ig_test'`.
2. Send a complaint with `Username IG: budi_different`.
3. **Expected**:
   - Group: `USERNAME_MISMATCH` response with dual-account metrics comparison
   - DM to sender: confirmation prompt asking "Balas *ya konfirmasi ig* ..."
4. Reply to the DM with: `ya konfirmasi ig`
5. **Expected**: Bot replies with success: "Username Instagram kamu di CICERO berhasil diperbarui ke @budi_different."
6. Verify DB: `SELECT insta FROM "user" WHERE user_id = '123456789'` should return `budi_different`.

---

### Edge Case — Profile Conditions (FR-005, US2)

For each test, use a test account with the specific condition:

| Condition | Test | Expected code |
|-----------|------|---------------|
| Account private | `is_private: true` in RapidAPI mock | `ACCOUNT_PRIVATE` |
| No profile photo | `hasProfilePic: false` in mock | `NO_PROFILE_PHOTO` |
| No content | `posts: 0` in mock | `NO_CONTENT` / `LOW_TRUST` |
| RapidAPI down | Mock throws / returns 503 | `EXTERNAL_NA` flag added |

To mock RapidAPI: set `RAPIDAPI_KEY=invalid` and configure your mock in tests (see `tests/` files for patterns).

---

### Edge Case — URL as Username Input (FR-002)

Send a complaint with:
```
Username IG: https://instagram.com/johndoe
```
Expected: field is normalized to `johndoe` transparently. Reporter never sees an error.

Send a complaint with:
```
Username IG: https://instagram.com/p/ABC123/
```
Expected: normalized value is `p` → blocked by path-segment blocklist → treated as missing field → bot replies with instruction to provide a profile username.

---

## Mocking RapidAPI in Tests

Use Jest manual mocks in `src/service/__mocks__/rapidApiProfileService.js`. The `mapProviderToSocialProfile` function should return:

```js
// Success mock
{ isPrivate: false, hasProfilePic: true, posts: 42, followers: 500, username: 'test_user' }

// Private account mock
{ isPrivate: true, hasProfilePic: true, posts: 10, followers: 100, username: 'private_user' }

// No content mock
{ isPrivate: false, hasProfilePic: false, posts: 0, followers: 0, username: 'empty_user' }

// Error mock (EXTERNAL_NA)
throw new Error('ETIMEDOUT')
```

---

## Mocking PendingConfirmation in Tests

`pendingConfirmationStore.js` exports `set`, `get`, `del`. In tests, import directly and call `set(senderJid, platform, { senderJid, platform, oldUsername, newUsername, nrp, expiresAt })` to pre-populate a session before testing the confirmation DM handler.

---

## Key Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `REDIS_URL` | Redis URL for BullMQ outbox | ✅ |
| `RAPIDAPI_KEY` | API key for RapidAPI profile service | ✅ (degraded if absent) |
| `COMPLAINT_RESPONSE_DELAY_MS` | Delay before sending complaint reply (default: 3000) | No |
| `WA_AUTH_DATA_PATH` | Path to Baileys auth state directory | ✅ |
| `WA_DEBUG_LOGGING` | Set `true` to enable verbose WA debug logs | No |
| `WA_SERVICE_SKIP_INIT` | Set `true` to skip WA client init in tests | Test only |
| `GATEWAY_WA_CLIENT_ID` | Gateway client identifier (normalized to lowercase) | ✅ |
| `WA_MESSAGE_DEDUP_TTL_MS` | Override 24 h dedup TTL (default: 86400000) | No |

---

## Architecture Quick Reference

```
app.js
  └── src/service/waService.js              ← Entry point; bootstraps Baileys
        │   (on ready) attachWorker(baileysAdapter)  ← GAP-001 fix
        ├── waEventAggregator.js             ← Message-ID dedup (24 h TTL Map)
        ├── createHandleMessage()
        │     ├── DM handler: "ya konfirmasi" → waAutoComplaintService.handleConfirmationDM()
        │     │     └── pendingConfirmationStore.js  ← TTL Map, 15-min sessions
        │     └── Group/DM: "Pesan Komplain" → waAutoComplaintService.handleComplaintMessageIfApplicable()
        │           ├── complaintParser.js           ← parse + normalize usernames
        │           ├── complaintTriageService.js    ← DB lookup + RapidAPI + audit counts
        │           │     ├── FR-013: dual RapidAPI fetch for USERNAME_MISMATCH
        │           │     └── FR-016: query insta_post/tiktok_post for latest post URL
        │           └── complaintResponseTemplates.js  ← format all 10 triage codes
        └── waOutbox.js (BullMQ)             ← All outbound messages via enqueueSend()
              └── attachWorker(baileysAdapter)
```

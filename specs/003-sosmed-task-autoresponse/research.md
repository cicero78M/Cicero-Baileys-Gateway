# Research: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Feature**: `003-sosmed-task-autoresponse`  
**Date**: 2026-03-25  
**Status**: Complete — all NEEDS CLARIFICATION resolved (updated: clarify pass — 2026-03-26)

---

## Decision Log

### 1. Message Routing — Group vs DM

**Decision**: Route based on JID suffix from Baileys message object.
**Implementation**:
- `chatId.endsWith('@g.us')` → group message → **record URLs to DB + send ack only (no live fetch)**
- `chatId.endsWith('@s.whatsapp.net')` → DM → check operator registration, then choose:
  - Registered operator → live fetch + full engagement recap via DM
  - Active registration session → registration dialog handler
  - Unregistered (no session) → start registration flow

**Rationale**: Baileys JID format is stable and documented. Live fetch is DM-only per architecture decision — group path is record-and-ack only.
**Alternatives considered**: Comparing against allowlist of group JIDs (rejected — over-engineered; suffix check is sufficient for routing intent).

---

### 2. Outbound Message Delivery

**Decision**: All outbound messages MUST use `enqueueSend(jid, { text })` from `src/service/waOutbox.js`.

**Finding**: Existing `waAutoSosmedTaskService.js` currently calls `waClient.sendMessage(chatId, ...)` directly — this violates FR-008 and Constitution Principle VII. This must be remediated in this feature.

**Rationale**: `waOutbox` applies Bottleneck rate limiting (40 msg/min, 350ms min between sends) and BullMQ retry (5 attempts, exponential backoff). Direct `sendMessage` bypasses these protections.  
**Alternatives considered**: Keep direct send for ack messages (rejected — inconsistent; all outbound must be uniform).

---

### 3. Config Cache Implementation

**Decision**: In-memory `Map<cacheKey, { value, expiresAt }>` with 60-second TTL per `(client_id, config_key)` pair. Reads from PostgreSQL on cache miss or expiry.

**Rationale**: Redis is already available, but adding a Redis dependency for a 60-second config cache adds unnecessary complexity. Single-process Node.js in-memory cache is sufficient and has zero network overhead.  
**Alternatives considered**: Redis cache (rejected — overkill for 60s TTL on config values read infrequently); no cache (rejected — spec FR-016 implies performance sensitivity).

---

### 4. Registration State Machine

**Decision**: Three message-handling paths based on `operator_registration_sessions` table:

| Path | Condition | Handler |
|---|---|---|
| **Registered operator** | `operators.is_active = TRUE` for `phone_number` | `handleRegisteredOperatorBroadcast()` |
| **Active session** | Active row in `operator_registration_sessions` | `handleRegistrationDialog()` based on `stage` |
| **Unregistered, no session** | No match in either table | `handleUnregisteredBroadcast()` → create session |

**State transitions**:
```
[no session] → (broadcasts) → awaiting_confirmation
awaiting_confirmation → (ya/yes) → awaiting_satker_choice
awaiting_satker_choice → (valid number) → [registered] → process original broadcast
awaiting_confirmation → (tidak/no) → [session deleted]
awaiting_satker_choice → (invalid) → awaiting_satker_choice (resend list)
```

**Rationale**: PostgreSQL-backed state survives process restarts. TTL on `expires_at` handles abandoned sessions automatically.

---

### 5. Attempt Rate Limiting — `first_attempt_at` Column

**Decision**: Add `first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` to `operator_registration_sessions` DDL (not in spec, required for implementation of FR-019 cooldown window).

**Finding**: FR-019 specifies "N attempts within X minutes". The spec's DDL has `attempt_count` but no window-start reference. Without `first_attempt_at`, it is impossible to determine whether the count resets (window expired) or stays active (still within window).

**Rationale**: Minimal additive change — one column, same table. No new table or service dependency.

---

### 6. Task Storage — `insta_post` / `tiktok_post` vs `insta_post_khusus`

**Decision**: Write operator broadcast tasks to `insta_post` (Instagram) and `tiktok_post` (TikTok) with new columns `task_source = 'broadcast_wa'` and `operator_phone`.

**Finding**: Existing `waAutoSosmedTaskService.js` stores to `insta_post_khusus` (a separate extended schema table via `instaPostKhususModel.js`). The spec explicitly specifies using `insta_post`/`tiktok_post` (Q3 answer).

**Impact**: The existing `fetchSinglePostKhusus` call in `waAutoSosmedTaskService.js` (writes to `insta_post_khusus`) is for the recap flow, not the task-recording flow. These are separate operations and both can coexist. The new `task_source` column marks which rows were operator-sourced.

---

### 7. Constitution Alignment — Table DDL

**Decision**: All new tables MUST include `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` per Constitution Principle VI. Additions beyond spec DDL:

| Table | Spec DDL | Added for Constitution |
|---|---|---|
| `client_config` | `id`, `client_id`, `config_key`, `config_value`, `description`, `updated_at` | `created_at` |
| `operators` | `phone_number`, `client_id`, `satker_name`, `registered_at`, `is_active` | `updated_at` |
| `operator_registration_sessions` | `phone_number`, `stage`, `original_message`, `expires_at`, `attempt_count` | `created_at`, `first_attempt_at` |

---

### 8. Existing Code Refactor Scope

**Decision**: Refactor `waAutoSosmedTaskService.js` in-place; do not create a parallel replacement service.

**Findings**:
- Hardcoded `AUTO_TASK_CLIENT_ID = 'DITINTELKAM'` → replace with `clientConfigService.getConfig(clientId, 'client_group_jid')` lookup
- `waClient.sendMessage(chatId, ...)` → replace with `enqueueSend(jid, { text })`
- No DM routing logic exists → add group/DM split at top of handler
- No operator lookup → add `operatorRepository.findActiveByPhone(phoneNumber)` check
- Pino logger not used in service paths → add per FR-020

**Rationale**: File is already the correct service for this feature. Replacing it would require migrating all test coverage. Refactor is less risky than replacement.

---

### 9. Recap Engagement Response Format

**Decision**: DM path sends **3 sequential messages**: (1) engagement recap, (2) ack tugas direkam, (3) daftar tugas hari ini. Group path sends 1 message (hardcoded ack). Each is an `enqueueSend` call queued atomically to preserve order.

**Rationale**: BullMQ preserves FIFO ordering within a queue. Three DM messages arrive in sequence without artificial delay beyond Bottleneck rate limiting. Group only ever sends one ack — no engagement data sent to group. The third message (daftar tugas hari ini) provides immediate self-service verification for the operator after inputting tasks.
**Alternatives considered**: Two messages (rejected — spec FR-006b explicitly requires task list as third message following chakranarayana #8 alur).

---

### 10. Group Ack Text — Hardcoded vs `client_config`

**Decision**: Teks ack grup di-hardcode; tidak disimpan di `client_config`. `task_input_ack` config key hanya untuk jalur DM operator terdaftar.

**Rationale**: Group ack tidak memerlukan kustomisasi per satker — teks konfirmasi singkat yang sama cukup untuk semua grup. Memperkenalkan config key baru hanya untuk satu string hardcoded melanggar YAGNI (Constitution VIII). FR-016 dikecualikan eksplisit untuk FR-006a.
**Alternatives considered**: Separate `group_broadcast_ack` config key (rejected — YAGNI); expand `task_input_ack` to serve both paths (rejected — pollutes DM-specific semantic).

---

### 11. Multi-Group per Satker

**Decision**: Satu `client_group_jid` per `client_id` — single JID string, equality check.

**Rationale**: Matches existing `TEXT` schema column, simpler lookup (`jid === configuredJid`), and `clients.client_group` fallback also stores one JID. Multi-group is a future feature.
**Alternatives considered**: Comma-separated JID list (rejected — adds parsing complexity; no current requirement).

---

### 12. FR-018 Replay — Message Object Handoff

**Decision**: Pass `originalMessage` object as-is (no reconstruction) with an additional context flag `isReplay: true`.

**Rationale**: Simplest approach. All routing fields (`msg.key.remoteJid`, `msg.key.fromMe`, message body) remain intact. `isReplay: true` is the sole mechanism to skip seen-marking (FR-009) on the second pass — no other behaviour changes.
**Alternatives considered**: Reconstruct message object (rejected — risk of losing Baileys-internal fields required for routing).

---

### 13. PII Logging Policy

**Decision**: Log nomor WA penuh tanpa masking di FR-020 `info` log entries.

**Rationale**: Sistem internal instansi. Log detail diperlukan untuk debugging operasional. Tidak ada persyaratan masking PII di log internal sistem ini.
**Alternatives considered**: Mask to last 4 digits (rejected — complicates debugging; not required by applicable regulations for internal systems).

---

### 14. URL Cap per Broadcast (FR-005 step 1)

**Decision**: Maksimal **10 URL** per broadcast (gabungan IG + TikTok). URL ke-11 dan seterusnya diabaikan diam-diam dan dicatat `logger.warn`. Broadcast tidak ditolak.

**Rationale**: Operator khas mengirim 1–5 URL per broadcast. Batas 10 mencegah eksekusi tak terbatas (worst-case: 10 × 8s = 80s timeout) dan mencegah operator yang bermasalah/termasi memenuhi antrian fetch. SC-001 mendefinisikan ≤15s sebagai best-effort untuk ≤3 URL; batas 90 detik adalah hard cap.
**Alternatives considered**: Tidak ada batas (ditolak — SC-001 tidak testable tanpa batas); batas 5 (ditolak — terlalu ketat untuk team broadcast multi-platform); batas 3 (ditolak — terlalu ketat).

---

### 15. Operator Rate Limiting — FR-021

**Decision**: In-memory counter `Map<phoneNumber, { count: number, windowStart: number }>` dengan window 60 menit bergulir; maks `operator_broadcast_rate_limit` (default 20) broadcast per window. Counter tidak persist ke DB dan direset saat gateway restart.

**Rationale**: In-memory cukup untuk use case ini — window 60 menit pendek dan restart jarang terjadi. DB-backed counter (mis. Redis incr) menambah dependensi tanpa manfaat nyata. Rate limit melindungi terhadap infinite loop atau akun operator yang dikompromikan.
**Alternatives considered**: Redis-backed counter (ditolak — overhead tidak diperlukan); daily cap (ditolak — operator legitimasi tidak melebihi 20/jam).

---

### 16. Zero-URL Broadcast Edge Cases

**Decision**:
- **Jalur DM operator terdaftar**: Jika setelah ekstraksi tidak ada URL IG/TikTok valid, bot membalas **satu pesan error** dari config key `operator_no_valid_url`; tidak ada respons tiga bagian; seen-marking tetap berlaku.
- **Jalur grup klien terdaftar**: Jika tidak ada URL valid, bot **diam** (tidak merespons ke grup); catat `logger.warn`; diperlakukan seolah bukan broadcast tugas.

**Rationale**: Operator DM memberi umpan balik langsung yang dapat ditindaklanjuti. Group path tidak — mengirim "0 URL direkam" ke grup terlihat seperti bug/spam bagi anggota grup yang tidak tahu bot ada.
**Alternatives considered**: Silent both (ditolak — operator DM perlu umpan balik); ack "0 URL" ke grup (ditolak — confusing).

---

### 17. Session Re-Hydration Setelah Restart

**Decision**: Sesi registrasi di-hydrate otomatis dari DB **per pesan masuk** — handler melakukan `SELECT * FROM operator_registration_sessions WHERE phone_number = $1 AND expires_at > NOW()` sebelum setiap routing decision. Tidak ada startup logic khusus.

**Rationale**: Karena sesi disimpan di PostgreSQL (bukan memory), restart gateway transparan. Pattern per-message query sudah digunakan di routing DM. Tidak menambah startup complexity.
**Alternatives considered**: Load semua sesi aktif ke memory saat startup (ditolak — tidak perlu, dan race condition saat multiple instances).

---

### 18. DB Read Failure saat Membangun Rekap

**Decision**: Jika `getLikesByShortcode` atau `getCommentsByVideoId` gagal (koneksi timeout, query error): tampilkan `✅ [url] — N count` menggunakan nilai count dari return object fetch; **lewati baris `Partisipan:`**; catat `logger.warn`. Rekap tetap dikirim.

**Rationale**: Graceful degradation — count tersedia dari fetch return value bahkan jika DB read gagal. Menampilkan partial info lebih baik dari menampilkan ❌ (yang menyiratkan fetch gagal). Konsisten dengan prinsip tidak-blocking dalam FR-005.
**Alternatives considered**: Perlakukan sebagai API fetch gagal (❌) (ditolak — fetch berhasil, hanya baca DB partisipan yang gagal; menggunakan ❌ misleading).

---

## Best Practices Applied

- **SQL**: All queries use parameterised statements (`$1`, `$2`). Repository pattern isolates all DB access.
- **Input handling**: Phone numbers normalised to `@s.whatsapp.net` JID format for storage; strip suffix before DB lookup.
- **ESM**: All new files use `import`/`export`. No `require()`.
- **Error handling**: All async service/repository functions wrapped in `try/catch` with pino `logger.error({ err })`.
- **Idempotency**: `operator` upsert via `ON CONFLICT (phone_number) DO UPDATE`. Session row replaced on new attempt (not duplicated).

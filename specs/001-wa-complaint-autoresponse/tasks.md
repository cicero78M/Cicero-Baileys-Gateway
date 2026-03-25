# Tasks: WhatsApp Gateway — Auto-Response Pesan Komplain

**Branch**: `001-wa-complaint-autoresponse`
**Input**: [spec.md](spec.md) · [plan.md](plan.md)
**Prerequisites**: spec.md ✅, plan.md ✅
**Coverage**: FR-001 – FR-016 · GAP-001 – GAP-010 · 3 User Stories

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Dapat berjalan paralel (file berbeda, tidak saling blokir)
- **[US1]** / **[US2]** / **[US3]**: User story terkait
- File path relatif dari repository root

---

## Phase 1: Setup

**Tujuan**: Validasi baseline bersih sebelum modifikasi.

- [ ] T001 Jalankan `npm run lint` dan `npm test` di repository root — pastikan suite berjalan tanpa error (baseline gate)

---

## Phase 2: Foundational — Infrastructure Fixes (Blocking Prerequisites)

**Tujuan**: Empat perbaikan infrastruktur yang memblokir seluruh user story. Tidak ada story yang dapat berfungsi sampai fase ini selesai.

**⚠️ CRITICAL**: Seluruh pekerjaan US1, US2, US3 bergantung pada selesainya fase ini.

- [ ] T002 Di `src/service/waService.js`: tambahkan `import { attachWorker } from './waOutbox.js'`; di dalam handler `connection.update` saat `connection === 'open'`, panggil `attachWorker(baileysSocketAdapter)` sekali lalu log via pino logger: `logger.info('WA client ready — outbox worker attached')` (GAP-001 · FR-010 · Constitution VII)
- [ ] T003 [P] Di `src/service/waService.js`: query `allowedGroupIds` dari tabel `clients` (kolom `client_group`) dan wire ke dalam `shouldHandleComplaintMessage` / `handleComplaintMessageIfApplicable` sehingga pesan dari grup yang bukan `allowedGroupIds` langsung diabaikan tanpa proses lebih lanjut (GAP-007 · FR-001)
- [ ] T004 [P] Di `src/service/waAutoComplaintService.js`: tambahkan `import { enqueueSend } from './waOutbox.js'`; ganti **semua** panggilan `waClient.sendMessage(jid, payload)` di dalam `sendComplaintMessages()` dan `handleComplaintMessageIfApplicable` dengan `await enqueueSend(jid, payload)`; hapus parameter `waClient` dari `sendComplaintMessages` jika setelah penggantian satu-satunya sisa penggunaan `waClient` adalah `markSeen`; pastikan `markSeen` tetap dipanggil via `waClient` langsung (FR-010 · FR-011 · GAP-008 · Constitution VII)
- [ ] T005 [P] Di `src/service/complaintParser.js`: setelah memanggil `handleNormalizer.normalizeHandleValue(raw)`, tambahkan guard `if (!normalized || normalized.length < 3) return '';` — guard ini adalah pengecekan terakhir setelah stripping `@`, ekstraksi dari URL, dan penolakan segmen jalur sistem (GAP-009 · FR-002)
- [ ] T006 [P] Buat `tests/waServiceOutbox.test.js`: (a) mock `attachWorker` via `jest.fn()` dan assert dipanggil tepat sekali ketika `connection === 'open'` di-emit; (b) assert `attachWorker` TIDAK dipanggil untuk state `'connecting'` atau `'close'`; (c) simulasikan `'open'` dipanggil dua kali (reconnect) — harus aman, tidak crash, tidak duplikasi efek samping (GAP-001 · FR-010)
- [ ] T007 [P] Buat `tests/complaintParserNormalize.test.js`: test cases min-length + URL normalization — `'p'` → `''` (panjang 1); `'ab'` → `''` (panjang 2); `'abc'` → `'abc'` (lolos); `'https://instagram.com/p/ABC123/'` → `''` (normalizer returns `'p'`, lalu min-length blocks); `'@johndoe'` → `'johndoe'`; `'https://instagram.com/johndoe'` → `'johndoe'`; `'https://tiktok.com/@johndoe'` → `'johndoe'`; URL dengan trailing slash dan query string dinormalisasi dengan benar; **bold/italic marker tests (A1+I4)**: `'*johndoe*'` → `'johndoe'` (bold WA marker stripped sebelum normalisasi lainnya); `'_johndoe_'` → `'johndoe'` (italic marker stripped); header `'*Pesan Komplain*'` dikenali sebagai trigger valid sama seperti plain-text setelah stripping (GAP-009 · FR-001 · FR-002)

**Checkpoint**: BullMQ worker terhubung ke adapter; group filter aktif dari DB; semua send di complaint path melalui `enqueueSend`; parser min-length guard aktif. Jalankan `npm test -- tests/waServiceOutbox.test.js tests/complaintParserNormalize.test.js` dan pastikan kedua file hijau.

---

## Phase 3: User Story 1 — Member Mengajukan Komplain via WhatsApp (P1) 🎯 MVP

**Tujuan**: Keseluruhan complaint response flow (parse → triage → group reply + admin DM) berjalan through BullMQ outbox — bukan `waClient.sendMessage` langsung.

**Independent Test**: Kirim pesan "Pesan Komplain" valid ke grup WA terdaftar (terdaftar di `clients.client_group`) → bot membalas di grup dengan triage summary dan ke pengirim dengan admin DM, keduanya dalam ≤ 10 detik melalui BullMQ; pesan dari grup tidak terdaftar diabaikan; `status@broadcast` diabaikan; pesan dari gateway sendiri diabaikan.

### Implementation

- [ ] T008 [US1] Di `src/service/waAutoComplaintService.js`: verifikasi setelah T004 bahwa `markSeen(chatId)` / `sendSeen` tetap dipanggil langsung via `waClient` sebelum `enqueueSend` (bukan diqueue); pastikan semua log menggunakan `logger` dari `src/utils/logger.js` — tidak ada `console.log` / `console.error` baru (FR-011 · FR-006 · FR-007 · Constitution V)
- [ ] T009 [P] [US1] Perbarui atau buat `tests/waAutoComplaintService.test.js` — tambahkan/verifikasi assertion: (a) `enqueueSend` dipanggil dengan `(chatId, { text: <operator response> })` untuk reply grup; (b) `enqueueSend` dipanggil dengan `(senderJid, { text: <admin summary> })` untuk DM admin; (c) `markSeen` (atau `sendSeen`) dipanggil sebelum `enqueueSend` saat komplain valid (FR-011 regression guard); (d) `enqueueSend` TIDAK dipanggil jika pesan bukan komplain valid; (e) pesan dari ID gateway sendiri (`isGatewayComplaintForward` guard) tidak menghasilkan `enqueueSend` (FR-008); (f) `status@broadcast` diabaikan tanpa `enqueueSend` (FR-012)

**Checkpoint**: US1 fully functional — valid complaint diproses, `buildOperatorResponse` + `buildAdminSummary` dikirim via BullMQ. `tests/waAutoComplaintService.test.js` hijau.

---

## Phase 4: User Story 2 — Komplain dengan Profil Sosmed Tidak Aktif (P2)

**Tujuan**: Distinct triage codes untuk kondisi profil bermasalah (`ACCOUNT_PRIVATE`, `NO_PROFILE_PHOTO`, `NO_CONTENT`, `LOW_TRUST`) beserta profile links langsung dan template respons yang sesuai.

**Independent Test**: Kirim komplain dengan mock RapidAPI mengembalikan `is_private: true` → respons berisi `ACCOUNT_PRIVATE` + link profil + instruksi ganti publik. Kirim dengan `profile_pic_url: null` → `NO_PROFILE_PHOTO`. Kirim dengan `media_count: 0` → `NO_CONTENT` + `LOW_TRUST` + panduan 4-langkah. Kirim dengan RapidAPI timeout → bot tetap merespons dengan data internal saja (`EXTERNAL_NA` flag additive).

### Implementation

- [ ] T010 [US2] Di `src/service/complaintTriageService.js`: refactor `assessLowTrust` menjadi pengecekan eksplisit terpisah sesuai rantai prioritas triage — `ACCOUNT_PRIVATE` saat `profile.isPrivate === true`; `NO_PROFILE_PHOTO` saat `profile.hasProfilePic === false`; `NO_CONTENT` + `LOW_TRUST` saat `profile.posts === 0` (keduanya dilaporkan sebagai kode terpisah dalam multi-code output); hapus pengecekan `recentActivityScore < 10` lama; simpan profile links di `triageResult.evidence.profileLinks`: IG → `https://instagram.com/${username}`, TikTok → `https://tiktok.com/@${username}` (GAP-002 · FR-005)
- [ ] T011 [P] [US2] Di `src/service/complaintResponseTemplates.js`: tambahkan fungsi helper `buildProfileLink(platform, username)` mengembalikan `https://instagram.com/${username}` atau `https://tiktok.com/@${username}`; tambahkan template branch untuk `ACCOUNT_PRIVATE` (instruksi ganti ke publik + link profil); `NO_PROFILE_PHOTO` (instruksi tambah foto + link profil); `NO_CONTENT` / `LOW_TRUST` (panduan 4-langkah aktivasi akun + link profil); pastikan `EXTERNAL_NA` ditambahkan sebagai flag additive di samping kode utama di output `buildOperatorResponse` (GAP-010 · FR-005 · FR-006)
- [ ] T012 [P] [US2] Buat `tests/complaintTriageProfileCodes.test.js`: (a) mock profil `isPrivate: true` → `ACCOUNT_PRIVATE` ada di `diagnoses`; (b) mock `hasProfilePic: false` → `NO_PROFILE_PHOTO` ada; (c) mock `posts: 0` → `NO_CONTENT` **dan** `LOW_TRUST` keduanya ada; (d) RapidAPI throws network error → `EXTERNAL_NA` ada sebagai flag, triage tetap selesai dengan data internal; (e) `triageResult.evidence.profileLinks` terisi URL yang benar untuk setiap kondisi bermasalah (GAP-002 · FR-005)

**Checkpoint**: US2 profile detection menghasilkan kode terpisah per kondisi; response templates menyertakan link profil dan panduan kondisi spesifik. `tests/complaintTriageProfileCodes.test.js` hijau.

---

## Phase 5: User Story 3 — Perbedaan Username & Konfirmasi Perubahan Data (P2)

**Tujuan**: Deteksi `USERNAME_MISMATCH` dengan perbandingan dual RapidAPI, alur konfirmasi interaktif (DM + "ya konfirmasi" reply → DB UPDATE), dan `ALREADY_PARTICIPATED` check dengan latest post URL.

**Independent Test**: (1) Kirim komplain dengan username berbeda dari DB → bot membalas di grup dengan metrik kedua akun + DM konfirmasi ke pengirim. (2) Balas "ya konfirmasi ig" dalam 15 menit → DB kolom `insta` terupdate, bot kirim konfirmasi. (3) Kirim komplain reporter yang sudah pernah berpartisipasi → `ALREADY_PARTICIPATED` di respons grup + latest post URL.

### pendingConfirmationStore — GAP-004

- [ ] T013 [US3] Buat `src/service/pendingConfirmationStore.js`: TTL Map in-memory keyed by `${senderJid}:${platform}`; TTL 15 menit dari creation; **max 1 000 entries dengan LRU eviction** — saat Map mencapai batas, entry terlama dieviksi sebelum insert baru (konsisten dengan pola FR-009; Constitution VII); ekspor tiga fungsi: `setConfirmation(senderJid, platform, data)` — menyimpan `{ senderJid, platform, oldUsername, newUsername, nrp, expiresAt: Date.now() + 15*60*1000 }`; jika key sudah ada, **timpa** entry lama (data + TTL diperbarui); `getConfirmation(senderJid, platform)` — cek `data.expiresAt > Date.now()`, hapus entry stale, return null jika expired; `deleteConfirmation(senderJid, platform)` (GAP-004 · FR-014 · Constitution VII · C1)
- [ ] T014 [P] [US3] Buat `tests/pendingConfirmationStore.test.js`: (a) set lalu get dalam TTL mengembalikan data yang benar; (b) get setelah expired (mock `Date.now` melewati batas 15 menit) mengembalikan null; (c) entry expired dihapus dari Map saat `get` (tidak ada memory leak); (d) `deleteConfirmation` menghapus entry yang ada; (e) `getConfirmation` pada key yang tidak ada mengembalikan null; (f) set 1 001 entry aktif — entry terlama dieviksi dan tidak lagi bisa diambil via `getConfirmation` (LRU cap = 1 000); (g) `setConfirmation` pada key yang sudah ada menimpa data + TTL lama (U3 · C1 · GAP-004 · FR-014)

### USERNAME_MISMATCH Dual-Fetch — GAP-003

- [ ] T015 [US3] Di `src/service/complaintTriageService.js`: saat `USERNAME_MISMATCH` terdeteksi, gunakan `Promise.all([mapProviderToSocialProfile(platform, reportedUsername), mapProviderToSocialProfile(platform, dbUsername)])` untuk fetch paralel; hitung relevance score: `score = followers_count + media_count`, penalti jika `isPrivate === true`; tentukan `moreRelevant: 'reported' | 'db'`; simpan `{ reportedProfile, dbProfile, moreRelevant }` di `triageResult.evidence.mismatch`; tangani kegagalan parsial (satu call throw) dengan graceful fallback — mismatch tetap dilaporkan dengan data yang tersedia; **WAJIB [H1]: `reportedProfile` hasil `Promise.all` HARUS diteruskan langsung ke pemeriksaan kondisi profil GAP-002 (`assessProfileConditions(reportedProfile)`) — tidak boleh ada pemanggilan `mapProviderToSocialProfile` ketiga untuk `reportedUsername` yang sama dalam satu eksekusi triage; worst-case path (parallel): `max(5 000 ms, 5 000 ms) = 5 000 ms` ≤ SC-001 budget — eksekusi sequential dilarang** (GAP-003 · FR-013 · H1)

### Repository Layer — C1 Fix

- [ ] T027 [US3] Buat `src/repository/complaintRepository.js`: ekspor **empat** fungsi — (a) `async function updateUserSocialHandle(userId, platform, handle)`: parameterized `UPDATE "user" SET insta = $1 WHERE user_id = $2` (instagram) atau `tiktok` equivalent; lempar `Error('Unknown platform')` jika platform tidak dikenal; (b) `async function getLatestPost(clientId, platform)`: parameterized `SELECT shortcode FROM insta_post WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1` (IG) atau `SELECT video_id FROM tiktok_post WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1` (TikTok), kembalikan `{ shortcode }` / `{ videoId }` atau `null`; (c) `async function getUserByNrp(userId)`: parameterized `SELECT user_id, insta, tiktok FROM "user" WHERE user_id = $1`, kembalikan row atau `null` — **migrasi FR-003 existing SQL ke repository layer (C2)**; (d) `async function getAuditCounts(userId, platform, windowMs)`: parameterized query ke `insta_like`/`tiktok_comment` JSONB menggunakan existing audit query pattern, kembalikan `{ recentCount, allTimeCount }` — **migrasi FR-004 existing SQL ke repository layer (C2)**; semua fungsi import `pool` dari koneksi DB yang ada di codebase; semua query gunakan `$1`, `$2`, dst params — Constitution I + Constitution VI. Setelah membuat repository, update `complaintTriageService.js` untuk menggunakan `getUserByNrp()` dan `getAuditCounts()` menggantikan SQL inline yang ada (C2 · C1 · FR-003 · FR-004 · FR-015 · FR-016 · GAP-005 · GAP-006)

### ALREADY_PARTICIPATED + Latest Post URL — GAP-006

- [ ] T016 [P] [US3] Di `src/service/complaintTriageService.js`: setelah menghitung audit counts (all-time), jika `allTimeCount > 0` tambahkan `ALREADY_PARTICIPATED` ke diagnoses; panggil `complaintRepository.getLatestPost(triageResult.context.clientId, platform)` — kembalikan `{ shortcode }` atau `{ videoId }` atau null; bangun URL: IG → `https://instagram.com/p/${shortcode}`, TikTok → `https://tiktok.com/video/${videoId}`; simpan di `triageResult.evidence.latestPostUrl` (null jika tidak ada postingan); import `complaintRepository` dari `'../repository/complaintRepository.js'` (GAP-006 · FR-016 · C1 · T027-prerequisite)

### FR-014 DM Send + setConfirmation — GAP-004 (lanjutan)

- [ ] T017 [US3] Di `src/service/waAutoComplaintService.js`: setelah respons grup `USERNAME_MISMATCH` dienqueue, (1) bangun body DM via `complaintResponseTemplates.buildMismatchConfirmationDM(triageResult, parsed)`; (2) `await enqueueSend(senderJid, { text: dmBody })`; (3) `setConfirmation(senderJid, platform, { senderJid, platform, oldUsername: dbUsername, newUsername: reportedUsername, nrp, expiresAt: Date.now() + 15*60*1000 })` (GAP-004 · FR-014)

### handleConfirmationDM Handler — GAP-005

- [ ] T018 [US3] Di `src/service/waAutoComplaintService.js`: implementasi dan ekspor `handleConfirmationDM(msg, senderId)` — (1) guard: `!msg.key.remoteJid.endsWith('@g.us')` (pesan grup diabaikan, return false); (2) match body terhadap `/ya konfirmasi (ig|tiktok)/i`; (3) resolve platform: `ig` → `'instagram'`, `tiktok` → `'tiktok'`; (4) `const session = getConfirmation(senderJid, platform)` — jika null, return false tanpa respons; (5) panggil `complaintRepository.updateUserSocialHandle(session.nrp, platform, session.newUsername)` — SQL ada di repository, bukan di file ini (Constitution I + VI · T027-prerequisite); (6) `await enqueueSend(senderJid, { text: successMessage })`; (7) `deleteConfirmation(senderJid, platform)`; (8) log via pino; (9) return true (GAP-005 · FR-015 · C1)
- [ ] T019 [P] [US3] Di `src/service/waService.js`: wire `handleConfirmationDM` sebelum pemeriksaan complaint — `import { handleConfirmationDM } from './waAutoComplaintService.js'`; tambahkan: `if (!fromGroup && await handleConfirmationDM(msg, senderId)) return;` (GAP-005 · FR-015)

### Response Templates US3 — GAP-010 (lanjutan)

- [ ] T020 [P] [US3] Di `src/service/complaintResponseTemplates.js`: (a) buat fungsi `buildMismatchConfirmationDM(triageResult, parsed)` — body DM berisi username CICERO saat ini, username di komplain, ringkasan metrik perbandingan (`reportedProfile` vs `dbProfile`), saran akun lebih relevan, instruksi `"Balas *ya konfirmasi ig* atau *ya konfirmasi tiktok* untuk memperbarui data"`; (b) tambahkan branch `ALREADY_PARTICIPATED` di `buildOperatorResponse` — participation notice + `latestPostUrl` + saran komentar ulang (fallback ke instruksi generik jika `latestPostUrl === null`); (c) tambahkan branch `USERNAME_MISMATCH` di `buildOperatorResponse` — metrik dual-account + profile links keduanya (GAP-010 · FR-013 · FR-014 · FR-016)

### Tests US3

- [ ] T021 [P] [US3] Buat `tests/complaintConfirmationDM.test.js`: (a) "ya konfirmasi ig" dari DM dengan sesi aktif → DB UPDATE dipanggil dengan params correct + `enqueueSend` dipanggil + session dihapus; (b) "ya konfirmasi tiktok" → kolom `tiktok` yang diupdate; (c) pesan dari JID grup (`@g.us`) → return false, tidak ada DB call; (d) tidak ada sesi aktif untuk sender → return false, tidak ada DB call; (e) sesi expired (`getConfirmation` return null) → return false tanpa respons; (f) "Ya Konfirmasi IG" (uppercase) → case-insensitive match benar (GAP-005 · FR-015)
- [ ] T022 [P] [US3] Tambahkan test cases ke `tests/complaintTriageProfileCodes.test.js`: (a) `allTimeCount > 0` → `ALREADY_PARTICIPATED` ada di diagnoses + `latestPostUrl` terisi; (b) `allTimeCount > 0` dan tidak ada baris di `insta_post` → `latestPostUrl === null` + instruksi generik dipakai; (c) `USERNAME_MISMATCH` → `Promise.all` RapidAPI dipanggil untuk kedua username + `moreRelevant` ditentukan dengan benar; (d) kedua RapidAPI call gagal → `triageResult.evidence.mismatch` memiliki error markers tapi triage tetap selesai; **(e) `USERNAME_MISMATCH` + kondisi profil aktif bersamaan → mock `mapProviderToSocialProfile` dipanggil tepat 2 kali (tidak 3 kali) — memverifikasi `reportedProfile` dari dual-fetch digunakan ulang oleh `assessProfileConditions`, bukan di-fetch ulang; assert kedua call dijalankan via `Promise.all` (parallel), bukan sequential** (GAP-003 · GAP-006 · FR-013 · FR-016 · H1 · I1)

**Checkpoint**: US3 alur konfirmasi end-to-end berfungsi — mismatch dideteksi, DM terkirim, DB terupdate via "ya konfirmasi"; ALREADY_PARTICIPATED dilaporkan dengan post URL. Jalankan `npm test -- tests/pendingConfirmationStore.test.js tests/complaintConfirmationDM.test.js tests/complaintTriageProfileCodes.test.js`.

---

## Phase 6: Polish & Final Gate

- [ ] T023 [P] Grep `src/service/waAutoComplaintService.js` untuk sisa panggilan `waClient.sendMessage(` — perbaiki setiap temuan dengan `enqueueSend` (GAP-008 completeness check · FR-010)
- [ ] T024 [P] Verifikasi `EXTERNAL_NA` bersifat additive di `buildOperatorResponse`: ketika RapidAPI tidak tersedia, `EXTERNAL_NA` muncul dalam output bersama kode utama — bukan menggantikannya (FR-005 degraded mode)
- [ ] T026 [P] Terapkan `RAPIDAPI_TIMEOUT_MS` env var (default 5 000 ms) pada semua panggilan `mapProviderToSocialProfile()` di `src/service/complaintTriageService.js` menggunakan axios timeout atau `AbortSignal.timeout()`; tambahkan test case di `tests/complaintTriageProfileCodes.test.js`: mock RapidAPI dengan delay 4 000 ms dan assert triage tetap selesai ≤ 10 detik total (SC-001 · U1 · FR-005 · FR-013)
- [ ] T028 [P] ~~Audit dan perbaiki~~  `src/service/waEventAggregator.js` — **kode sudah difix**: `MAX_DEDUP_ENTRIES = 10_000` dan `evictOldestIfFull(key)` sudah diimplementasi dan dipanggil di kedua `seenMessages.set()` call-site. Task ini adalah membuat **test coverage** `tests/waEventAggregatorDedup.test.js`: (a) insert 10 001 entry unik → `seenMessages.size === 10 000` (oldest dieviksi); (b) entry dieviksi tidak lagi dikenali sebagai duplikat jika diterima ulang; (c) TTL expiry via `cleanupExpiredMessages()` tetap berfungsi setelah LRU cap aktif; **(d) simulasi reconnect: panggil `connection.update` dengan state `'close'` kemudian `'open'` — assert `seenMessages` TIDAK dikosongkan (reconnect biasa tidak mereset dedup — FR-009 clarification [I3])**; Note: `getMessageDedupStats()` sudah ada sebagai pre-existing export — test boleh menggunakannya untuk assert `.size` (FR-009 · Constitution VII · H2 · I3)
- [ ] T029 [P] Wire cache metrics ke `/api/health/wa`: import `getMessageDedupStats` dari `src/service/waEventAggregator.js` dan tambahkan `getConfirmationStoreStat()` export ke `src/service/pendingConfirmationStore.js` (kembalikan `{ size: map.size, maxEntries: 1000 }`); tambahkan keduanya ke payload response `/api/health/wa` di bawah key `caches: { dedupMap: getMessageDedupStats(), confirmationStore: getConfirmationStoreStat() }` — Constitution V (health endpoint HARUS expose cache sizes) (C3 · Constitution V · FR-009)
- [ ] T025 Jalankan `npm run lint` diikuti `npm test` — seluruh lint rules harus pass dan semua test suite harus hijau

---

## Dependencies & Execution Order

```
Phase 1 (T001)
  └── Phase 2 (T002, T003[P], T004[P], T005[P], T006[P], T007[P])
        └── Phase 3 (T008, T009[P])          ← MVP shippable after this
              ├── Phase 4 (T010, T011[P], T012[P])
              └── Phase 5 (T013, T014[P], T027, T015, T016[P], T017, T018, T019[P], T020[P], T021[P], T022[P])
                    └── Phase 6 (T023[P], T024[P], T026[P], T028[P], T029[P], T025)
```

### User Story Dependencies

- **US1 (P1)**: Dapat dimulai setelah Phase 2 selesai — tidak bergantung pada US2 atau US3
- **US2 (P2)**: Dapat dimulai setelah Phase 2 selesai — independen dari US3; `complaintTriageService.js` di-modify berbeda dari US3
- **US3 (P2)**: Dapat dimulai setelah Phase 2 selesai — mengextend `complaintTriageService.js` (koordinasikan dengan US2 jika dikerjakan bersamaan)

### Within Each User Story

- Repository layer (T027) sebelum service changes yang melakukan DB calls melaluinya (T016, T018)
- Models / stores sebelum services yang menggunakannya (T013 sebelum T017/T018)
- Triage service changes (T015, T016) sebelum template changes yang mengkonsumsi evidence fields (T020)
- `handleConfirmationDM` implementation (T018) sebelum wiring di waService.js (T019)

---

## Parallel Execution Examples

### Phase 2 (koordinasikan file yang sama)
```bash
# T002 + T003 keduanya modify waService.js — kerjakan berurutan atau koordinasikan
# T004 + T005 bisa paralel (file berbeda: waAutoComplaintService.js vs complaintParser.js)
# T006 + T007 bisa paralel (file baru berbeda)
```

### Phase 5 (US3)
```bash
# Batch A: T013 + T014[P] + T027  (pendingConfirmationStore — create + test; complaintRepository.js — create)
# Batch B setelah T027: T015 + T016[P]  (triage dual-fetch + ALREADY_PARTICIPATED, gunakan complaintRepository)
# Batch C setelah A: T017 + T018 + T019[P] + T020[P]  (konsumsi store + repository)
# Batch D paralel setelah B+C: T021[P] + T022[P]  (test files berbeda)
```

---

## Implementation Strategy

**MVP Scope** (Phase 1–3): Complaint auto-response via BullMQ outbox berfungsi end-to-end untuk US1 — parse, triage, group reply, admin DM, dedup, dan access control. Dapat di-ship setelah T009 pass.

**Increment 2** (Phase 4): US2 profile condition detection aktif — distinct codes, profile links, `EXTERNAL_NA` degraded mode.

**Increment 3** (Phase 5): US3 mismatch confirmation flow — dual-fetch, DM konfirmasi, DB update interaktif, `ALREADY_PARTICIPATED`.

---

## FR Coverage

| FR | Deskripsi singkat | Task | Status |
|----|-------------------|------|--------|
| FR-001 | Deteksi "Pesan Komplain" dari grup terdaftar / DM saja | T003, T009 | ✅ GAP-007 fix |
| FR-002 | Parse field wajib + normalisasi username + min-length guard | T005, T007 | ✅ GAP-009 fix |
| FR-003 | Lookup NRP/NIP di tabel `user` (`WHERE user_id = $1`) | T027 | ✅ Existing → migrasi ke repository layer (C2) |
| FR-004 | Hitung aktivitas audit 30-min + all-time | T027 | ✅ Existing → migrasi ke repository layer (C2) |
| FR-005 | Verifikasi profil sosmed via RapidAPI + kondisi spesifik + link profil | T010, T011, T012, T024 | ✅ GAP-002 fix |
| FR-006 | Kirim triage result ke grup via `buildOperatorResponse()` | T004, T008, T009, T011, T020 | ✅ GAP-008 fix |
| FR-007 | Kirim admin summary ke DM pengirim via `buildAdminSummary()` | T004, T008, T009 | ✅ GAP-008 fix |
| FR-008 | Abaikan pesan dari ID gateway sendiri | — | ✅ Existing + T009 regression |
| FR-009 | Deduplikasi message ID (TTL-bounded Map, 24h, 10k LRU) | T028 | ✅ Existing + LRU cap fix |
| FR-010 | Semua outbound via BullMQ outbox (`enqueueSend`) | T002, T004, T006, T023 | ✅ GAP-001 + GAP-008 |
| FR-011 | Mark seen sebelum proses (jeda 1 detik) | T008, T009 | ✅ Regression guard |
| FR-012 | Abaikan `status@broadcast` | — | ✅ Existing + T009 regression |
| FR-013 | Dual RapidAPI fetch saat USERNAME_MISMATCH; metrik di respons grup | T015, T022 | ✅ GAP-003 |
| FR-014 | Kirim DM konfirmasi setelah mismatch + simpan sesi 15-min | T013, T014, T017, T020 | ✅ GAP-004 |
| FR-015 | Handle "ya konfirmasi" DM → UPDATE DB + kirim ACK via `enqueueSend` | T027, T018, T019, T021 | ✅ GAP-005 |
| FR-016 | `ALREADY_PARTICIPATED` + latest post URL dari `insta_post`/`tiktok_post` | T027, T016, T020, T022 | ✅ GAP-006 |

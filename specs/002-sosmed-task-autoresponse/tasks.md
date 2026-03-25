# Tasks: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Branch**: `002-sosmed-task-autoresponse`
**Input**: [spec.md](spec.md) · [plan.md](plan.md)
**Prerequisites**: spec.md ✅, plan.md ✅

**Dependency note**: Jika feature `001-wa-complaint-autoresponse` sudah di-merge ke main, T002 dan T003 dapat dilewati — `attachWorker` sudah terhubung di `waService.js`.

## Format: `[ID] [P?] Description`

- **[P]**: Dapat berjalan paralel (file berbeda, tidak saling blokir)
- File path relatif dari repository root

---

## Phase 1: Setup

- [ ] T001 Jalankan `npm run lint` dan `npm test` di repository root — pastikan suite berjalan tanpa error (baseline gate)

---

## Phase 2: Foundational — Outbox Worker Wiring (GAP-001)

**Catatan**: Lewati fase ini jika `grep -n "attachWorker" src/service/waService.js` sudah mengembalikan hasil (artinya feature 002 sudah di-merge).

- [ ] T002 Di `src/service/waService.js`: tambahkan `import { attachWorker } from './waOutbox.js';` di bagian import, lalu panggil `attachWorker(baileysAdapter)` satu kali di dalam handler `'ready'` Baileys tepat setelah `markClientReady()` (FR-008, Constitution VII)
- [ ] T003 [P] Buat `tests/waOutboxIntegration.test.js` (lewati jika sudah ada dari feature 002): unit test yang assert (a) `attachWorker` dipanggil dengan adapter saat startup; (b) `enqueueSend` mengantrikan BullMQ job dengan shape `{ jid, payload: { text } }`; (c) memanggil `attachWorker` dua kali aman (idempotent — simulasi reconnect)

**Checkpoint**: `attachWorker` terdaftar. Lewati checkpoint ini jika sudah ditangani oleh feature 002.

---

## Phase 3: GAP-003 — DM Guard (FR-002)

**Tujuan**: Pastikan handler tidak merespons pesan DM (hanya grup klien yang dilayani).

- [ ] T004 Di `src/service/waAutoSosmedTaskService.js`: tambahkan guard di baris pertama body fungsi `handleAutoSosmedTaskMessageIfApplicable` — `if (!chatId?.endsWith('@g.us')) return false;` — sebelum logika lain (GAP-003, FR-002)

---

## Phase 4: GAP-002 — Dynamic Client Resolution (FR-002)

**Tujuan**: Ganti client ID hardcoded dengan resolusi dinamis dari group JID.

- [ ] T005 Di `src/service/waAutoSosmedTaskService.js`: (1) tambahkan `import { findClientsByGroup } from './clientService.js';`, (2) hapus konstanta `AUTO_TASK_CLIENT_ID` dan fungsi `resolveTargetClientId()`, (3) setelah DM guard, tambahkan: `const clients = await findClientsByGroup(chatId); const targetClient = clients?.[0] ?? null; if (!targetClient) { logger.warn({ chatId }, 'sosmed task: grup tidak dikenali sebagai klien aktif'); return false; } const targetClientId = targetClient.client_id;`, (4) ganti semua penggunaan `resolveTargetClientId()` downstream dengan `targetClientId`, (5) semua log baru menggunakan `logger` dari `'../utils/logger.js'` — tidak boleh `console.log` (GAP-002, FR-002, Constitution V)

---

## Phase 5: GAP-001 partial — Outbox Wiring di Sosmed Task (FR-008)

**Tujuan**: Ganti semua `waClient.sendMessage` di `waAutoSosmedTaskService.js` dengan `enqueueSend`.

- [ ] T006 Di `src/service/waAutoSosmedTaskService.js`: (1) tambahkan `import { enqueueSend } from './waOutbox.js';`, (2) ganti setiap `await waClient.sendMessage(chatId, ...)` dengan `await enqueueSend(chatId, { text: <message string> })` — mencakup pesan ack, status summary, task recap, pesan error, dan notifikasi data tidak tersedia (GAP-001, FR-008)

---

## Phase 6: Tests (User Story 1)

**Tujuan**: Tambah assertions untuk semua perubahan T004–T006.

- [ ] T007 [P] Di `tests/waAutoSosmedTaskService.test.js`: tambahkan test cases — (a) DM `chatId` (berakhir `@c.us`) dengan format broadcast yang cocok → handler returns `false` dan `enqueueSend` TIDAK dipanggil; (b) grup terdaftar (`@g.us`) dengan format broadcast yang cocok → `findClientsByGroup` dipanggil dengan JID yang benar dan `targetClientId` berasal dari hasil; (c) grup tidak terdaftar → log warning, return `false`, `enqueueSend` TIDAK dipanggil; (d) semua outbound reply menggunakan `enqueueSend(chatId, { text: string })` — mock `enqueueSend` dan `findClientsByGroup` via `jest.fn()` (FR-002, FR-005, FR-006, FR-008)
- [ ] T008 [P] Grep `src/service/waAutoSosmedTaskService.js` untuk sisa panggilan `waClient.sendMessage(` — perbaiki setiap temuan dengan `enqueueSend` (memastikan FR-008 terpenuhi sepenuhnya)

**Catatan T007 dan T008**: File test dapat ditulis paralel dengan T004–T006, tetapi assertions akan gagal sampai source changes T004–T006 di-merge. Jangan push T007 ke CI sebelum T004–T006 land.

---

## Phase 7: Final Gate

- [ ] T009 Jalankan `npm run lint` diikuti `npm test` — semua lint rules harus pass dan semua test harus hijau

---

## Dependencies & Execution Order

```
Phase 1 (T001)
  └── Phase 2 (T002, T003[P])   ← Skip jika 002 sudah merged
        └── Phase 3 (T004)
              └── Phase 4 (T005)
                    └── Phase 5 (T006)
                          └── Phase 6 (T007[P], T008[P])
                                └── Phase 7 (T009)
```

---

## FR Coverage

| FR | Task | Status |
|----|------|--------|
| FR-001 detect-broadcast-keywords | Existing (`evaluateSosmedTaskBroadcast`) | ✅ No change |
| FR-002 group-only + DM guard | T004, T005, T007 | ✅ |
| FR-003 extract-urls | Existing (`classifyUrls`) | ✅ No change |
| FR-004 classify-ig-tiktok | Existing (`classifyUrls` domain check) | ✅ No change |
| FR-005 live-fetch-engagement | Existing (`instaFetchPost`, `tiktokFetchPost`) | ✅ Test T007 |
| FR-006 reply-recap | T006, T007 | ✅ |
| FR-007 ignore-non-ig-tiktok | Existing (`classifyUrls.ignoredLinks`) | ✅ No change |
| FR-008 outbox-queue | T002, T003, T006, T008 | ✅ |
| FR-009 mark-seen | Existing + covered by existing tests | ✅ No change |
| FR-010 ignore-status-broadcast | Existing early return in `waService.js` | ✅ No change |

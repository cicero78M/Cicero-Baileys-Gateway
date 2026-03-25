# Implementation Plan: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Branch**: `002-sosmed-task-autoresponse` | **Date**: 2026-03-25 | **Spec**: [spec.md](spec.md)

## Summary

Auto-response gateway untuk pesan broadcast tugas media sosial via WhatsApp. Mendeteksi pola broadcast (salam waktu + "mohon izin dibantu" + kata aksi + URL IG/TikTok) dari grup klien terdaftar, melakukan live fetch engagement data dari API Instagram/TikTok, lalu membalas dengan rekapitulasi partisipasi — semua melalui BullMQ outbox.

**Codebase status**: Domain logic sudah diimplementasi. Plan ini menutup tiga gap compliance spec:
- **GAP-001**: Outbox queue tidak terhubung (FR-008)
- **GAP-002**: Client ID di-hardcode `'DITINTELKAM'` bukan dinamis dari group JID (FR-002)
- **GAP-003**: Handler merespons DM — padahal hanya grup yang boleh dilayani (FR-002)

**Dependency note**: GAP-001 (outbox wiring di `waService.js`) mungkin sudah diselesaikan oleh feature 002. Jika branch 002 sudah di-merge ke main sebelum branch ini, task T002 (waService wiring) dapat dilewati — verifikasi dengan grep `attachWorker` di `waService.js`.

## Technical Context

**Language/Version**: Node.js 22 (ESM modules)  
**Primary Dependencies**: `@whiskeysockets/baileys`, `bullmq` + `bottleneck`, `ioredis`, `pg`, `pino`, `jest`  
**Storage**: PostgreSQL — `clients`, `insta_post`, `insta_like`, `tiktok_post`, `tiktok_comment`; Redis (BullMQ)  
**External APIs**: RapidAPI (Instagram fetch via `instaFetchPost.js`, TikTok fetch via `tiktokFetchPost.js`)  
**Performance Goal**: ≤ 15 s sosmed task response (SC-001)  
**Constraints**: Tidak ada `console.log` di production path baru; semua outbound melalui BullMQ; tidak ada client ID hardcoded

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Layered Architecture | ✅ PASS | Handler → service → model/repository chain |
| II. Naming Conventions | ✅ PASS | `camelCase` untuk semua identifier baru |
| III. Test Coverage | ✅ PASS (with delta) | Test baru diperlukan untuk DM guard, dynamic client, outbox wiring |
| IV. Security-First Design | ✅ PASS | SQL parameterized; `findClientsByGroup` sudah ada |
| V. Observability | ⚠️ REQUIRED | Log baru HARUS pakai `logger` dari `src/utils/logger.js` |
| VI. DB & Migration Discipline | ✅ N/A | Tidak ada perubahan schema |
| VII. WA Gateway Reliability | ❌ GAP-001 | Outbox tidak terhubung → wajib diperbaiki (atau sudah diselesaikan oleh 002) |
| VIII. Simplicity / YAGNI | ⚠️ REVIEW | Guard "grup tidak terdaftar" di dalam handler adalah logically reachable hanya jika `waService.js` guard dilewati — pertimbangkan apakah perlu atau cukup rely pada guard di waService |

## Project Structure

### Source Code (files to create or modify)

```text
src/
├── service/
│   ├── waService.js                  ← MODIFY (if 002 not merged): import + attach waOutbox
│   ├── waAutoSosmedTaskService.js    ← MODIFY: DM guard + dynamic client + enqueueSend
│   ├── waOutbox.js                   ← NO CHANGE
│   └── clientService.js              ← NO CHANGE: findClientsByGroup sudah ada

tests/
├── waAutoSosmedTaskService.test.js   ← MODIFY: tambah DM guard + dynamic client + outbox assertions
└── waOutboxIntegration.test.js       ← CREATE (if 002 not merged): outbox wiring test
```

## Implementation Gaps

### GAP-002 — Hardcoded Client ID (FR-002) 🟠

**Problem**: `waAutoSosmedTaskService.js` menggunakan konstanta `AUTO_TASK_CLIENT_ID = 'DITINTELKAM'` yang di-hardcode, sehingga hanya satu klien yang dilayani.

**Fix**:
```js
import { findClientsByGroup } from './clientService.js';
// Hapus AUTO_TASK_CLIENT_ID dan resolveTargetClientId()
const clients = await findClientsByGroup(chatId);
const targetClient = clients?.[0] ?? null;
if (!targetClient) {
  // grup tidak terdaftar — sudah diblokir oleh guard di waService,
  // tapi tambahkan log warning dan return false sebagai defense-in-depth
  logger.warn({ chatId }, 'sosmed task: grup tidak dikenali sebagai klien aktif');
  return false;
}
const targetClientId = targetClient.client_id;
```

### GAP-003 — DM Not Guarded (FR-002) 🟡

**Problem**: `handleAutoSosmedTaskMessageIfApplicable` tidak memeriksa apakah chat adalah grup; broadcast dari DM akan diproses.

**Fix** (tambahkan di awal function body):
```js
if (!chatId?.endsWith('@g.us')) return false;
```

### GAP-001 — Outbox Not Wired (FR-008) 🔴

Sama seperti feature 002. Jika 002 sudah di-merge, skip T002. Jika belum, terapkan persis sama:
```js
// waService.js — setelah markClientReady():
attachWorker(baileysAdapter);
```

## Data Flow

```
WA Group Message
  → waService.createHandleMessage
    → evaluateSosmedTaskBroadcast() → match
    → waClient.sendSeen(chatId) + delay 1s          [FR-009]
    → handleAutoSosmedTaskMessageIfApplicable()
      → DM guard: chatId endsWith '@g.us'?          [FR-002]
      → findClientsByGroup(chatId) → targetClient   [FR-002]
      → classifyUrls(messageText)                   [FR-003, FR-004, FR-007]
      → instaFetchPost / tiktokFetchPost (live)     [FR-005]
      → generateSosmedTaskMessage()
      → enqueueSend(chatId, { text: ack })           [FR-008]
      → enqueueSend(chatId, { text: statusSummary }) [FR-006, FR-008]
      → enqueueSend(chatId, { text: taskRecap })     [FR-006, FR-008]
```

## WA Message Contracts

### Incoming — Broadcast Tugas Sosmed

```
Selamat [pagi/siang/sore/malam], mohon izin dibantu untuk [like/comment/share] 
postingan berikut:

[URL Instagram atau TikTok]
```
Kata kunci yang wajib ada: salam waktu (pagi/siang/sore/malam) + "mohon izin dibantu" + min. 1 kata aksi + min. 1 URL IG/TikTok.

### Outgoing — Multi-message Reply (3 pesan sequential)

**Pesan 1 — Ack**:
```
⏳ Format broadcast tugas terdeteksi. Mengambil data engagement...
```

**Pesan 2 — Status Summary**:
```
📊 *REKAPITULASI TUGAS SOSMED*
📅 [Hari], [Tanggal]
━━━━━━━━━━━━━━━━━━━━━

🔗 *[URL konten]*
• Platform: Instagram / TikTok
• Like / Komentar: [n]
• Partisipan: @user1, @user2, ...

[Ulangi per URL]
```

**Pesan 3 — Task Recap** (format dari `generateSosmedTaskMessage`):
```
✅ *TASK RECAP*
Total konten diproses: [n]
Total partisipan unik: [n]
```

### Error — Grup Tidak Terdaftar

Log warning + return false (tidak ada pesan ke grup).

### Error — URL Tidak Ada Data

```
⚠️ Data engagement untuk [URL] belum tersedia di sistem.
```

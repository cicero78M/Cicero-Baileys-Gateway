# WA Message Contracts: Complaint Auto-Response

**Feature**: `001-wa-complaint-autoresponse`  
**Phase**: 1 — Design  
**Date**: 2026-03-25 (revised 2026-04-14)

This document defines the incoming and outgoing WhatsApp message contracts for the complaint auto-response feature. These are not HTTP API contracts; they define the structured text formats that the gateway parses and produces.

---

## 1. Incoming Messages

### 1.1 Structured Complaint Message (Primary Trigger)

**Trigger condition**: Message body contains a line matching `/^pesan\s+komplain\b/i` (after stripping bold decorators `*...*`).  
**Scope**: Registered `client_group` WhatsApp groups OR direct messages (DM) to the gateway number.

```
*Pesan Komplain*
NRP/NIP   : 123456789
Nama      : Budi Santoso
Polres    : Polres Kota Bandung
Username IG    : budi_sosmed
Username TikTok: budi.tiktok

*Kendala*
Like tidak masuk sejak kemarin
Komentar sudah dilakukan tapi tidak terdata
```

**Parsing rules** (enforced by `complaintParser.parseComplaintMessage`):
- Header line: `/^pesan\s+komplain\b/i` (case-insensitive; bold markers stripped)
- Field separator: `:` or `：` (full-width colon)
- Field keys (case-insensitive, prefix-matched after normalization):
  - `nrp`, `nip`, `nrp/nip` → `reporter.nrp`
  - `nama` → `reporter.nama`
  - `polres`, `satker` → `reporter.polres`
  - `username ig`, `username instagram`, `instagram` → `reporter.igUsername`
  - `username tiktok`, `tiktok` → `reporter.tiktokUsername`
- Issue section begins at line matching `/^kendala\b/` (variants: `rincian kendala`, `uraian kendala`)
- Username values are normalized via `handleNormalizer.normalizeHandleValue`: strip `@`, lowercase, extract from URLs, reject post-path segments and values < 3 chars
- Bold markers (`*`) and leading bullets are stripped from all field lines

**Minimum valid complaint**: Header + NRP + at least one username (IG or TikTok) + Kendala section.

---

### 1.2 DM Confirmation Reply (FR-015)

**Trigger condition**: Private message (DM, not from a group JID) matching `/ya konfirmasi (?:ig|tiktok)/i`.  
**Scope**: DM only. Messages from groups are silently ignored.  
**Prerequisite**: Sender must have an active `PendingConfirmation` session (see data-model.md).

```
ya konfirmasi ig
```

or

```
ya konfirmasi tiktok
```

**Parsing rules**:
- Case-insensitive match: `ya konfirmasi ig` → platform = `instagram`
- Case-insensitive match: `ya konfirmasi tiktok` → platform = `tiktok`
- Extra whitespace normalized before matching
- If sender has no active PendingConfirmation session: silently ignored — no response

---

## 2. Outgoing Messages

### 2.1 Operator Response (Group / DM Reply)

**Sent to**: The same chat the complaint arrived from (group JID or sender DM JID).  
**Produced by**: `complaintResponseTemplates.buildOperatorResponse(triageResult, parsed)`  
**Queued via**: `enqueueSend(chatId, { text })`  
**Timing**: After `COMPLAINT_RESPONSE_DELAY_MS` (default 3000 ms)

#### Variant: `NRP_NOT_FOUND`

```
Ringkasan pengecekan: NRP tidak ditemukan di sistem CICERO.
• Hasil verifikasi:
  - NRP/NIP [nrp]: tidak terdaftar di CICERO.
• Next actions:
  1) Periksa kembali NRP/NIP yang tercantum pada pesan komplain.
  2) Hubungi admin CICERO untuk pendaftaran data anggota.
```

#### Variant: `USERNAME_MISMATCH`

```
Ringkasan pengecekan: Username [platform] tidak cocok dengan data CICERO.
• Hasil verifikasi:
  - [Platform] laporan : @[reportedUsername] (followers: [N], media: [N], [publik/privat])
  - [Platform] CICERO  : @[dbUsername] (followers: [N], media: [N], [publik/privat])
  - Akun lebih relevan : @[moreRelevantUsername] (https://instagram.com/[username] atau https://tiktok.com/@[username])
• Next actions:
  1) Periksa apakah username yang kamu gunakan saat tugas berbeda dari yang tercatat di CICERO.
  2) Cek DM dari bot — kamu bisa konfirmasi pembaruan username langsung dari sana.
```

*Note: FR-013 dual-account comparison metrics are embedded in the group response. The DM confirmation is a separate message (see 2.3).*

#### Variant: `ACCOUNT_PRIVATE`

```
Ringkasan pengecekan: Akun [platform] bersifat privat.
• Hasil verifikasi:
  - @[username] terdeteksi sebagai akun PRIVAT.
  - Link profil: https://instagram.com/[username]   (atau https://tiktok.com/@[username])
• Next actions:
  1) Buka pengaturan akun [platform] → ubah ke mode Publik.
  2) Tunggu 30-60 menit setelah perubahan, lalu kirim ulang komplain jika aktivitas masih belum terdata.
```

#### Variant: `NO_PROFILE_PHOTO`

```
Ringkasan pengecekan: Akun [platform] belum memiliki foto profil.
• Hasil verifikasi:
  - @[username]: foto profil tidak terdeteksi.
  - Link profil: https://instagram.com/[username]   (atau https://tiktok.com/@[username])
• Next actions:
  1) Tambahkan foto profil di akun [platform].
  2) Setelah profil dilengkapi, tunggu sinkronisasi ±30-60 menit dan kirim ulang komplain jika diperlukan.
```

#### Variant: `NO_CONTENT`

```
Ringkasan pengecekan: Akun [platform] belum memiliki konten (media_count = 0).
• Hasil verifikasi:
  - @[username]: tidak ditemukan postingan di akun ini.
  - Link profil: https://instagram.com/[username]   (atau https://tiktok.com/@[username])
• Next actions:
  1) Set akun ke Publik (bukan privat/terkunci).
  2) Upload minimal 1 konten/postingan di akun tersebut.
  3) Aktifkan dan gunakan akun minimal 7 hari sebelum siklus audit berikutnya.
  4) Pastikan username yang digunakan sesuai dengan yang terdaftar di sistem CICERO.
```

#### Variant: `LOW_TRUST`

```
Ringkasan pengecekan: Aktivitas profil [platform] sangat rendah (media_count = 0).
• Hasil verifikasi:
  - @[username]: profil publik terdeteksi namun belum ada konten yang diposting.
  - Link profil: https://instagram.com/[username]   (atau https://tiktok.com/@[username])
• Panduan aktivasi (4 langkah):
  1) Pastikan akun bersifat publik (bukan privat/terkunci).
  2) Upload minimal 1 konten/postingan di akun tersebut.
  3) Aktifkan dan gunakan akun minimal 7 hari sebelum siklus audit berikutnya.
  4) Pastikan username yang digunakan sesuai dengan yang terdaftar di sistem CICERO.
```

#### Variant: `ALREADY_PARTICIPATED`

```
Ringkasan pengecekan: Reporter tercatat sudah pernah berpartisipasi.
• Hasil verifikasi:
  - IG laporan : @[igUsername] | IG CICERO: @[stored_ig] | Status: cocok
  - TikTok laporan: @[tiktokUsername] | TikTok CICERO: @[stored_tiktok] | Status: cocok
• Ringkasan audit:
  - Window terbaru (30 mnt): like [N] | komentar [N]
  - Historis (all-time)    : like [N] | komentar [N]
• Next actions:
  1) Data aktivitas kamu sudah tercatat di sistem. Aktivitas mungkin tertunda sinkronisasi.
  2) Saran: lakukan komentar ulang di postingan kampanye terbaru.
     Konten terbaru: [https://instagram.com/p/[shortcode] atau https://tiktok.com/video/[videoId]]
  3) Jika belum masuk setelah 60 menit, kirim screenshot bukti aksi ke admin.
```

*Note: If no recent post is found in DB, step 2 is replaced with "Silakan komentar ulang di postingan kampanye terbaru."*

#### Variant: `NO_ACTIVITY`

```
Ringkasan pengecekan: Tidak ada aktivitas audit yang terdeteksi.
• Hasil verifikasi:
  - IG laporan : @[igUsername] | IG CICERO: @[stored_ig] | Status: cocok / tidak cocok
  - TikTok laporan: @[tiktokUsername] | TikTok CICERO: @[stored_tiktok] | Status: cocok / tidak cocok
• Ringkasan audit:
  - Window terbaru (30 mnt): like 0 | komentar 0
  - Historis (all-time)    : like 0 | komentar 0
• Next actions:
  1) Pastikan like/komentar dilakukan dari akun yang tercatat di CICERO.
  2) Lakukan aksi (like/komentar) di konten resmi kampanye dan tunggu ±30-60 menit.
  3) Kirim screenshot bukti aksi jika masih belum terdata setelah 60 menit.
```

#### Variant: `OK`

```
Ringkasan pengecekan: Semua parameter normal — akun aktif dan aktivitas tercatat.
• Hasil verifikasi:
  - IG laporan : @[igUsername] | IG CICERO: @[stored_ig] | Status: cocok
  - TikTok laporan: @[tiktokUsername] | TikTok CICERO: @[stored_tiktok] | Status: cocok
• Ringkasan audit:
  - Window terbaru (30 mnt): like [N] | komentar [N]
  - Historis (all-time)    : like [N] | komentar [N]
• Next actions:
  1) Data dan aktivitas kamu sudah tercatat di sistem dengan benar.
  2) Refresh menu absensi sesuai satker/periode jika tampilan belum diperbarui.
  3) Jika masalah berlanjut, kirim link konten + screenshot bukti aksi ke admin.
```

#### Variant: `EXTERNAL_NA` (additive flag)

Appended to the primary triage message if RapidAPI is unreachable:

```
⚠️ Catatan: Layanan verifikasi profil eksternal tidak tersedia saat ini.
   Data yang ditampilkan hanya berdasarkan basis data internal CICERO.
```

#### Multi-condition behavior

When multiple conditions are detected (e.g., `USERNAME_MISMATCH` + `ACCOUNT_PRIVATE`), each condition's **Next actions** block is included in the response, grouped under the primary status header. Primary status is the highest-priority code per the triage order:

`NRP_NOT_FOUND` → `USERNAME_MISMATCH` → `ACCOUNT_PRIVATE` → `NO_PROFILE_PHOTO` → `NO_CONTENT` → `LOW_TRUST` → `ALREADY_PARTICIPATED` → `NO_ACTIVITY` → `OK`

---

### 2.2 Admin Summary (Private Reply to Sender)

**Sent to**: The private JID of the message sender (`senderId@c.us`).  
**Produced by**: `complaintResponseTemplates.buildAdminSummary(triageResult, parsed)`  
**Queued via**: `enqueueSend(senderJid, { text })`  
**Timing**: After second `COMPLAINT_RESPONSE_DELAY_MS` delay (3000 ms after group reply)  
**Condition**: Only sent if `senderJid !== chatId` (not a DM — avoids double-reply)

**Format**:

```
[Admin Summary] Komplain dari: [nama] (NRP: [nrp])
Satker : [polres]
Platform: IG=@[ig] / TikTok=@[tiktok]
Status  : [primary diagnosis code]

Detail verifikasi:
• IG laporan : @[igUsername] → [profil: publik/privat | foto: ya/tidak | media: N]
• IG CICERO  : @[stored_ig]
• TikTok laporan: @[tiktokUsername] → [profil: publik/privat | foto: ya/tidak | media: N]
• TikTok CICERO: @[stored_tiktok]

Audit:
• Window (30 mnt): like [N] | komentar [N]
• All-time       : like [N] | komentar [N]

Next actions:
[full action list including all detected conditions]
```

---

### 2.3 USERNAME_MISMATCH DM Confirmation (FR-014)

**Sent to**: The private JID of the reporter (sender of the complaint).  
**Produced by**: `complaintResponseTemplates.buildMismatchConfirmationDM(triageResult, parsed)`  
**Queued via**: `enqueueSend(senderJid, { text })`  
**Timing**: After group response is queued (second `COMPLAINT_RESPONSE_DELAY_MS`)  
**Condition**: Only when `USERNAME_MISMATCH` is in the triage diagnoses list

```
Halo [nama],

Kami mendeteksi perbedaan username [platform] antara data CICERO dan pesan komplain kamu:

• Username di CICERO  : @[dbUsername]
  (https://instagram.com/[dbUsername] atau https://tiktok.com/@[dbUsername])
  Followers: [N] | Postingan: [N] | Status: [Publik/Privat]

• Username di komplain: @[reportedUsername]
  (https://instagram.com/[reportedUsername] atau https://tiktok.com/@[reportedUsername])
  Followers: [N] | Postingan: [N] | Status: [Publik/Privat]

Akun yang tampaknya lebih relevan: @[moreRelevantUsername]

Jika kamu ingin memperbarui data di CICERO, balas pesan ini dengan:
  *ya konfirmasi ig*   — untuk memperbarui username Instagram
  *ya konfirmasi tiktok* — untuk memperbarui username TikTok

Konfirmasi berlaku selama 15 menit. Setelah itu sesi kadaluarsa dan kamu perlu mengajukan komplain baru.
```

*If RapidAPI is unavailable and no metrics are available, the followers/postingan/status lines are replaced with "(data tidak tersedia)".*

---

### 2.4 Confirmation Success Message (FR-015)

**Sent to**: The private JID of the reporter (same DM thread as 2.3).  
**Queued via**: `enqueueSend(senderJid, { text })`  
**Timing**: Immediately after successful DB `UPDATE`

```
✅ Username [platform] kamu di CICERO berhasil diperbarui ke @[newUsername].

Data baru:
• [Platform]: @[newUsername]

Kamu bisa mengajukan komplain baru untuk verifikasi ulang jika diperlukan.
```

---

## 3. Non-Response Behaviors (Silence Contracts)

| Condition | Behavior |
|-----------|----------|
| Message from unregistered group | Silently ignored (group guard in `waService.js`) |
| `status@broadcast` message | Silently ignored (FR-012) |
| Message from gateway/bot itself | Silently ignored — `isGatewayComplaintForward` guard |
| Complaint without "Pesan Komplain" header | Silently ignored |
| Duplicate message-ID within 24 h | Silently ignored (`waEventAggregator` dedup) |
| DM with "ya konfirmasi" but no active session | Silently ignored — no response, no DB change |
| "ya konfirmasi" received from a group message | Silently ignored (FR-015 DM-only restriction) |


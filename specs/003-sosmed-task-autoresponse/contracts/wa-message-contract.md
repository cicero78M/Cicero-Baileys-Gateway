# WA Message Contracts: Auto-Response Fetch Tugas Sosmed

**Feature**: `003-sosmed-task-autoresponse`  
**Date**: 2026-03-25  
**Interface Type**: WhatsApp message protocol (Baileys)

This document defines the inbound message patterns the handler recognises and the outbound message schemas the bot produces.

---

## Inbound Message Contracts

### Contract 1 — Broadcast Tugas Sosmed (dari grup klien atau DM operator terdaftar)

**Trigger condition** (semua harus terpenuhi, threshold score ≥ 3):
1. Pesan berisi salam waktu: `pagi` | `siang` | `sore` | `malam` *(+1)*
2. Pesan berisi frasa wajib: `mohon izin dibantu` *(+1)*
3. Pesan berisi ≥ 1 kata aksi: `like` | `comment` | `share` | `follow` | `subscribe` | `repost` *(+1 per kata, max +2)*
4. Pesan berisi ≥ 1 URL Instagram atau TikTok *(+1)*

**Example**:
```
Selamat pagi, mohon izin dibantu untuk like dan comment postingan berikut:
https://www.instagram.com/reel/AbCdEfGhIjK/
https://www.tiktok.com/@username/video/1234567890
```

**Fields extracted**:
```js
{
  senderPhone: string,       // e.g. "628123456789" (JID suffix stripped)
  chatId: string,            // Baileys JID: "...@g.us" (group) or "...@s.whatsapp.net" (DM)
  isGroup: boolean,
  instagramUrls: string[],   // all instagram.com / ig.me URLs found
  tiktokUrls: string[],      // all tiktok.com / vm.tiktok.com URLs found
  rawText: string            // original message text (stored as original_message)
}
```

---

### Contract 2 — Registrasi: Konfirmasi (DM dari nomor belum terdaftar)

**Trigger condition**: Active session with `stage = 'awaiting_confirmation'` exists for `senderPhone`.

**Expected reply formats recognised as `ya`**:
- `ya`, `yes`, `iya`, `y`, `ok`, `okay`, `setuju`, `benar`, `betul`, `daftar`

**Expected reply formats recognised as `tidak`**:
- `tidak`, `no`, `batal`, `cancel`, `n`, `stop`, `tolak`

---

### Contract 3 — Registrasi: Pilih Satker (DM dari nomor belum terdaftar)

**Trigger condition**: Active session with `stage = 'awaiting_satker_choice'` exists for `senderPhone`.

**Expected reply format**: Integer string representing list position (e.g., `"3"`).

**Valid range**: `1` to `N` where `N` = total active satker in `clients` table.

---

## Outbound Message Contracts

### Response A — Ack Deteksi Broadcast (grup, hardcoded)

Sent to the group JID immediately upon detecting a valid broadcast. Teks **hardcoded** (tidak dari `client_config`). No live fetch — group path records URLs + sends this ack only.

```
Ack! Tugas broadcast sosmed {tanggal panjang} berhasil direkam. {n} URL telah dicatat.
```

Variabel:
- `{tanggal panjang}` — mis. `Selasa, 25 Maret 2026`
- `{n}` — total URL (IG + TikTok) yang berhasil diekstrak dan direkam ke DB

---

### Response B — Recap Engagement Lengkap (DM ke operator terdaftar)

Sent via DM after live fetch completes for all URLs. **Only on the DM-registered-operator path.**

```
*Rekap Tugas Sosmed*
📅 {namaHari}, {tanggal panjang}

Instagram ({n} konten):
  ✅ https://instagram.com/reel/xxx — {like_count} likes, {comment_count} komentar
     Partisipan: @user1, @user2, ...
  ❌ https://instagram.com/reel/yyy — data belum tersedia

TikTok ({m} konten):
  ✅ https://tiktok.com/@u/video/zzz — {comment_count} komentar
     Partisipan: @user3, @user4, ...
```

*(Diikuti oleh Response C — ack tugas direkam)*

---

### Response C — Ack Tugas Direkam (DM ke operator terdaftar)

Sent when DM broadcast from registered operator is processed.

```
Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.
```

*(Template from `client_config.task_input_ack` with `{client_id}` replaced)*

---

### Response D — Prompt Konfirmasi Registrasi (DM ke nomor belum terdaftar)

```
Anda mengirim pesan tugas untuk dieksekusi, tapi database kami belum membaca Satker Asal anda.
Apakah anda ingin mendaftarkan nomor anda sebagai operator tugas? (ya/tidak)
```

*(Template from `client_config.operator_unregistered_prompt`)*

---

### Response E — Daftar Satker (DM, setelah operator konfirmasi)

```
Pilih Satker Anda dengan membalas nomor urut:
1. Polres A
2. Polres B
3. Dit. Intelkam
...
```

*(Header from `client_config.operator_satker_list_header`; list generated dynamically from `clients WHERE client_status = TRUE ORDER BY nama`)*

---

### Response F — Konfirmasi Registrasi Berhasil (DM)

```
Nomor Anda berhasil terdaftar sebagai operator untuk Dit. Intelkam. Anda dapat mengirim pesan tugas kembali.
```

*(Template from `client_config.operator_registration_ack` with `{satker_name}` replaced)*

---

### Response G — Registrasi Ditolak (DM)

```
Baik, pendaftaran dibatalkan.
```

*(Template from `client_config.operator_registration_declined`)*

---

### Response H — Pilihan Tidak Valid (DM)

```
Pilihan tidak valid. Silakan balas dengan nomor urut.
```

*(Template from `client_config.operator_invalid_choice`)*  
Followed immediately by Response E (daftar satker ditampilkan ulang).

---

### Response I — Tidak Ada Satker Aktif (DM)

```
Tidak ada Satker aktif. Hubungi administrator.
```

*(Template from `client_config.operator_no_satker`)*

---

## Message Delivery Rules

| Rule | Detail |
|---|---|
| All outbound | Via `enqueueSend(jid, { text })` from `waOutbox.js` |
| Rate limit | 40 msg/min, 350ms min between sends (Bottleneck, enforced by `waOutbox`) |
| Retry | 5 attempts, exponential backoff from 2s (BullMQ, enforced by `waOutbox`) |
| Group ack | Response A sent to `@g.us` JID matching `client_group_jid` (equality check); **no live fetch on group path** |
| DM recap | Response B+C sent to `senderPhone@s.whatsapp.net` for registered operators only |
| DM responses | Sent to `senderPhone@s.whatsapp.net` |
| Seen marking | `waClient.readMessages([key])` called before processing, with 1s delay |
| `status@broadcast` | Always ignored, never processed |

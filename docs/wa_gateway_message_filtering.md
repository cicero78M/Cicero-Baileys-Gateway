# WA Gateway Message Filtering Update

## Ringkasan

Modul complaint auto-handler di `src/service/waAutoComplaintService.js` sekarang menerapkan filter forward gateway yang lebih kontekstual. Tujuannya agar:

1. **Relay forward gateway yang valid tetap di-skip**.
2. **Komplain valid di private chat tetap diproses**, meskipun nomor pengirim ada di daftar `GATEWAY_WHATSAPP_ADMIN`.
3. **Pesan private non-komplain tetap diabaikan**.

## Aturan Filtering Baru

### 1) Deteksi relay gateway tidak lagi hanya berdasarkan sender

`isGatewayComplaintForward(...)` sekarang memakai kombinasi:

- kecocokan pengirim dengan daftar gateway (`GATEWAY_WHATSAPP_ADMIN` + `gatewayIds` runtime),
- pola header forward (`wagateway` / `wabot` di awal pesan),
- konteks chat (**group** vs **private**).

Pesan dianggap relay gateway jika salah satu kondisi berikut terpenuhi:

- Pengirim gateway **dan** konteks chat adalah group.
- Pesan diawali header `wagateway|wabot` **dan** (konteks group **atau** pengirim gateway).

### 2) Guard prioritas komplain lengkap

Di `shouldHandleComplaintMessage(...)`, pesan lebih dulu diparse dengan `parseComplaintMessage(text)`.

- Jika format komplain lengkap (`isComplaint === true` dan `reporter.nrp` terisi), pesan **diprioritaskan untuk diproses**.
- Pengecualian: jika tetap teridentifikasi sebagai relay gateway nyata oleh aturan di atas, maka pesan tetap di-skip.

### 3) Dampak perilaku

- **Private chat dari nomor gateway admin** dengan isi komplain valid tidak lagi salah-terblokir.
- **Group relay** yang berheader gateway tetap diblok untuk mencegah duplicate handling.
- **Private non-komplain** tidak diproses complaint flow.

## Catatan Operasional

- Jika menambahkan nomor relay baru, masukkan ke `GATEWAY_WHATSAPP_ADMIN` agar filter konsisten.
- Untuk payload relay antar gateway, pastikan header `wagateway`/`wabot` dipertahankan agar terdeteksi sebagai relay.

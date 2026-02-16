# Panduan Respon Komplain

> **Untuk Frontend Developers**: Jika Anda mengalami error 403 atau ingin mengintegrasikan endpoint komplain, lihat panduan lengkap di [frontend_complaint_api_guide.md](./frontend_complaint_api_guide.md) yang mencakup solusi troubleshooting, contoh implementasi, dan penjelasan detail tentang authentication.

Modul `respondComplaint` menyampaikan langkah tindak lanjut kepada pelapor saat laporan aktivitas media sosial belum tercatat. Ringkasan panduan yang dikirim ke pelapor menekankan pengecekan kembali likes Instagram dan komentar TikTok.

## Langkah verifikasi yang dikirim
- Pastikan aksi dilakukan dengan akun yang tercatat di Cicero.
- Lampirkan tautan konten beserta waktu pelaksanaan untuk pengecekan.
- Gunakan menu **Absensi Likes Instagram** atau **Absensi Komentar TikTok** di dashboard Cicero, pilih ulang satker dan periode, lalu tekan **Refresh** untuk memuat data terbaru.
- Jika data masih belum tercatat setelah sinkronisasi sekitar satu jam, kirim bukti tangkapan layar dan eskalasi ke operator piket.

Catatan: Narasi lama yang menyebut "Absensi Amplifikasi" sudah diganti agar selaras dengan terminologi likes/komentar di Instagram dan TikTok.


## Validasi akun minim aktivitas
- Service komplain sekarang memakai ambang metrik minimal **>=10** untuk menilai akun aktif valid pada Instagram/TikTok.
- Nilai `null`/`undefined`/`-`/angka `0-9` diperlakukan sebagai metrik rendah atau tidak tersedia.
- Untuk TikTok, field `likes` diproses konsisten: jika bernilai `-` atau tidak tersedia, akun tetap masuk evaluasi minim aktivitas.
- Saat akun terdeteksi minim aktivitas, respon komplain menyertakan panduan perbaikan profil dan perilaku akun agar validasi platform lebih stabil.

## Perilaku sesi setelah respon
- Setelah pesan komplain dibalas dan ringkasan admin dikirim, sesi menu *Client Request* ditutup otomatis.
- Penutupan sesi mencegah pengiriman ulang pesan menu utama seperti:
  ```
  ┏━━━ *MENU CLIENT CICERO* ━━━
  1️⃣ Manajemen Client & User
  2️⃣ Operasional Media Sosial
  3️⃣ Transfer & Laporan
  4️⃣ Administratif
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Ketik *angka* menu, atau *batal* untuk keluar.
  ```
- Admin dapat membuka kembali menu dengan perintah `clientrequest` bila diperlukan.

## API respon komplain
Endpoint komplain dipakai untuk menyusun pesan respon yang akan ditampilkan kembali di frontend sebelum dikirimkan melalui kanal lain.

**Endpoint**
- `POST /api/dashboard/komplain/insta`
- `POST /api/tiktok/komplain`

**Header**
- Untuk Instagram: gunakan token login dashboard (`POST /api/auth/dashboard-login`).
- Untuk TikTok: gunakan token login dashboard atau token client (`POST /api/auth/login`).
- Kirim token sebagai `Authorization: Bearer <token>` atau simpan pada cookie `token`.
- Jika memakai token client, akses hanya diizinkan untuk personel dengan `client_id` yang sama.

**Payload minimal**
```json
{
  "nrp": "75020201",
  "issue": "Sudah melaksanakan Instagram belum terdata.",
  "solution": "Mohon cek kembali data like di dashboard dan kirim bukti jika masih belum tercatat."
}
```

Field `issue`/`solution` boleh diganti dengan `kendala`, `solusi`, atau `tindak_lanjut`. Jika tidak diisi, sistem akan mencoba menyusun kendala dan solusi otomatis dengan logika yang sama seperti responder WhatsApp (memakai modul `complaintService`). Anda dapat mengirimkan `message`/`pesan` berisi format *Pesan Komplain* agar sistem mengekstrak daftar kendala dan menghasilkan solusi otomatis sesuai akun Instagram/TikTok pelapor. Respons API akan mengembalikan string pesan dengan format yang mengikuti `sendComplaintResponse` (sapaan, identitas pelapor, kendala, dan solusi), beserta data pelapor dan nomor WhatsApp dashboard user bila tersedia.

**Format payload**
```json
{
  "nrp": "75020201",
  "issue": "Sudah melaksanakan Instagram belum terdata.",
  "solution": "Mohon cek kembali data like di dashboard dan kirim bukti jika masih belum tercatat.",
  "message": "Pesan Komplain\\nNRP: 75020201\\nNama: Nama Pelapor\\nUsername IG: @username\\n\\nKendala\\n- Sudah melaksanakan Instagram belum terdata.",
  "instagram": "@username",
  "tiktok": "@username",
  "complaint": "Isi komplain mentah (opsional)."
}
```

Keterangan:
- `nrp` **wajib** diisi dengan NRP/NIP personel yang terdaftar.
- `issue`/`solution` **opsional**. Jika kosong, sistem akan menggunakan fallback berdasarkan platform dan status akun.
- `message`/`pesan`/`complaint`/`raw`/`text` **opsional** untuk menyuplai format *Pesan Komplain* agar parser mengekstrak `nrp`, `nama`, `polres`, `instagram`, `tiktok`, dan daftar kendala otomatis.
- `instagram`/`insta`/`username_ig`/`username_instagram` dan `tiktok`/`username_tiktok` **opsional** sebagai fallback bila handle tidak tercantum di pesan.

**Payload komplain otomatis**
```json
{
  "nrp": "75020201",
  "message": "Pesan Komplain\\nNRP: 75020201\\nNama: Nama Pelapor\\nUsername IG: @username\\n\\nKendala\\n- Sudah melaksanakan Instagram belum terdata."
}
```

## Status pengiriman WhatsApp
Ketika endpoint komplain dipanggil, sistem akan mencoba mengirimkan pesan yang sudah diformat ke dua target WhatsApp: nomor personel (`user.whatsapp`) dan (bila token dashboard digunakan) nomor dashboard user (`req.dashboardUser.whatsapp`). Status pengiriman selalu dikembalikan di response frontend agar UI dapat menampilkan hasil pengiriman per nomor.

Contoh ringkas objek `whatsappDelivery` pada response:
```json
{
  "whatsappDelivery": {
    "personnel": { "status": "sent", "target": "6281234567890@c.us" },
    "dashboardUser": { "status": "invalid", "reason": "invalid_number" }
  }
}
```

**Contoh response lengkap (ringkas)**
```json
{
  "success": true,
  "data": {
    "platform": "Instagram",
    "message": "Selamat pagi! Kami menindaklanjuti laporan yang Anda sampaikan.\\n\\n*Pelapor*: Nama Pelapor\\n\\n*NRP/NIP*: 75020201\\n\\n*Kendala*:\\n- Sudah melaksanakan Instagram belum terdata.\\n\\n*Solusi/Tindak Lanjut*:\\n1) Pastikan like dan komentar dilakukan menggunakan akun yang tercatat (Instagram: @username).\\n2) Pastikan sudah mengisi absensi likes Instagram di dashboard.",
    "issue": "Pesan Komplain\\nNRP/NIP: 75020201\\nNama: Nama Pelapor\\nInstagram: @username\\n\\nKendala\\n- Sudah melaksanakan Instagram belum terdata.",
    "solution": "1) Pastikan like dan komentar dilakukan menggunakan akun yang tercatat (Instagram: @username).\\n2) Pastikan sudah mengisi absensi likes Instagram di dashboard.",
    "channel": "whatsapp",
    "whatsappDelivery": {
      "personnel": { "status": "sent", "target": "6281234567890@c.us" },
      "dashboardUser": { "status": "sent", "target": "6289876543210@c.us" }
    },
    "reporter": {
      "nrp": "75020201",
      "name": "Nama Pelapor",
      "whatsapp": "6281234567890",
      "email": "pelapor@example.com"
    },
    "dashboard": { "whatsapp": "6289876543210" }
  }
}
```

Nilai status yang mungkin:
- `sent`: pesan berhasil dikirim.
- `failed`: pengiriman gagal (contoh: client WA belum siap atau error saat kirim).
- `invalid`: nomor WA tidak valid.
- `skipped`: nomor WA kosong/tidak tersedia.

## Matriks kondisi status akun → template respon final

Template final untuk issue absensi (`instagram_not_recorded`, `tiktok_not_recorded`) sekarang diprioritaskan di `buildComplaintSolutionsFromIssues` dengan evaluator gabungan `evaluateAbsenceTemplateType`.

| Kondisi gabungan `accountStatus` (Instagram + TikTok) | Template prioritas | Identifier fungsi |
| --- | --- | --- |
| Salah satu metrik publik kosong / `-` / `<10` pada akun yang terdaftar | **aktif namun minim aktivitas publik** | `buildLowActivityResponse()` |
| Seluruh metrik publik valid (`>=10`) sesuai ambang kebijakan untuk akun yang terdaftar | **aktif dan valid** | `buildActiveValidResponse()` |
| Kondisi lain (mis. data belum lengkap, error API, username mismatch) | fallback detail platform per issue | `buildInstagramIssueSolution()` / `buildTiktokIssueSolution()` |

Definisi metrik publik:
- Instagram: `posts`, `followers`, `following`
- TikTok: `posts`, `followers`, `following`, `likes`

Catatan implementasi:
- Template prioritas hanya berlaku untuk issue key absensi.
- Jika dalam satu komplain terdapat dua issue absensi sekaligus (Instagram+TikTok), template prioritas dikirim satu kali agar tidak duplikat.

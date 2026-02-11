# Keputusan Teknis: WA Minimal Scope (Complaint + Bulk Deletion)

## Status
Disetujui (baseline implementasi saat ini).

## Latar Belakang
Dokumen ini menetapkan **scope minimum** yang dipertahankan untuk kanal WhatsApp Gateway agar operasional lebih fokus, ringan, dan mudah diuji. Scope baru hanya mencakup:

1. Auto-handling komplain melalui `handleComplaintMessageIfApplicable`.
2. Deteksi forward WA Gateway melalui `isGatewayComplaintForward`.
3. Proses penghapusan data personel massal melalui `processBulkDeletionRequest`.

Ruang lingkup di luar tiga area tersebut dinyatakan **out of scope** untuk baseline ini.

---

## 1) Fitur yang Dipertahankan

### A. `handleComplaintMessageIfApplicable`
- Fungsi ini menjadi gerbang utama auto-routing pesan komplain ke alur `clientrequest` step `respondComplaint_message`.
- Kriteria utama agar pesan diproses sebagai komplain:
  - `allowUserMenu === false`.
  - Bukan sesi aktif `clientrequest`.
  - Bukan forward dari kanal gateway (`isGatewayComplaintForward === false`).
  - Mengandung header komplain + section kendala + NRP/NIP valid.
- Jika lolos validasi, sesi admin sebelumnya dibersihkan lalu sesi chat dipindahkan ke alur respons komplain.

### B. `isGatewayComplaintForward`
- Fungsi untuk mendeteksi apakah pesan dianggap forward dari WA Gateway.
- Sumber deteksi:
  - `senderId` termasuk daftar admin gateway (`GATEWAY_WHATSAPP_ADMIN` atau daftar tambahan).
  - Prefix teks `wagateway`/`wabot`.
  - Mode implicit pada alur gateway (non-group) bila `allowImplicitGatewayForward = true`.
- Tujuan: mencegah pesan forward gateway diproses ganda sebagai komplain normal.

### C. Flow `processBulkDeletionRequest`
- Flow ini menerima template “Permohonan Penghapusan Data Personil” dari chat.
- Mekanisme utama:
  1. Validasi header template.
  2. Parsing daftar entri personel (`nama - user_id - alasan`) termasuk fallback naratif.
  3. Lookup user dan resolusi role aktif.
  4. Eksekusi nonaktif role/user + pengosongan WA jika status user menjadi nonaktif.
  5. Jika user memiliki >1 role aktif, bot meminta pilihan role terlebih dahulu.
  6. Bot mengirim ringkasan sukses/gagal dalam satu summary message.

---

## 2) Fitur yang Dihapus (Out of Scope)

Berikut fitur yang **tidak dipertahankan** pada minimal scope ini:

### A. Semua menu interaktif non-minimal
- `oprrequest`
- `userrequest`
- `dirrequest`
- `dashrequest`
- `clientrequest` **selain** kebutuhan complaint response dan bulk deletion.

### B. Command admin operasional lama
- Perintah berbasis prefiks admin seperti `addnewclient#`, `fetchinsta#`, dan command sejenis yang tidak terkait complaint/bulk.

### C. Integrasi non-complaint/non-bulk
- Integrasi rekap, notifikasi, atau orkestrasi menu lain yang tidak mendukung langsung dua use case inti:
  - complaint handling
  - bulk deletion personel

---

## 3) Endpoint / Command Input yang Masih Valid

> Catatan: pada scope minimum ini, antarmuka utama adalah **input chat WA** (bukan menu interaktif penuh).

### A. Input komplain (chat bebas dengan format komplain)
Pesan valid minimal berisi:
- Header bertema komplain (contoh: `Pesan Komplain`)
- Identitas NRP/NIP
- Section `Kendala`

Contoh payload/chat:

```text
Pesan Komplain
NRP: 88123456
Nama: Budi Santoso
Polres: Polres Contoh
Instagram: @budi_inst
TikTok: @buditok
Kendala:
- Likes Instagram tidak tercatat di dashboard.
```

Ekspektasi:
- Pesan ditangkap `handleComplaintMessageIfApplicable`.
- Session diarahkan ke `clientrequest/respondComplaint_message`.

### B. Input bulk deletion (template penghapusan personel)
Header wajib dikenali regex:
- `Permohonan Penghapusan Data Personil`

Contoh payload/chat:

```text
Permohonan Penghapusan Data Personil
1. Budi Santoso - 88123456 - mutasi keluar
2. Siti Aisyah - 77001234 - pensiun
```

Ekspektasi:
- Template diproses `processBulkDeletionRequest`.
- Bot mengirim summary sukses/gagal.
- Jika ada multi-role, bot meminta pilihan role dulu, lalu lanjut summary.

### C. Input kontrol yang tetap berlaku untuk flow bulk
- `batal` → membatalkan proses bulk jika sedang di flow terkait.
- Balasan angka / kode role pada tahap pemilihan role multi-role user.

### D. Input yang dianggap tidak valid dalam minimal scope
- Command menu interaktif umum (`oprrequest`, `userrequest`, `dirrequest`, `dashrequest`, `clientrequest` non-bulk/non-complaint).
- Command admin operasional prefiks lama (`addnewclient#...`, `fetchinsta#...`, dll).

---

## 4) Kriteria Sukses UAT

## A. UAT Complaint
Skenario lulus bila semua poin berikut terpenuhi:

1. **Deteksi format komplain**
   - Pesan dengan format komplain valid diproses otomatis (tanpa perlu masuk menu lain).
2. **Anti-duplikasi gateway forward**
   - Pesan forward gateway tidak diproses ulang sebagai komplain normal.
3. **Routing sesi benar**
   - Session berpindah ke alur `respondComplaint_message`.
4. **Respons operasional terkirim**
   - Bot mengirim respons hasil penanganan komplain sesuai alur existing.
5. **Stabil pada input tidak lengkap**
   - Pesan tanpa NRP/kendala tidak memicu proses komplain otomatis.

## B. UAT Bulk Deletion
Skenario lulus bila semua poin berikut terpenuhi:

1. **Template valid terdeteksi**
   - Header + list personel valid diparsing dan diproses.
2. **Aksi nonaktif berhasil**
   - Untuk entri valid, role/user dinonaktifkan sesuai aturan existing.
3. **Kasus multi-role tertangani**
   - Bot meminta pilihan role saat diperlukan dan melanjutkan proses setelah input pilihan.
4. **Summary terstruktur**
   - Bot mengirim ringkasan berisi daftar sukses dan gagal (termasuk alasan gagal).
5. **Cancel flow aman**
   - Input `batal` menghentikan flow dan membersihkan sesi.
6. **No false positive**
   - Pesan non-template tidak men-trigger bulk deletion.

---

## Dampak Teknis
- Scope operasional WA menjadi lebih sempit, sehingga risiko regresi menu lain berkurang.
- Beban maintenance fokus pada complaint parser/routing dan bulk deletion parser/eksekusi.
- Dokumentasi ini menjadi referensi utama untuk evaluasi perubahan berikutnya pada modul WA.

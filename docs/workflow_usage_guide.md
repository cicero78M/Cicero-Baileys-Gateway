# Panduan Workflow Penggunaan Cicero_V2 (Scope Complaint + Bulk)
*Last updated: 2026-02-11*

Dokumen ini menggantikan panduan menu WhatsApp lama dan memfokuskan alur operasional ke dua proses inti:

1. **Complaint handling** (format keluhan resmi),
2. **Bulk request personel** (format resmi permohonan penghapusan/nonaktif).

## 1. Ruang Lingkup Operasional

Workflow aktif yang didukung tim operator:
- Validasi dan pemrosesan pesan complaint sesuai format resmi.
- Pemrosesan pesan bulk sesuai template resmi.
- Pengiriman ringkasan hasil proses (sukses/gagal/invalid format) via WhatsApp.

Workflow di luar dua area di atas (menu interaktif lama seperti `oprrequest`, `userrequest`, `dirrequest`) sudah dipindahkan ke status **deprecated** dan tidak menjadi jalur operasional default.

## 2. Alur Complaint (Format Resmi)

### 2.1 Tujuan
Menjamin semua keluhan masuk dalam struktur yang bisa diproses otomatis dan ditindaklanjuti konsisten.

### 2.2 Format Minimal yang Diterima
Gunakan format yang merujuk ke dokumen resmi:
- [docs/complaint_formats.md](docs/complaint_formats.md)

Contoh struktur umum:
- Header/identitas pengirim
- `Kendala:`
- `Rincian Kendala:`

### 2.3 Alur Proses
1. Pesan diterima gateway WhatsApp.
2. Sistem memvalidasi keberadaan field wajib complaint.
3. Jika valid, complaint diproses dan diteruskan ke alur respons dashboard/WA.
4. Jika tidak valid, sistem membalas instruksi perbaikan format.

### 2.4 Output ke Operator
- Status complaint diterima/ditolak format.
- Ringkasan alasan invalid jika field wajib tidak lengkap.
- Respons tetap konsisten dengan standar endpoint complaint dashboard.

## 3. Alur Bulk Request (Format Resmi)

### 3.1 Tujuan
Memproses permohonan penghapusan/nonaktif data personel secara massal dengan format standar agar aman diaudit.

### 3.2 Format Resmi
Template yang harus digunakan:

`Permohonan Penghapusan Data Personil – <SATKER>`

Diikuti daftar bernomor dengan pola:

`Nama – NRP/NIP – Alasan`

### 3.3 Aturan Validasi
- Header wajib sesuai template resmi.
- Daftar personel wajib bernomor dan berisi identitas + alasan.
- Jika format kosong/tidak cocok, sistem mengirim pesan penjelasan dan menutup sesi proses.

### 3.4 Output ke Operator
- Ringkasan jumlah data berhasil diproses.
- Daftar data gagal beserta penyebab.
- Konfirmasi akhir proses bulk.

## 4. Referensi Dokumentasi

- Format complaint: [docs/complaint_formats.md](docs/complaint_formats.md)
- Changelog deprecation fitur WA: [docs/wa_feature_deprecation.md](docs/wa_feature_deprecation.md)
- Siklus hidup WA client: [docs/whatsapp_client_lifecycle.md](docs/whatsapp_client_lifecycle.md)

## 5. Daftar File Terdampak Pembaruan Dokumentasi

- `README.md`
- `docs/workflow_usage_guide.md`
- `docs/wa_operator_request.md`
- `docs/wa_user_registration.md`
- `docs/wa_dirrequest.md`
- `docs/wa_feature_deprecation.md`

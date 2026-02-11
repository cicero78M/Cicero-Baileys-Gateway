# Changelog Migrasi Fitur WhatsApp: Deprecation ke Scope Complaint + Bulk
*Last updated: 2026-02-11*

Dokumen ini mencatat perubahan scope dokumentasi dan operasional WhatsApp dari model menu-command lama ke fokus proses complaint dan bulk request.

## 1. Fitur yang Dihapus dari Scope Aktif

Berikut fitur yang **tidak lagi menjadi referensi aktif** pada dokumentasi utama:

- Alur menu command operator berbasis `oprrequest`.
- Alur registrasi/pembaruan user berbasis `userrequest` sebagai fokus panduan utama.
- Alur menu direktorat berbasis `dirrequest` sebagai fokus panduan utama.

> Catatan: Dokumen lama masih disimpan sebagai arsip, tetapi ditandai deprecated.

## 2. Dampak ke Operator

- Operator wajib menggunakan format complaint resmi untuk proses keluhan.
- Operator wajib menggunakan format bulk resmi untuk permohonan nonaktif/penghapusan data personel.
- SOP internal yang sebelumnya merujuk menu command lama harus diperbarui ke workflow baru.
- Materi onboarding operator perlu menekankan validasi format pesan, bukan navigasi menu legacy.

## 3. Contoh Pesan yang Masih Didukung

### 3.1 Complaint (contoh struktur)

```
Kendala: Data posting belum masuk
Rincian Kendala: Konten Instagram tanggal 10-02-2026 belum terbaca di dashboard.
```

### 3.2 Bulk Request (format resmi)

```
Permohonan Penghapusan Data Personil – SATKER CONTOH
1. Nama Personel A – 12345678 – Mutasi
2. Nama Personel B – 19876543 – Pensiun
```

## 4. Tanggal Update

- Tanggal migrasi dokumentasi: **2026-02-11**.

## 5. Daftar File Terdampak

- `README.md`
- `docs/workflow_usage_guide.md`
- `docs/wa_operator_request.md`
- `docs/wa_user_registration.md`
- `docs/wa_dirrequest.md`
- `docs/wa_feature_deprecation.md`

# CICERO_V2
*Last updated: 2026-02-11*

## Important: WhatsApp Client Migration

**The system has been migrated from WhatsApp Web.js to Baileys** (February 2026). This brings significant improvements:
- 🚀 60% reduction in memory usage (no browser dependency)
- ⚡ 80% faster startup times
- 🔒 More stable connections with multi-device API
- 📦 Smaller deployment size (~500MB less per client)

**Action Required**: Existing WhatsApp sessions are incompatible. After deployment, users must re-scan QR codes. See [docs/baileys_migration_guide.md](docs/baileys_migration_guide.md) for complete migration details.

## Description

**Cicero_V2** adalah backend automasi untuk monitoring media sosial, workflow editorial, dan orkestrasi messaging WhatsApp berbasis gateway tunggal.

Mulai pembaruan dokumentasi ini, **scope operasional WhatsApp difokuskan ke**:
1. **Complaint handling** (format keluhan resmi + respons dashboard/WA), dan
2. **Bulk request** (format resmi permohonan penghapusan/nonaktif data personel).

Seluruh dokumentasi yang mengandalkan menu/perintah WhatsApp lama (seperti alur interaktif `oprrequest`, `userrequest`, `dirrequest`) tidak lagi menjadi referensi utama operasional harian.

## Dokumentasi Utama (Scope Aktif)

- Arsitektur sistem: [docs/enterprise_architecture.md](docs/enterprise_architecture.md)
- Alur penggunaan terbaru (complaint + bulk): [docs/workflow_usage_guide.md](docs/workflow_usage_guide.md)
- Format complaint resmi: [docs/complaint_formats.md](docs/complaint_formats.md)
- Changelog deprecation fitur WA lama: [docs/wa_feature_deprecation.md](docs/wa_feature_deprecation.md)
- Siklus hidup client WhatsApp: [docs/whatsapp_client_lifecycle.md](docs/whatsapp_client_lifecycle.md)

Dokumentasi legacy yang sudah deprecated tetap disimpan untuk referensi historis dan tidak lagi diposisikan sebagai panduan operasi aktif.

## Key Capabilities (Current Focus)

- Multi-tenant ingestion Instagram/TikTok dengan deduplication dan fallback source.
- Complaint pipeline end-to-end (format validasi, parsing, respons dashboard, dan pengiriman WhatsApp).
- Bulk nonaktif/penghapusan data personel menggunakan template resmi dengan ringkasan sukses/gagal.
- Analytics API teragregasi untuk kebutuhan dashboard operator dan monitoring complaint.

## Requirements
- Node.js 20 atau lebih baru
- PostgreSQL dan Redis (sesuaikan `.env`)
- Jalankan `npm install` sebelum start

## Database Setup

Untuk inisialisasi dan migrasi database:
- Lihat [docs/running_migrations.md](docs/running_migrations.md)
- Gunakan `node scripts/run_migration.js <migration-file>` untuk menjalankan migrasi dengan aman
- Skema utama ada di `sql/schema.sql`
- File migrasi ada di `sql/migrations/`

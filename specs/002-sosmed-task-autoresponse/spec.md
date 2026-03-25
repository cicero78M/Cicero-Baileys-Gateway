# Feature Specification: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Feature Branch**: `002-sosmed-task-autoresponse`  
**Created**: 2026-03-25  
**Status**: Clarified — Ready for Planning  
**Input**: Dipecah dari `001-wa-complaint-task-autoresponse` (Fitur B saja)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Bot Merespons Broadcast Tugas Sosmed (Priority: P1)

Seorang operator atau admin mengirimkan broadcast perintah tugas media sosial ke grup WhatsApp klien (misalnya: "Selamat pagi, mohon izin dibantu untuk like dan comment postingan berikut: [link Instagram/TikTok]"). Gateway mendeteksi pola pesan broadcast tugas, memicu live fetch data engagement terbaru dari API Instagram/TikTok, lalu membalas di grup dengan rekapitulasi partisipasi (jumlah like/komentar dan daftar username yang sudah berpartisipasi).

**Why this priority**: Fitur ini memungkinkan monitoring tugas sosmed secara real-time tanpa operator harus membuka dashboard — meningkatkan efisiensi pemantauan harian secara signifikan.

**Independent Test**: Kirim pesan broadcast berisi kata kunci tugas sosmed (salam waktu, mohon izin dibantu, aksi like/comment, URL IG/TikTok) ke grup klien terdaftar. Verifikasi bot membalas dengan data engagement terbaru dalam ≤ 15 detik.

**Acceptance Scenarios**:

1. **Given** grup WA terdaftar sebagai grup klien aktif, **When** pesan broadcast tugas diterima dengan URL Instagram, **Then** bot melakukan live fetch engagement IG dan membalas dengan jumlah like serta daftar username yang sudah like.
2. **Given** grup WA terdaftar sebagai grup klien aktif, **When** pesan broadcast tugas diterima dengan URL TikTok, **Then** bot melakukan live fetch engagement TikTok dan membalas dengan jumlah komentar serta daftar username yang sudah komentar.
3. **Given** pesan broadcast berisi campuran URL Instagram dan TikTok, **When** diterima oleh bot, **Then** bot membalas dengan rekapitulasi engagement untuk masing-masing platform, mencakup ack awal, ringkasan status, dan recap tugas.
4. **Given** URL dalam pesan broadcast belum memiliki data di API saat live fetch, **When** bot memproses, **Then** bot tetap membalas dengan notifikasi bahwa data belum tersedia dan menyebutkan konten yang dimaksud.
5. **Given** pesan masuk berisi URL media sosial **tanpa** kata kunci broadcast tugas (salam waktu, mohon izin dibantu), **When** bot memeriksa, **Then** bot tidak membalas sebagai broadcast tugas.
6. **Given** pesan broadcast tugas dikirim sebagai DM langsung ke gateway, **When** bot memeriksa, **Then** bot tidak membalas (hanya grup klien aktif yang dilayani).
7. **Given** pesan broadcast diterima dari grup yang tidak terdaftar di CICERO, **When** bot memeriksa, **Then** bot tidak membalas.

---

### Edge Cases

- Apa yang terjadi jika URL dalam broadcast tugas tidak dikenali sebagai IG atau TikTok? → URL tersebut diabaikan; hanya URL platform yang dikenali yang diproses.
- Apa yang terjadi jika live fetch API IG/TikTok gagal/timeout? → Bot membalas dengan notifikasi data tidak tersedia; tidak ada respons silent.
- Apa yang terjadi jika koneksi WhatsApp terputus saat memproses pesan? → Pesan ditunda di antrian dan diproses ulang saat koneksi pulih.
- Apa yang terjadi jika pesan broadcast diterima dari DM? → Jika pengirim adalah operator terdaftar: diproses sebagai input tugas, ack dikirim via DM (tanpa recap engagement ke grup). Jika pengirim belum terdaftar: alur registrasi dimulai. Pesan broadcast dari DM tidak memicu recap engagement ke grup.
- Apa yang terjadi jika grup tidak terdaftar di CICERO? → Diabaikan, tidak ada respons.

---

### User Story 2 — Self-Registrasi Operator via Broadcast Tugas (Priority: P1)

Seorang pegawai yang baru ditunjuk sebagai operator mengirimkan pesan broadcast tugas ke bot WhatsApp gateway (format standar: salam waktu + "mohon izin dibantu" + kata aksi + URL). Karena nomor WhatsApp-nya belum terdaftar, sistem mengenali bahwa pesan ini berasal dari pengirim yang belum dikenal dan memulai alur registrasi secara otomatis — tanpa memerlukan perintah registrasi terpisah. Bot menjawab dengan pertanyaan konfirmasi apakah operator ingin mendaftarkan nomornya. Jika operator menjawab setuju, bot mengirimkan daftar bernomor seluruh Satker/Polres aktif (dari registri client aktif) untuk dipilih. Operator memilih nomor yang sesuai dengan satuannya, lalu sistem menyimpan nomor WhatsApp operator dikaitkan dengan `client_id` satker yang dipilih. Pesan broadcast tugas asli kemudian diproses ulang secara otomatis setelah registrasi selesai.

**Why this priority**: Ini adalah titik masuk satu-satunya agar nomor operator baru dapat diregistrasi tanpa ada langkah manual dari admin. Tanpa alur ini, setiap pesan broadcast dari nomor baru diabaikan diam-diam dan tidak ada tugas yang terekam.

**Independent Test**: Kirim pesan dalam format broadcast tugas dari nomor yang belum terdaftar ke bot via DM. Verifikasi: (1) bot merespons dengan pertanyaan konfirmasi pendaftaran; (2) setelah operator balas "ya", bot mengirim daftar bernomor satker aktif; (3) setelah operator memilih nomor satker, bot menyimpan operator dan membalas dengan ack keberhasilan; (4) broadcast tugas asli diproses dan tugas berhasil direkam untuk `client_id` satker yang dipilih.

**Acceptance Scenarios**:

1. **Given** nomor WA belum terdaftar sebagai operator, **When** nomor tersebut mengirim pesan dalam format broadcast tugas ke bot, **Then** bot membalas dengan pesan: *"Anda mengirim pesan tugas untuk dieksekusi, tapi database kami belum membaca Satker Asal anda. Apakah anda ingin mendaftarkan nomor anda sebagai operator tugas? (ya/tidak)"* — tanpa memproses tugas.
2. **Given** bot telah mengirim konfirmasi pendaftaran, **When** operator membalas dengan "ya" (atau konfirmasi setara), **Then** bot mengirimkan daftar bernomor seluruh Satker/Polres aktif yang tersedia dari registri klien, misalnya: *"Pilih Satker Anda:\n1. Polres A\n2. Polres B\n3. Dit. Intelkam\n..."*.
3. **Given** bot telah mengirim daftar satker, **When** operator membalas dengan nomor urut satker yang valid, **Then** sistem menyimpan nomor WA operator sebagai operator aktif untuk `client_id` satker yang dipilih, membalas dengan konfirmasi *"Nomor Anda berhasil terdaftar sebagai operator untuk [nama satker]. Anda dapat mengirim pesan tugas kembali."*, dan memproses kembali pesan broadcast tugas asli.
4. **Given** bot telah mengirim konfirmasi pendaftaran, **When** operator membalas dengan "tidak" (atau penolakan setara), **Then** bot merespons dengan pesan penutup sopan dan mengakhiri sesi registrasi — broadcast tugas asli tidak diproses.
5. **Given** nomor WA sudah terdaftar sebagai operator, **When** operator mengirim pesan dalam format broadcast tugas, **Then** sistem memproses pesan tersebut langsung sebagai input tugas untuk `client_id` operator tanpa melalui alur registrasi.
6. **Given** bot telah mengirim daftar satker, **When** operator membalas dengan nomor urut yang tidak ada dalam daftar atau dengan teks tidak valid, **Then** bot membalas dengan pesan bahwa pilihan tidak valid dan menampilkan ulang daftar satker.
7. **Given** beberapa operator dari satker yang sama terdaftar, **When** masing-masing mengirim broadcast tugas, **Then** semua tugas direkam di bawah `client_id` yang sama tanpa konflik.

---

### Edge Cases Tambahan (Registrasi Operator)

- Apa yang terjadi jika dua operator mendaftarkan diri untuk `client_id` yang sama? → Keduanya disimpan sebagai operator aktif untuk `client_id` tersebut; sistem mendukung banyak operator per klien.
- Apa yang terjadi jika operator mengirim pesan broadcast kedua saat sesi registrasi sedang berlangsung (belum selesai)? → Sistem mengabaikan pesan baru dan melanjutkan sesi registrasi yang sedang aktif; tidak membuka sesi registrasi duplikat.
- Apa yang terjadi jika operator mencoba memulai sesi registrasi berulang kali melampaui batas? → Jika `attempt_count` melampaui `operator_registration_max_attempts` dalam window `operator_registration_cooldown_minutes`, bot tidak merespons dan mencatat warning di log — tanpa mengirim pesan balik; sesi tidak dibuat baru sampai cooldown habis.
- Apa yang terjadi jika tidak ada satker/klien aktif di registri saat bot hendak mengirim daftar pilihan? → Bot merespons dengan pesan bahwa tidak ada satker aktif yang tersedia dan menginformasikan operator untuk menghubungi administrator.
- Apa yang terjadi jika operator yang sudah terdaftar dihapus dari sistem lalu mengirim broadcast tugas? → Nomor dianggap belum terdaftar; alur registrasi ulang dimulai dari awal.

---

## Requirements *(mandatory)*

### Out-of-Scope (Explicit)

- **Deaktivasi operator**: Mengubah status `is_active = FALSE` pada entri tabel `operators` di luar scope feature ini; admin melakukan deaktivasi langsung via query DB. Feature manajemen operator (aktif/nonaktif via antarmuka) dapat menjadi feature terpisah di masa mendatang.
- **Manajemen konfigurasi via UI**: Perubahan nilai `client_config` dilakukan langsung via DB; tidak ada endpoint atau antarmuka admin untuk mengelola konfigurasi dalam feature ini.
- **Audit log terpusat**: Pencatatan historis semua tindakan operator atau admin bukan bagian dari feature ini.

### Functional Requirements

- **FR-001**: Sistem HARUS mendeteksi pesan broadcast tugas sosmed berdasarkan kombinasi kata kunci: salam waktu (pagi/siang/sore/malam), frasa "mohon izin dibantu", dan setidaknya satu kata aksi (like, comment, share, follow, subscribe, repost).
- **FR-002**: Sistem HARUS memproses alur **live fetch dan recap engagement** (balasan data partisipasi ke grup) **hanya** dari grup WhatsApp yang terdaftar sebagai grup klien aktif di CICERO. FR-002 tidak berlaku untuk alur input tugas dari operator terdaftar maupun alur registrasi — keduanya ditangani via DM.
- **FR-003**: Sistem HARUS mengekstrak semua URL Instagram dan TikTok dari pesan broadcast.
- **FR-004**: Sistem HARUS membedakan URL Instagram (mengandung `instagram.com` atau shortcode `ig.me`) dari URL TikTok (mengandung `tiktok.com` atau `vm.tiktok.com`).
- **FR-005**: Sistem HARUS melakukan **live fetch ke API Instagram/TikTok** pada saat broadcast diterima untuk setiap URL yang teridentifikasi, sehingga rekapitulasi mencerminkan data paling mutakhir.
- **FR-006**: Sistem HARUS membalas dengan pesan yang mencantumkan: ack deteksi broadcast, nama hari/tanggal saat ini, jumlah engagement per konten, dan daftar username yang sudah berpartisipasi.
- **FR-007**: Sistem HARUS mengabaikan URL yang bukan dari platform Instagram atau TikTok.
- **FR-008**: Semua respons keluar HARUS diantrekan melalui sistem antrian pesan (BullMQ outbox) untuk mencegah pelanggaran batas pengiriman WhatsApp.
- **FR-009**: Sistem HARUS menandai pesan masuk sebagai "sudah dibaca" (seen) sebelum mulai memproses, dengan jeda 1 detik.
- **FR-010**: Pesan STATUS WhatsApp (`status@broadcast`) HARUS selalu diabaikan dan tidak diproses.
- **FR-011**: Ketika sistem mendeteksi pesan dalam format broadcast tugas dari nomor yang **belum terdaftar** sebagai operator, sistem HARUS menghentikan pemrosesan tugas dan membalas dengan pesan konfirmasi pendaftaran — bukan mengabaikan pesan secara diam-diam.
- **FR-012**: Jika operator mengkonfirmasi ingin mendaftar, sistem HARUS mengambil daftar seluruh klien/satker aktif dari registri dan mengirimkannya sebagai pesan bernomor urut untuk dipilih operator; daftar ini selalu diambil secara dinamis dari database, bukan hardcoded.
- **FR-013**: Setelah operator memilih nomor satker yang valid dari daftar, sistem HARUS menyimpan asosiasi nomor WA operator → `client_id` satker yang dipilih sebagai operator aktif; jika nomor yang sama sudah terdaftar sebelumnya, data diperbarui (upsert) tanpa membuat entri duplikat.
- **FR-017**: Sistem HARUS menjaga status sesi registrasi per nomor WA dengan menyimpan state ke tabel `operator_registration_sessions` di PostgreSQL (kolom: `phone_number`, `stage`, `original_message`, `expires_at`); setiap balasan dari nomor tersebut dalam periode sesi aktif diinterpretasikan sebagai bagian dari alur registrasi, bukan sebagai broadcast tugas baru.
- **FR-018**: Setelah registrasi berhasil diselesaikan, sistem HARUS memproses kembali pesan broadcast tugas asli yang memicu alur registrasi sehingga operator tidak perlu mengirim ulang pesan yang sama.
- **FR-014**: Sistem HARUS memproses pesan dalam format broadcast tugas yang berasal dari nomor operator terdaftar — **baik dari grup klien maupun dari DM langsung ke gateway** — dan merekam setiap konten URL yang teridentifikasi ke tabel `insta_post` (untuk URL Instagram) atau `tiktok_post` (untuk URL TikTok) yang sudah ada, dengan mengisi kolom `task_source = 'broadcast_wa'` dan `client_id` sesuai operator. Untuk pesan dari DM, sistem hanya merekam tugas dan mengirim ack; tidak ada recap engagement ke grup.
- **FR-019**: Sistem HARUS melacak jumlah percobaan sesi registrasi per nomor WA menggunakan kolom `attempt_count` di tabel `operator_registration_sessions`; jika `attempt_count` melampaui nilai `operator_registration_max_attempts` dalam periode `operator_registration_cooldown_minutes` yang dikonfigurasi di `client_config`, sistem HARUS berhenti merespons nomor tersebut dan mencatat warning ke logger (pino) — tanpa mengirim pesan balik ke pengirim.
- **FR-020**: Sistem HARUS mencatat log menggunakan pino logger untuk setiap pesan masuk yang melewati handler sosmed task (level `info`: nomor pengirim, tipe chat, platform URL terdeteksi), serta mencatat level `warn` atau `error` untuk semua kondisi gagal (API fetch timeout, `client_id` tidak valid, `attempt_count` melebihi batas, insert/upsert DB gagal). Tidak ada `console.log` di jalur produksi.
- **FR-015**: Semua referensi `client_id` dalam subsistem registrasi operator dan perutean tugas HARUS di-resolve secara dinamis dari registri klien aktif; tidak ada nilai `client_id` yang boleh di-hardcode dalam source code maupun file konfigurasi statis.
- **FR-016**: Sistem HARUS membaca semua konfigurasi perilaku (keyword trigger, teks respons, konfigurasi grup klien, dan parameter operasional lainnya) dari tabel konfigurasi PostgreSQL yang diorganisasi per `client_id`, sehingga setiap satker dapat memiliki konfigurasi berbeda dan perubahan tidak memerlukan perubahan kode maupun restart layanan.

### Key Entities

- **Broadcast Tugas Sosmed**: Pesan operator ke group WA atau via DM berisi instruksi aksi sosmed (like, comment, share) pada konten tertentu, disertai URL konten.
- **Data Engagement**: Hasil live fetch dari API IG/TikTok — jumlah like/komentar dan daftar username partisipan per konten.
- **Grup Klien**: Grup WhatsApp yang terdaftar sebagai `client_group` pada data klien aktif di CICERO; hanya grup ini yang dilayani untuk alur respons grup.
- **Operator**: Nomor WhatsApp yang telah menyelesaikan alur registrasi dan dikonfirmasi sebagai operator aktif untuk sebuah `client_id`; data disimpan di tabel `operators` (kolom: `phone_number` PK, `client_id` FK→`clients.client_id`, `satker_name` VARCHAR denormalized, `registered_at` TIMESTAMPTZ, `is_active` BOOLEAN DEFAULT TRUE); nomor ini dapat mengirim broadcast tugas yang diproses dan direkam sebagai tugas klien.
- **Registrasi Operator**: Alur interaktif yang dipicu secara otomatis ketika nomor WA yang belum terdaftar mengirim pesan berformat broadcast tugas; terdiri dari langkah konfirmasi → pemilihan satker dari daftar → penyimpanan asosiasi nomor ↔ `client_id`.
- **Konfigurasi Klien**: Pasangan key-value yang tersimpan di tabel `client_config` PostgreSQL dan dikaitkan dengan `client_id` tertentu; mencakup keyword trigger, teks respons, konfigurasi grup, dan parameter operasional; dapat berbeda antar satker dan dapat diubah runtime tanpa restart layanan.
- **Sesi Registrasi**: Baris sementara di tabel `operator_registration_sessions` yang menyimpan progres dialog registrasi (`stage`: `awaiting_confirmation` | `awaiting_satker_choice`), pesan broadcast asli, dan timestamp kedaluwarsa (`expires_at`); dibuat saat bot mengirim pertanyaan konfirmasi dan dihapus setelah selesai atau kedaluwarsa.
- **Daftar Tugas Klien**: Entri tugas yang tersimpan di tabel `insta_post` atau `tiktok_post` (sesuai platform URL) dengan kolom `task_source = 'broadcast_wa'` dan `client_id` operator; kolom `task_source` ditambahkan sebagai migration ke tabel-tabel tersebut sebagai bagian dari feature ini.

---

## Success Criteria *(mandatory)*

- **SC-001**: Bot merespons broadcast tugas sosmed dalam ≤ 15 detik setelah pesan diterima, mencakup data engagement terbaru hasil live fetch.
- **SC-002**: 0% pesan non-broadcast direspons secara keliru dari jalur sosmed task handler (false positive khusus fitur ini).
- **SC-003**: Bot tetap beroperasi penuh dan memproses semua pesan broadcast bahkan setelah WhatsApp client reconnect — tidak ada pesan terdrop.
- **SC-004**: Operator baru dapat menyelesaikan alur registrasi dalam tepat 3 pesan bolak-balik dengan bot (broadcast tugas → konfirmasi ya → pilih nomor satker); 100% alur registrasi valid menghasilkan entri operator tersimpan dan tugas asli terproses otomatis.
- **SC-005**: 0% entri tugas tercatat dari operator yang tidak terdaftar atau `client_id` yang tidak valid — tidak ada data tugas yang terkontaminasi oleh pengirim tidak sah.

---

## Assumptions

- Grup klien aktif sudah terdaftar di kolom `client_group` tabel `clients` sebelum broadcast tugas mulai dikirim ke grup tersebut; namun nilai `client_group_jid` di `client_config` adalah sumber utama untuk pencocokan JID grup — sistem membaca `client_config` dahulu dan hanya fallback ke `clients.client_group` jika `client_group_jid` tidak ditemukan di konfigurasi klien tersebut.
- Live fetch ke API IG/TikTok dilakukan via layanan yang sudah ada; jika fetch gagal, bot membalas dengan notifikasi data tidak tersedia.
- Resolusi klien target dari group JID dilakukan secara dinamis — tidak ada `client_id` yang di-hardcode.
- Satu WhatsApp client (gateway) menangani seluruh grup terdaftar dan semua DM registrasi operator.
- BullMQ outbox worker sudah terhubung saat gateway startup (prasyarat dari feature 001 atau diselesaikan dalam feature ini sebagai foundational task).
- Tabel `insta_post` dan `tiktok_post` sudah ada dan digunakan untuk engagement data; feature ini menambahkan kolom `task_source VARCHAR(30)` (nullable, default NULL) dan `operator_phone VARCHAR(30)` (nullable) ke kedua tabel via migration SQL — entri lama tidak terpengaruh.
- Tabel `operator_registration_sessions` (PostgreSQL) menyimpan status sesi registrasi aktif per nomor WA; baris dibuang setelah sesi selesai atau kedaluwarsa.
- Tabel `operators` (kolom: `phone_number` PK, `client_id` FK→`clients.client_id`, `satker_name` VARCHAR, `registered_at` TIMESTAMPTZ, `is_active` BOOLEAN DEFAULT TRUE) dibuat sebagai bagian dari feature ini via migration SQL; upsert digunakan untuk menghindari duplikasi saat operator yang sama mendaftar ulang.
- Migration SQL untuk `client_config` HARUS menyertakan INSERT sentinel row `clients(client_id = 'DEFAULT')` terlebih dahulu (dengan kolom wajib diisi nilai placeholder) sebelum membuat tabel `client_config`, agar FK constraint dapat dipenuhi saat baris DEFAULT di-seed.
- `client_id` yang valid adalah `client_id` yang ada dan aktif dalam tabel `clients`; tidak ada daftar allowlist terpisah di luar tabel ini.

## Configuration Mechanism

### Prinsip

Semua konfigurasi perilaku sistem — keyword trigger, teks respons, konfigurasi grup klien, parameter sesi registrasi — disimpan di tabel PostgreSQL `client_config` dan diorganisasi per `client_id`. Ini memungkinkan setiap satker memiliki konfigurasi berbeda dan memungkinkan perubahan operasional tanpa deployment ulang ataupun restart layanan.

### Skema Tabel `client_config`

```sql
CREATE TABLE client_config (
  id           SERIAL PRIMARY KEY,
  client_id    VARCHAR(100) NOT NULL REFERENCES clients(client_id),
  config_key   VARCHAR(100) NOT NULL,
  config_value TEXT         NOT NULL,
  description  TEXT,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, config_key)
);
```

### Config Keys Standar per `client_id`

| `config_key` | Deskripsi | Contoh `config_value` |
|---|---|---|
| `broadcast_trigger_keywords` | Kata salam waktu pemicu deteksi broadcast | `pagi,siang,sore,malam` |
| `broadcast_action_keywords` | Kata aksi sosmed wajib ada dalam broadcast | `like,comment,share,follow,subscribe,repost` |
| `broadcast_required_phrase` | Frasa wajib dalam broadcast | `mohon izin dibantu` |
| `client_group_jid` | JID grup WhatsApp klien yang dilayani untuk recap engagement; sumber utama keanggotaan grup — jika kosong, sistem jatuh ke `clients.client_group` sebagai fallback | `120363XXXXXX@g.us` |
| `operator_unregistered_prompt` | Pesan saat nomor belum terdaftar mengirim broadcast | `Anda mengirim pesan tugas...(ya/tidak)` |
| `operator_satker_list_header` | Header daftar pilihan satker | `Pilih Satker Anda dengan membalas nomor urut:` |
| `operator_registration_ack` | Konfirmasi registrasi berhasil | `Nomor Anda berhasil terdaftar sebagai operator untuk {satker_name}.` |
| `operator_registration_declined` | Pesan saat operator menolak registrasi | `Baik, pendaftaran dibatalkan.` |
| `operator_invalid_choice` | Pesan saat pilihan satker tidak valid | `Pilihan tidak valid. Silakan balas dengan nomor urut.` |
| `operator_no_satker` | Pesan saat tidak ada satker aktif | `Tidak ada Satker aktif. Hubungi administrator.` |
| `operator_session_ttl_seconds` | TTL sesi registrasi (detik) | `300` |
| `operator_registration_max_attempts` | Maks percobaan sesi registrasi sebelum bot berhenti merespons nomor tersebut | `5` |
| `operator_registration_cooldown_minutes` | Periode window untuk menghitung `attempt_count` (menit) | `60` |
| `task_input_ack` | Ack tugas berhasil direkam | `Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.` |

### Tabel Operator `operators`

```sql
CREATE TABLE operators (
  phone_number  VARCHAR(30)   PRIMARY KEY,
  client_id     VARCHAR(100)  NOT NULL REFERENCES clients(client_id),
  satker_name   VARCHAR(200)  NOT NULL,
  registered_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE
);
```

Insert/update menggunakan upsert:
```sql
INSERT INTO operators (phone_number, client_id, satker_name)
VALUES ($1, $2, $3)
ON CONFLICT (phone_number) DO UPDATE
  SET client_id = EXCLUDED.client_id,
      satker_name = EXCLUDED.satker_name,
      registered_at = NOW(),
      is_active = TRUE;
```

### Tabel Sesi Registrasi `operator_registration_sessions`

```sql
CREATE TABLE operator_registration_sessions (
  phone_number     VARCHAR(30)  PRIMARY KEY,
  stage            VARCHAR(30)  NOT NULL, -- 'awaiting_confirmation' | 'awaiting_satker_choice'
  original_message TEXT         NOT NULL,
  expires_at       TIMESTAMPTZ  NOT NULL,
  attempt_count    SMALLINT     NOT NULL DEFAULT 1
);
```

### Aturan Akses Konfigurasi

- Sistem membaca `client_config` per request (atau dengan cache singkat ≤ 60 detik) — tidak di-cache indefinitely.
- Nilai default global (fallback) disimpan sebagai baris dengan `client_id = 'DEFAULT'`; nilai per satker mengoverride default jika ada.
- Baris sentinel `clients(client_id = 'DEFAULT')` dengan kolom wajib diisi nilai placeholder HARUS di-seed dalam migration yang sama dengan pembuatan `client_config`, agar FK constraint tidak melanggar saat insert baris DEFAULT.
- Semua perubahan `client_config` di DB langsung berlaku tanpa restart layanan.

## Clarifications

### Session 2026-03-25 (dipecah dari 001)

- Sumber data engagement: live fetch ke API IG/TikTok saat broadcast diterima (bukan DB snapshot).
- Scope grup: hanya grup klien terdaftar; DM diabaikan (untuk alur broadcast respons ke grup).
- Multi-message reply: bot mengirim ≥ 3 pesan sequential (ack + status summary + task recap) — tidak harus satu pesan tunggal.

### Session 2026-03-25 (second clarification pass)

- Q: FK constraint `client_config.client_id = 'DEFAULT'` — bagaimana menangani sentinel row DEFAULT agar tidak melanggar FK ke `clients`? → A: Tambahkan sentinel row `clients(client_id = 'DEFAULT')` dengan nilai placeholder dalam migration yang sama; baris ini menjadi prasyarat insert baris DEFAULT di `client_config`.
- Q: Perlindungan terhadap spam alur registrasi dari nomor tak dikenal? → A: Kolom `attempt_count` di `operator_registration_sessions`; jika melampaui `operator_registration_max_attempts` dalam window `operator_registration_cooldown_minutes` (keduanya di `client_config`), bot silent dan log warning.
- Q: Lifecycle `is_active` operator — apakah ada mekanisme deaktivasi dalam feature ini? → A: Di luar scope; admin update `is_active = FALSE` langsung via DB. Explicit out-of-scope dicatat di spec.
- Q: Event logging apa yang wajib di-log via pino? → A: Log info untuk semua pesan masuk yang melewati handler (nomor, tipe chat, platform URL); log warn/error untuk semua kondisi gagal (API timeout, invalid client_id, attempt_count exceeded, DB error). Tidak ada console.log di jalur produksi.

### Session 2026-03-25 (operator registration & task input)

- Q: Konflik FR-002 vs FR-014 — DM ke gateway: diabaikan atau diproses? → A: FR-014 menang untuk nomor terdaftar; FR-002 hanya berlaku untuk alur grup recap; DM dari nomor tidak terdaftar memicu alur registrasi.
- Q: Medium penyimpanan sesi registrasi operator — Redis, in-memory, atau PostgreSQL? → A: PostgreSQL (`operator_registration_sessions`); seluruh konfigurasi dipindahkan ke tabel `client_config` PostgreSQL per `client_id`, menggantikan env vars sebagai sumber konfigurasi utama.
- Q: Tabel penyimpanan tugas dari broadcast operator — tabel baru atau tabel yang sudah ada? → A: Tabel `insta_post` / `tiktok_post` yang sudah ada; tambahkan kolom `task_source` (nilai `'broadcast_wa'`) dan `operator_phone` via migration SQL.
- Q: Skema tabel `operators` — kolom apa yang dibutuhkan? → A: `phone_number` PK, `client_id` FK→`clients.client_id`, `satker_name` VARCHAR (denormalized), `registered_at` TIMESTAMPTZ, `is_active` BOOLEAN DEFAULT TRUE; upsert pada insert untuk menghindari duplikasi.
- Q: Sumber kebenaran keanggotaan grup klien — `client_config` atau `clients.client_group`? → A: `client_config.client_group_jid` adalah sumber utama; fallback ke `clients.client_group` jika baris konfigurasi tidak ada.

- Registrasi operator dipicu oleh pesan broadcast tugas itu sendiri dari nomor yang belum terdaftar — tidak ada perintah registrasi terpisah.
- Alur registrasi bersifat interaktif tiga langkah: (1) bot bertanya konfirmasi → (2) operator menjawab ya → (3) bot menampilkan daftar satker bernomor → operator memilih → registrasi selesai.
- Sistem mendukung lebih dari satu operator aktif per `client_id`.
- Daftar satker selalu diambil dinamis dari tabel `clients` (klien aktif) saat dialog berlangsung — tidak pernah disimpan statis di kode atau konfigurasi.
- Sesi registrasi memiliki batas waktu (TTL); jika operator tidak membalas dalam batas waktu, sesi kedaluwarsa dan broadcast berikutnya memulai ulang alur.
- Setelah registrasi selesai, pesan broadcast asli diproses ulang otomatis tanpa operator harus mengirim ulang.
- Konfigurasi (teks prompt, header daftar, TTL sesi, teks ack) disimpan di luar kode.


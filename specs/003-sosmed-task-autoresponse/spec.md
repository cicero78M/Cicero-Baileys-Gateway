# Feature Specification: WhatsApp Gateway — Input Tugas Post Sosmed via Pesan WA

**Feature Branch**: `003-sosmed-task-autoresponse`  
**Created**: 2026-03-25  
**Revised**: 2026-03-26  
**Status**: Implemented — Spec Aligned to Implementation  
**Reference**: Chakranarayana Admin Menu — Sub-menu #8 (Input Post Manual IG/TikTok)

---

## Overview

Fitur ini memungkinkan operator mendaftarkan tugas post Instagram dan TikTok ke dalam sistem CICERO melalui pesan WhatsApp berformat khusus. Sistem mendeteksi pola pesan broadcast tugas, merekam URL konten ke database, melakukan sinkronisasi data engagement (like/komentar), lalu mengirim rekap hasil ke operator — mengikuti alur yang sama dengan menu Input Post Manual pada aplikasi admin Chakranarayana.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator Input Tugas Post via DM (Priority: P1)

Seorang operator terdaftar mengirimkan pesan berformat broadcast tugas ke bot WhatsApp gateway via DM langsung, berisi URL post Instagram dan/atau TikTok yang perlu dikerjakan. Bot mengenali format pesan, menyimpan setiap URL ke database sebagai tugas (`insta_post`/`tiktok_post` dengan `task_source='broadcast_wa'`), kemudian — mengikuti alur Input Post Manual Chakranarayana — melakukan sinkronisasi data engagement (like IG / komentar TikTok) untuk konten yang baru saja disimpan. Bot membalas operator dengan tiga pesan berurutan: (1) **Rekap Tugas Sosmed** berisi status fetch tiap URL (✅/❌) dan daftar partisipan, (2) ack konfirmasi tugas tersimpan, (3) daftar lengkap semua tugas operator hari ini.

**Why this priority**: Ini adalah alur utama fitur — tanpa ini, operator tidak bisa mendaftarkan tugas posting dan data engagement tidak terekam.

**Independent Test**: Kirim pesan broadcast tugas dari nomor operator terdaftar ke bot via DM dengan URL Instagram dan TikTok. Verifikasi: (1) URL tercatat di `insta_post`/`tiktok_post` dengan `task_source='broadcast_wa'`; (2) bot membalas dengan rekap `*Rekap Tugas Sosmed*` berisi ✅/❌ per URL dan nama partisipan; (3) ack terkirim setelah rekap; (4) daftar tugas hari ini terkirim terakhir.

**Acceptance Scenarios**:

1. **Given** operator terdaftar mengirim DM dengan URL Instagram valid, **When** bot memproses, **Then** bot menyimpan shortcode ke `insta_post`, melakukan sinkronisasi likes, lalu membalas dengan rekap `*Rekap Tugas Sosmed*` yang mencantumkan `✅ [url] — N likes` beserta `Partisipan: @user1, @user2, ...`.
2. **Given** operator terdaftar mengirim DM dengan URL TikTok valid, **When** bot memproses, **Then** bot menyimpan video_id ke `tiktok_post`, melakukan sinkronisasi komentar, lalu membalas dengan rekap yang mencantumkan `✅ [url] — N komentar` beserta `Partisipan: @user1, @user2, ...`.
3. **Given** operator terdaftar mengirim DM dengan campuran URL Instagram dan TikTok, **When** bot memproses, **Then** bot menyimpan semua URL, sinkronisasi engagement untuk masing-masing platform, dan rekap memuat kedua seksi (Instagram dan TikTok) dalam satu pesan.
4. **Given** fetch API gagal/timeout untuk salah satu URL, **When** bot memproses, **Then** URL tersebut ditampilkan dengan `❌ [url] — data tidak tersedia` di rekap; URL lain yang berhasil tetap menampilkan data engagement.
5. **Given** bot berhasil membalas rekap, **When** urutan pesan diperiksa, **Then** urutan adalah: (1) rekap engagement → (2) ack konfirmasi → (3) daftar tugas hari ini; tidak ada pesan tambahan selain ketiga ini.
6. **Given** pesan broadcast tanpa kata kunci trigger (salam waktu + "mohon izin dibantu" + kata aksi), **When** bot menerima DM operator terdaftar, **Then** bot tidak merespons sama sekali — bukan broadcast tugas.

---

### User Story 2 — Bot Merekam Broadcast Tugas dari Grup Klien (Priority: P1)

Anggota grup WhatsApp klien (misalnya admin satker) mengirimkan pesan broadcast tugas ke grup WA yang terdaftar di CICERO. Bot mendeteksi pola broadcast, merekam URL ke database, dan membalas di grup dengan ack singkat. Tidak ada live fetch atau rekap engagement di jalur grup.

**Why this priority**: Jalur grup adalah jalur pemantauan tugas level satker — broadcast dari grup direkam otomatis tanpa interaksi DM individu.

**Independent Test**: Kirim pesan broadcast berformat tugas ke grup klien terdaftar. Verifikasi URL tercatat di database dan bot membalas ack ke grup dalam ≤ 5 detik. Verifikasi tidak ada data engagement di pesan grup.

**Acceptance Scenarios**:

1. **Given** grup WA terdaftar sebagai grup klien aktif, **When** pesan broadcast tugas diterima dengan URL Instagram dan/atau TikTok, **Then** bot merekam URL ke database dan membalas ack ke grup — tanpa live fetch dan tanpa rekap engagement.
2. **Given** grup WA tidak terdaftar di CICERO, **When** pesan broadcast tugas diterima, **Then** bot tidak merespons.
3. **Given** pesan diterima dari grup terdaftar tapi bukan format broadcast tugas, **When** bot memeriksa, **Then** bot tidak merespons.

---

### User Story 3 — Self-Registrasi Operator via Broadcast Tugas (Priority: P1)

Pegawai baru yang belum terdaftar mengirim pesan berformat broadcast tugas ke bot via DM. Bot mengenali format broadcast dari nomor tidak terdaftar, lalu memulai alur registrasi tiga langkah secara otomatis. Setelah registrasi selesai, pesan broadcast asli diproses ulang otomatis.

**Why this priority**: Tanpa alur ini, nomor operator baru diabaikan diam-diam dan pesan broadcast tidak terekam.

**Independent Test**: Kirim pesan broadcast tugas dari nomor tidak terdaftar ke bot via DM. Verifikasi alur tiga langkah: konfirmasi → daftar satker → pilih satker. Setelah registrasi, verifikasi tugas dari broadcast asli terekam di database.

**Acceptance Scenarios**:

1. **Given** nomor WA belum terdaftar mengirim pesan berformat broadcast tugas, **When** bot menerima, **Then** bot membalas dengan pertanyaan konfirmasi pendaftaran dan tidak memproses tugas.
2. **Given** bot mengirim pertanyaan konfirmasi, **When** operator membalas "ya", **Then** bot mengirim daftar bernomor seluruh satker/klien aktif dari database.
3. **Given** bot mengirim daftar satker, **When** operator memilih nomor valid, **Then** sistem menyimpan operator, membalas konfirmasi berhasil, dan memproses ulang broadcast tugas asli otomatis.
4. **Given** bot mengirim pertanyaan konfirmasi, **When** operator membalas "tidak", **Then** bot membalas penutup dan mengakhiri sesi; broadcast tugas asli tidak diproses.
5. **Given** operator yang sudah terdaftar mengirim broadcast tugas via DM, **When** bot menerima, **Then** tugas langsung diproses tanpa alur registrasi.

---

### Edge Cases

- URL tidak dikenali sebagai IG atau TikTok → diabaikan; hanya URL platform dikenali yang diproses.
- Operator terdaftar mengirim broadcast berformat valid via DM tapi **tidak mengandung URL IG atau TikTok sama sekali** → bot membalas satu pesan error (`operator_no_valid_url`); tidak ada respons tiga bagian; seen-marking tetap berlaku.
- Grup klien terdaftar menerima broadcast berformat valid tapi **tidak mengandung URL IG atau TikTok sama sekali** → bot tidak merespons ke grup; catat `logger.warn`; diperlakukan seolah bukan broadcast tugas.
- Fetch API gagal/timeout (jalur DM operator) → URL ditampilkan `❌` di rekap; tidak ada retry; error di-log `logger.warn` dengan status code/reason. HTTP 429 diperlakukan sama dengan timeout.
- Koneksi WhatsApp terputus saat memproses → pesan antrian akan diproses ulang saat koneksi pulih.
- Grup tidak terdaftar di CICERO → diabaikan tanpa respons.
- Dua pesan hampir bersamaan dari nomor belum terdaftar (race condition registrasi) → `PRIMARY KEY (phone_number)` pada `operator_registration_sessions` sebagai natural lock; INSERT kedua gagal, di-log `logger.warn`, tidak ada respons duplikat.
- Operator mengirim broadcast kedua saat sesi registrasi masih aktif → sesi aktif dilanjutkan; pesan baru diabaikan (tidak membuka sesi duplikat).
- Tidak ada satker aktif di database saat bot hendak mengirim daftar pilihan → bot membalas bahwa tidak ada satker aktif dan minta hubungi administrator.

---

## Requirements *(mandatory)*

### Out-of-Scope (Explicit)

- **Deaktivasi operator**: Mengubah status `is_active = FALSE` pada entri tabel `operators` di luar scope feature ini; admin melakukan deaktivasi langsung via query DB. Feature manajemen operator (aktif/nonaktif via antarmuka) dapat menjadi feature terpisah di masa mendatang.
- **Manajemen konfigurasi via UI**: Perubahan nilai `client_config` dilakukan langsung via DB; tidak ada endpoint atau antarmuka admin untuk mengelola konfigurasi dalam feature ini.
- **Audit log terpusat**: Pencatatan historis semua tindakan operator atau admin bukan bagian dari feature ini.

### Functional Requirements

- **FR-001**: Sistem HARUS mendeteksi pesan broadcast tugas sosmed berdasarkan kombinasi kata kunci: salam waktu (`pagi`/`siang`/`sore`/`malam`), frasa `mohon izin dibantu`, dan setidaknya satu kata aksi (`like`, `comment`, `share`, `follow`, `subscribe`, `repost`). Matching bersifat **case-insensitive** menggunakan **whole-word boundary** (`\b<kata>\b`) sehingga substring tidak men-trigger deteksi; **urutan kemunculan kata kunci tidak dipentingkan**.
- **FR-002**: Sistem HARUS memproses pesan broadcast tugas yang diterima dari **grup WhatsApp terdaftar** sebagai grup klien aktif dengan: (1) mengekstrak dan merekam URL ke database (`insta_post`/`tiktok_post`) dengan `task_source='broadcast_wa'`, (2) mengirim ack ke grup. **Tidak ada live fetch atau recap engagement dari jalur grup.** **Pengecualian**: jika setelah ekstraksi tidak ditemukan satu pun URL Instagram atau TikTok yang valid, bot **tidak** mengirim ack ke grup dan mencatat `logger.warn` — diperlakukan seolah pesan bukan broadcast tugas.
- **FR-003**: Sistem HARUS mengekstrak semua URL Instagram dan TikTok dari pesan broadcast.
- **FR-004**: Sistem HARUS membedakan URL Instagram (mengandung `instagram.com` atau shortcode `ig.me`) dari URL TikTok (mengandung `tiktok.com` atau `vm.tiktok.com`).
- **FR-005**: Sistem HARUS melakukan **pengambilan data post dan sinkronisasi engagement** hanya untuk pesan broadcast dari **operator terdaftar via DM langsung**, mengikuti alur Input Post Manual chakranarayana:
  1. Sistem HARUS membatasi jumlah URL yang diproses per broadcast menjadi maksimal **10 URL** (gabungan IG + TikTok); URL ke-11 dan seterusnya **diabaikan diam-diam** dan dicatat `logger.warn` — broadcast tidak ditolak, 10 URL pertama tetap diproses.
  2. Simpan setiap URL ke database (`insta_post`/`tiktok_post`) menggunakan upsert dengan `task_source='broadcast_wa'`.
  3. Fetch data post satu per satu secara **sekuensial** (bukan paralel) menggunakan `fetchSinglePostKhusus` (IG) atau `fetchAndStoreSingleTiktokPost` (TikTok) dengan timeout 8 detik per URL.
  4. Setelah semua URL IG selesai di-fetch, panggil **sinkronisasi likes** (`handleFetchLikesInstagram(null, null, clientId)`) untuk mengambil dan menyimpan data likes dari API.
  5. Setelah semua URL TikTok selesai di-fetch, panggil **sinkronisasi komentar** (`handleFetchKomentarTiktokBatch(null, null, clientId)`) untuk mengambil dan menyimpan data komentar dari API.
  Jika fetch atau sinkronisasi gagal (timeout, HTTP 4xx/5xx, atau error lain), URL tersebut dianggap "data tidak tersedia" tanpa retry — error di-log `logger.warn`; URL lain tetap diproses. Live fetch **tidak** dilakukan dari jalur grup.
- **FR-006**: Sistem HARUS membalas broadcast tugas yang terdeteksi dengan respons berbeda per jalur:
  - **(a) Jalur grup**: ack hardcoded berisi nama hari/tanggal + konfirmasi jumlah URL direkam — **satu pesan ke grup, tidak ada data engagement**.
  - **(b) Jalur DM operator terdaftar**: tiga pesan berurutan ke DM operator:
    1. **Rekap engagement** (`*Rekap Tugas Sosmed*\n📅 [tanggal]`) berisi status per URL dengan format `✅ [url] — N likes/komentar` diikuti baris `Partisipan: @user1, @user2, ...` jika ada; URL yang gagal ditampilkan `❌ [url] — data tidak tersedia`. Seksi Instagram dan TikTok dipisahkan. **Jika DB read untuk data partisipan gagal** (koneksi timeout, query error), URL tersebut tetap ditampilkan `✅ [url] — N count` menggunakan nilai count dari objek return fetch, namun baris `Partisipan:` **dilewati** (tidak ditampilkan); error dicatat `logger.warn`. Kegagalan DB read partisipan tidak memblokir pengiriman rekap.
    2. **Ack konfirmasi** tugas tersimpan (teks dari `task_input_ack` di `client_config`, template `{client_id}` diganti dengan `client_id` operator).
    3. **Daftar tugas hari ini** milik operator (`insta_post`/`tiktok_post` dengan `operator_phone` dan `task_source='broadcast_wa'` hari ini).
    **Pengecualian**: jika setelah ekstraksi URL tidak ditemukan satu pun URL Instagram atau TikTok yang valid (semua URL diabaikan oleh FR-007), sistem mengirim **satu pesan error** ke operator (teks dari config key `operator_no_valid_url`, default: *"Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda."*) dan **tidak** mengirim respons tiga bagian; seen-marking (FR-009) tetap berlaku.
- **FR-007**: Sistem HARUS mengabaikan URL yang bukan dari platform Instagram atau TikTok.
- **FR-008**: Semua respons keluar HARUS diantrekan melalui sistem antrian pesan (BullMQ outbox) untuk mencegah pelanggaran batas pengiriman WhatsApp.
- **FR-009**: Sistem HARUS menandai pesan masuk sebagai "sudah dibaca" (seen) sebelum mulai memproses, dengan jeda 1 detik.
- **FR-010**: Pesan STATUS WhatsApp (`status@broadcast`) HARUS selalu diabaikan dan tidak diproses.
- **FR-011**: Ketika sistem mendeteksi pesan dalam format broadcast tugas dari nomor yang **belum terdaftar** sebagai operator, sistem HARUS menghentikan pemrosesan tugas dan membalas dengan pesan konfirmasi pendaftaran — bukan mengabaikan pesan secara diam-diam.
- **FR-012**: Jika operator mengkonfirmasi ingin mendaftar, sistem HARUS mengambil daftar seluruh klien/satker aktif dari registri dan mengirimkannya sebagai pesan bernomor urut untuk dipilih operator; daftar ini selalu diambil secara dinamis dari database, bukan hardcoded.
- **FR-013**: Setelah operator memilih nomor satker yang valid dari daftar, sistem HARUS menyimpan asosiasi nomor WA operator → `client_id` satker yang dipilih sebagai operator aktif; jika nomor yang sama sudah terdaftar sebelumnya, data diperbarui (upsert) tanpa membuat entri duplikat.
- **FR-014**: Sistem HARUS memproses pesan dalam format broadcast tugas yang berasal dari nomor operator terdaftar — **baik dari grup klien maupun dari DM langsung ke gateway** — dan merekam setiap URL yang teridentifikasi ke tabel `insta_post` (untuk URL Instagram) atau `tiktok_post` (untuk URL TikTok) dengan kolom `task_source = 'broadcast_wa'` dan `client_id` sesuai operator. Perilaku respons mengikuti jalur yang ditetapkan FR-002 (jalur grup) dan FR-005 + FR-006b (jalur DM operator terdaftar); tidak ada deskripsi alur ganda di FR ini.
- **FR-015**: Semua referensi `client_id` dalam subsistem registrasi operator dan perutean tugas HARUS di-resolve secara dinamis dari registri klien aktif; tidak ada nilai `client_id` yang boleh di-hardcode dalam source code maupun file konfigurasi statis.
- **FR-016**: Sistem HARUS membaca semua konfigurasi perilaku (keyword trigger, teks respons, konfigurasi grup klien, dan parameter operasional lainnya) dari tabel konfigurasi PostgreSQL yang diorganisasi per `client_id`. **Pengecualian**: teks ack grup (FR-006a) di-hardcode — tidak memerlukan kustomisasi per satker.
- **FR-017**: Sistem HARUS menjaga status sesi registrasi per nomor WA dengan menyimpan state ke tabel `operator_registration_sessions` di PostgreSQL (kolom: `phone_number`, `stage`, `original_message`, `expires_at`); setiap balasan dari nomor tersebut dalam periode sesi aktif diinterpretasikan sebagai bagian dari alur registrasi, bukan sebagai broadcast tugas baru. Sesi **di-hydrate otomatis dari DB per pesan masuk** — handler selalu melakukan query `operator_registration_sessions WHERE phone_number = $1 AND expires_at > NOW()` sebelum memutuskan routing; tidak ada mekanisme startup khusus untuk memuat ulang sesi aktif, sehingga restart gateway transparan terhadap sesi yang sedang berlangsung. Race condition ditangani oleh `PRIMARY KEY (phone_number)` sebagai natural lock — INSERT kedua gagal, error ditangkap dan di-log `logger.warn`, tanpa respons duplikat.
- **FR-018**: Setelah registrasi berhasil diselesaikan, sistem HARUS memproses kembali pesan broadcast tugas asli menggunakan **synchronous self-call** langsung di akhir handler registrasi; seen-marking (FR-009) **dilewati** pada replay karena pesan sudah di-seen pada pass pertama.
- **FR-019**: Sistem HARUS melacak jumlah percobaan sesi registrasi per nomor WA menggunakan kolom `attempt_count`; jika melampaui `operator_registration_max_attempts` dalam periode `operator_registration_cooldown_minutes`, sistem HARUS berhenti merespons nomor tersebut dan mencatat warning ke logger — tanpa mengirim pesan balik.
- **FR-020**: Sistem HARUS mencatat log menggunakan pino logger untuk setiap pesan masuk yang melewati handler sosmed task (level `info`: nomor pengirim **penuh** (tanpa masking — sistem internal), tipe chat, platform URL terdeteksi), serta mencatat level `warn` atau `error` untuk semua kondisi gagal (API fetch timeout, `client_id` tidak valid, `attempt_count` melebihi batas, insert/upsert DB gagal). Tidak ada `console.log` di jalur produksi.
- **FR-021**: Sistem HARUS membatasi frekuensi pemrosesan broadcast tugas per operator terdaftar dengan menggunakan **rate limit berbasis in-memory counter per `phone_number`**: maksimal **20 broadcast per jam** (window 60 menit bergulir). Jika operator melampaui batas, pesan broadcast **diabaikan diam-diam** (tidak ada respons ke operator) dan dicatat `logger.warn` dengan nomor pengirim dan jumlah hit. Counter direset otomatis setelah window 60 menit kedaluwarsa. Nilai batas dapat dikonfigurasi via `client_config` key `operator_broadcast_rate_limit` (default: `20`); window duration tidak dapat dikonfigurasi (hardcoded 60 menit).

---

### Key Entities

- **Broadcast Tugas Sosmed**: Pesan operator ke group WA atau via DM berisi instruksi aksi sosmed (like, comment, share) pada konten tertentu, disertai URL konten.
- **Data Engagement**: Hasil live fetch dari API IG/TikTok — jumlah like/komentar dan daftar username partisipan per konten.
- **Grup Klien**: Grup WhatsApp yang terdaftar sebagai `client_group` pada data klien aktif di CICERO; hanya grup ini yang dilayani untuk alur respons grup.
- **Operator**: Nomor WhatsApp yang telah menyelesaikan alur registrasi dan dikonfirmasi sebagai operator aktif untuk sebuah `client_id`; data disimpan di tabel `operators` (lihat skema di bawah).
- **Registrasi Operator**: Alur interaktif yang dipicu secara otomatis ketika nomor WA yang belum terdaftar mengirim pesan berformat broadcast tugas; terdiri dari langkah konfirmasi → pemilihan satker dari daftar → penyimpanan asosiasi nomor ↔ `client_id`.
- **Konfigurasi Klien**: Pasangan key-value yang tersimpan di tabel `client_config` PostgreSQL dan dikaitkan dengan `client_id` tertentu; mencakup keyword trigger, teks respons, konfigurasi grup, dan parameter operasional; dapat berbeda antar satker dan dapat diubah runtime tanpa restart layanan.
- **Sesi Registrasi**: Baris sementara di tabel `operator_registration_sessions` yang menyimpan progres dialog registrasi (`stage`: `awaiting_confirmation` | `awaiting_satker_choice`), pesan broadcast asli, dan timestamp kedaluwarsa (`expires_at`); **dibuat** saat bot mengirim pertanyaan konfirmasi; **dihapus segera** (`DELETE`) setelah registrasi selesai berhasil atau operator menolak; dibiarkan kedaluwarsa (dan dibersihkan oleh `purgeExpiredSessions`) hanya jika operator tidak membalas hingga TTL habis.
- **Daftar Tugas Klien**: Entri tugas yang tersimpan di tabel `insta_post` atau `tiktok_post` (sesuai platform URL) dengan kolom `task_source = 'broadcast_wa'` dan `client_id` operator; kolom `task_source` ditambahkan sebagai migration ke tabel-tabel tersebut sebagai bagian dari feature ini.

---

## Success Criteria *(mandatory)*

- **SC-001**: Bot merespons broadcast tugas sosmed dalam batas waktu berdasarkan jalur: **(a) jalur grup** — ack terkirim ke grup dalam ≤ 5 detik; **(b) jalur DM operator terdaftar** — recap dengan data engagement terkirim dalam ≤ 15 detik untuk broadcast normal (≤ 3 URL, semua fetch berhasil). Target ≤ 15 detik adalah **best-effort** dan dapat terlampaui jika URL count mendekati batas 10 atau semua fetch timeout (40 detik pada kasus terburuk 5 × timeout 8s) — ini tidak dianggap kegagalan SC asalkan semua URL tetap diproses; **batas keras maksimal 90 detik** sebelum proses dianggap gagal.
- **SC-002**: 0% pesan non-broadcast direspons secara keliru dari jalur sosmed task handler (false positive khusus fitur ini).
- **SC-003**: Bot tetap beroperasi penuh dan memproses semua pesan broadcast bahkan setelah WhatsApp client reconnect — tidak ada pesan terdrop.
- **SC-004**: Operator baru dapat menyelesaikan alur registrasi dalam tepat 3 pesan bolak-balik dengan bot (broadcast tugas → konfirmasi ya → pilih nomor satker); 100% alur registrasi valid menghasilkan entri operator tersimpan dan tugas asli terproses otomatis.
- **SC-005**: 0% entri tugas tercatat dari operator yang tidak terdaftar atau `client_id` yang tidak valid — tidak ada data tugas yang terkontaminasi oleh pengirim tidak sah.

## Definition of Done

Sebuah User Story dinyatakan **selesai** bila **ketiga** kondisi ini terpenuhi:

1. **Unit test**: Semua unit test yang terkait User Story lulus (`npm test`) — tidak boleh ada test yang di-skip atau di-comment.
2. **Smoke test manual**: Integrasi ke gateway nyata terbukti via test DM/grup di environment dev — alur normal dan setidaknya satu skenario error/edge diverifikasi secara manual.
3. **No console.log**: Tidak ada `console.log` di jalur produksi; semua log wajib menggunakan `pino` (`logger.info` / `logger.warn` / `logger.error`).

---

## Assumptions

- Grup klien aktif sudah terdaftar di kolom `client_group` tabel `clients` sebelum broadcast tugas mulai dikirim ke grup tersebut; namun nilai `client_group_jid` di `client_config` adalah sumber utama untuk pencocokan JID grup — sistem membaca `client_config` dahulu dan hanya fallback ke `clients.client_group` jika `client_group_jid` tidak ditemukan di konfigurasi klien tersebut.
- Fetch dan sinkronisasi engagement (FR-005) **hanya dilakukan pada jalur DM operator terdaftar** — tidak pernah dari jalur grup. Fetch dilakukan **sekuensial** per URL (bukan paralel) dalam fungsi `liveFetchAll` dengan timeout 8 detik per URL; setelah semua URL IG selesai di-fetch, dilakukan sinkronisasi likes via `handleFetchLikesInstagram(null, null, clientId)`; setelah semua URL TikTok selesai di-fetch, dilakukan sinkronisasi komentar via `handleFetchKomentarTiktokBatch(null, null, clientId)`. Kedua handler dipanggil secara **headless** (tanpa WA client / tanpa JID tujuan) — mereka hanya mengambil data dari API dan menyimpan ke database, tidak mengirim pesan. Jika sinkronisasi gagal, error di-log sebagai `logger.warn` dan tidak memblokir pengiriman rekap. Per broadcast, sistem memproses **maksimal 10 URL** (gabungan IG + TikTok); URL ke-11 dan seterusnya diabaikan diam-diam dan di-log `logger.warn`.
- Data partisipan untuk rekap diambil dari database setelah sinkronisasi selesai: `getLikesByShortcode(shortcode)` (returns `string[]`) untuk Instagram, `getCommentsByVideoId(videoId)` (returns `{ comments: string[] }`) untuk TikTok.
- Dynamic imports (`import()`) digunakan untuk handler engagement (`fetchLikesInstagram.js`, `fetchCommentTiktok.js`) guna menghindari circular dependency.
- Rate limiting operator terdaftar (FR-021) diimplementasikan menggunakan in-memory counter (`Map<phone_number, { count, windowStart }>`) di dalam service — tidak memerlukan tabel DB baru. Counter tidak bertahan setelah restart layanan; ini diterima karena window 60 menit yang pendek.
- Sesi registrasi di-hydrate otomatis dari DB per pesan masuk (query `operator_registration_sessions WHERE phone_number = $1 AND expires_at > NOW()`); tidak ada startup logic khusus. Gateway restart transparan terhadap sesi aktif — operator yang sedang dalam alur registrasi dapat melanjutkan setelah restart tanpa kehilangan state.
- Broadcast bersamaan dari operator berbeda diproses secara **independen tanpa cross-operator locking** — setiap pemanggilan `liveFetchAll` bersifat self-contained per `clientId`. Handler sinkronisasi engagement (`handleFetchLikesInstagram`, `handleFetchKomentarTiktokBatch`) menggunakan upsert sehingga eksekusi konkuren untuk `clientId` berbeda aman dilakukan tanpa koordinasi tambahan.
- Resolusi klien target dari group JID dilakukan secara dinamis — tidak ada `client_id` yang di-hardcode.
- Satu WhatsApp client (gateway) menangani seluruh grup terdaftar dan semua DM registrasi operator.
- BullMQ outbox worker sudah terhubung saat gateway startup.
- Tabel `insta_post` dan `tiktok_post` sudah ada; feature ini menambahkan kolom `task_source VARCHAR(30)` (nullable) dan `operator_phone VARCHAR(30)` (nullable) ke kedua tabel via migration SQL — entri lama tidak terpengaruh.
- Tabel `operator_registration_sessions` (PostgreSQL) menyimpan status sesi registrasi aktif per nomor WA; baris dibuang setelah sesi selesai atau kedaluwarsa.
- Tabel `operators` dibuat sebagai bagian dari feature ini via migration SQL; upsert digunakan untuk menghindari duplikasi saat operator yang sama mendaftar ulang.
- Migration SQL untuk `client_config` HARUS menyertakan INSERT sentinel row `clients(client_id = 'DEFAULT')` terlebih dahulu (dengan kolom wajib diisi nilai placeholder) sebelum membuat tabel `client_config`, agar FK constraint dapat dipenuhi saat baris DEFAULT di-seed. Migration `20260325_007_seed_client_config_defaults.sql` memiliki tepat **13 DEFAULT config rows**; 2 config key tambahan (`operator_broadcast_rate_limit`, `operator_no_valid_url`) di-seed terpisah via Migration 009 â€” total **15 rows** setelah keduanya dijalankan (diverifikasi terhadap file aktual 2026-03-26).
- Semua timestamp di database menggunakan **timezone Jakarta (Asia/Jakarta / WIB = UTC+7)** — dikonfigurasi di level Pool PostgreSQL via `options: '-c timezone=Asia/Jakarta'` di `src/db/postgres.js`.

---

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
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
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
| `client_group_jid` | JID **tunggal** grup WhatsApp klien yang dilayani untuk broadcast tugas; satu `client_id` = satu grup aktif (equality check, bukan array). Sumber utama keanggotaan grup — jika kosong, sistem jatuh ke `clients.client_group` sebagai fallback. **Tidak di-seed sebagai DEFAULT** — harus dikonfigurasi per-satker (lihat quickstart.md Seksi 3) | `120363XXXXXX@g.us` |
| `operator_unregistered_prompt` | Pesan saat nomor belum terdaftar mengirim broadcast | `Anda mengirim pesan tugas...(ya/tidak)` |
| `operator_satker_list_header` | Header daftar pilihan satker | `Pilih Satker Anda dengan membalas nomor urut:` |
| `operator_registration_ack` | Konfirmasi registrasi berhasil — **template**: `{satker_name}` diganti dengan nama satker yang dipilih | `Nomor Anda berhasil terdaftar sebagai operator untuk {satker_name}.` |
| `operator_registration_declined` | Pesan saat operator menolak registrasi | `Baik, pendaftaran dibatalkan.` |
| `operator_invalid_choice` | Pesan saat pilihan satker tidak valid | `Pilihan tidak valid. Silakan balas dengan nomor urut.` |
| `operator_no_satker` | Pesan saat tidak ada satker aktif | `Tidak ada Satker aktif. Hubungi administrator.` |
| `operator_session_ttl_seconds` | TTL sesi registrasi (detik) | `300` |
| `operator_registration_max_attempts` | Maks percobaan sesi registrasi sebelum bot berhenti merespons nomor tersebut | `5` |
| `operator_registration_cooldown_minutes` | Periode window untuk menghitung `attempt_count` (menit) | `60` |
| `task_input_ack` | Ack tugas berhasil direkam **(jalur DM operator terdaftar saja)** — **template**: `{client_id}` diganti dengan `client_id` operator (contoh: `DITINTELKAM`) menggunakan `configValue.replace('{client_id}', resolvedClientId)` sebelum `enqueueSend`; teks ack grup di-hardcode terpisah | `Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.` |
| `operator_broadcast_rate_limit` | Maks jumlah broadcast yang diproses per operator terdaftar per jam (window 60 menit bergulir); melebihi batas = diabaikan diam-diam + `logger.warn` (FR-021) | `20` |
| `operator_no_valid_url` | Pesan error saat broadcast operator terdaftar tidak mengandung URL IG atau TikTok yang valid | `Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda.` |

> **Note**: `client_group_jid` sengaja tidak di-seed ke baris DEFAULT karena nilainya unik per satker. Ke-13 config key lainnya di-seed sebagai baris DEFAULT via migration `20260325_007_seed_client_config_defaults.sql`. Dua config key tambahan (`operator_broadcast_rate_limit`, `operator_no_valid_url`) di-seed terpisah via migration `20260326_009_add_operator_rate_limit_config.sql` — total **15 DEFAULT config rows** setelah kedua migration dijalankan.

### Tabel Operator `operators`

```sql
CREATE TABLE operators (
  phone_number  VARCHAR(30)   PRIMARY KEY,
  client_id     VARCHAR(100)  NOT NULL REFERENCES clients(client_id),
  satker_name   VARCHAR(200)  NOT NULL,
  registered_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
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
      updated_at = NOW(),
      is_active = TRUE;
```

### Tabel Sesi Registrasi `operator_registration_sessions`

```sql
CREATE TABLE operator_registration_sessions (
  phone_number      VARCHAR(30)  PRIMARY KEY,
  stage             VARCHAR(30)  NOT NULL, -- 'awaiting_confirmation' | 'awaiting_satker_choice'
  original_message  TEXT         NOT NULL,
  expires_at        TIMESTAMPTZ  NOT NULL,
  attempt_count     SMALLINT     NOT NULL DEFAULT 1,
  first_attempt_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),  -- untuk jendela cooldown FR-019 (D3)
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Aturan Akses Konfigurasi

- Sistem membaca `client_config` per request (atau dengan cache singkat ≤ 60 detik) — tidak di-cache indefinitely.
- Nilai default global (fallback) disimpan sebagai baris dengan `client_id = 'DEFAULT'`; nilai per satker mengoverride default jika ada.
- Baris sentinel `clients(client_id = 'DEFAULT')` dengan kolom wajib diisi nilai placeholder HARUS di-seed dalam migration yang sama dengan pembuatan `client_config`, agar FK constraint tidak melanggar saat insert baris DEFAULT.
- Semua perubahan `client_config` di DB langsung berlaku tanpa restart layanan.

---

## Clarifications

### Session 2026-03-25 (clarify pass — pre-implementation)

- Q: Live fetch ke API IG/TikTok dilakukan via modul mana? → A: Fetch post: `fetchSinglePostKhusus` (IG) dan `fetchAndStoreSingleTiktokPost` (TikTok). Sinkronisasi engagement: `handleFetchLikesInstagram` dan `handleFetchKomentarTiktokBatch` — dipanggil headless `(null, null, clientId)` setelah semua post di-fetch per platform, mengikuti alur Input Post Manual chakranarayana.
- Q: Template `{client_id}` di `task_input_ack` — bagaimana cara interpolasinya? → A: Service melakukan `configValue.replace('{client_id}', resolvedClientId)` sebelum `enqueueSend`; `resolvedClientId` adalah string `client_id` operator (contoh: `"DITINTELKAM"`) — bukan `satker_name`.
- Q: Model concurrency untuk fetch multi-URL (IG + TikTok) dalam satu broadcast? → A: **Sekuensial** — `for...of` loop per URL dengan `withTimeout(..., 8000)`; bukan `Promise.allSettled` paralel. Sinkronisasi engagement dipanggil satu kali per platform setelah semua URL platform tersebut selesai di-fetch.
- Q: Apakah keyword matching FR-001 case-sensitive dan menggunakan batas kata? → A: Case-insensitive, whole-word boundary (`\bkata\b`), urutan kata tidak dipentingkan.
- Q: Definition of Done untuk setiap User Story — kondisi apa yang menyatakan US selesai? → A: (1) semua unit test terkait User Story lulus (`npm test`), (2) smoke test manual di environment dev terbukti (DM/grup nyata), (3) tidak ada `console.log` di jalur produksi (wajib pino).
- Q: Bagaimana timezone untuk penyimpanan tanggal/waktu di database? → A: Semua timestamp menggunakan **timezone Jakarta (Asia/Jakarta, WIB, UTC+7)**. Dikonfigurasi di level pg Pool via `options: '-c timezone=Asia/Jakarta'`.
- Q: Mekanisme replay FR-018 — bagaimana broadcast asli diproses ulang setelah registrasi selesai? → A: Synchronous self-call langsung di akhir handler registrasi; `waClient` tersedia dari closure; seen-marking (FR-009) **dilewati** untuk replay karena pesan sudah di-seen pada pass pertama.
- Q: Dari jalur mana fetch/sinkronisasi dilakukan — grup atau DM? → A: Fetch dan sinkronisasi engagement **hanya** dari jalur DM operator terdaftar; pesan broadcast dari grup klien hanya merekam URL ke database dan mengirim ack ke grup.
- Q: Urutan respons bot ke operator terdaftar via DM? → A: (1) Rekap Tugas Sosmed, (2) ack konfirmasi, (3) daftar tugas hari ini. Tidak ada pesan "Fetch sukses" terpisah.
- Q: Format rekap engagement? → A: Header `*Rekap Tugas Sosmed*\n📅 [tanggal]`, lalu seksi per platform dengan bullet `✅ [url] — N likes/komentar` diikuti baris `Partisipan: @user1, @user2` jika ada data; URL gagal ditampilkan `❌ [url] — data tidak tersedia`.
- Q: Bagaimana perlakuan error API fetch — apakah HTTP 429 (quota) diperlakukan berbeda dari timeout? → A: Tidak ada retry; keduanya diperlakukan sama — error ditangkap, URL tersebut dianggap "data tidak tersedia", error di-log `logger.warn`. Tidak ada cooldown atau perbedaan perlakuan antara 429 dan timeout.
- Q: Race condition — dua pesan bersamaan dari nomor belum terdaftar sebelum sesi terbuat? → A: `PRIMARY KEY (phone_number)` pada `operator_registration_sessions` sebagai mutual exclusion alami: INSERT kedua gagal; tangkap error, log `logger.warn`, tidak kirim respons duplikat.
- Q: Lifecycle sesi registrasi — baris sesi dihapus segera setelah registrasi atau ditunggu expired? → A: `DELETE` baris sesi segera setelah registrasi berhasil atau operator menolak; dibiarkan kedaluwarsa hanya jika operator tidak membalas hingga TTL habis.

### Session 2026-03-26 (align spec to implementation)

- Q: Dynamic import atau static import untuk handler engagement? → A: **Dynamic import** (`await import(...)`) di dalam fungsi `liveFetchAll` untuk menghindari circular dependency antara service dan handler.
- Q: Sumber data partisipan untuk rekap? → A: Setelah sinkronisasi selesai, data partisipan dibaca dari DB via `getLikesByShortcode(shortcode)` (returns `string[]`) untuk IG, dan `getCommentsByVideoId(videoId)` (returns `{ comments: string[] }`) untuk TikTok — bukan langsung dari hasil API fetch.
- Q: TikTok engagement count fieldname? → A: `data.commentCount` (camelCase), bukan `data.comment_count`. `fetchAndStoreSingleTiktokPost` mengembalikan object dengan field camelCase.
- Q: Berapa batas maksimum URL yang dapat diproses per broadcast (jalur DM)? → A: **Maksimal 10 URL** per broadcast (gabungan IG + TikTok). URL ke-11 dan seterusnya diabaikan diam-diam dan dicatat `logger.warn`; broadcast tidak ditolak.
- Q: Apakah operator terdaftar perlu dibatasi frekuensi pengiriman broadcast? → A: Ya — **maksimal 20 broadcast per jam** per operator (window 60 menit bergulir, in-memory counter). Melebihi batas: broadcast diabaikan diam-diam, dicatat `logger.warn`. Nilai batas dikonfigurasi via `client_config` key `operator_broadcast_rate_limit` (default 20); window hardcoded 60 menit.
- Q: Bagaimana sesi registrasi aktif dipulihkan setelah gateway restart? → A: Re-hydrate otomatis dari DB per pesan masuk — handler query `operator_registration_sessions` by `phone_number` sebelum routing; tidak ada startup logic khusus.
- Q: Apakah broadcast bersamaan dari operator berbeda memerlukan locking? → A: Tidak — setiap `liveFetchAll` self-contained per `clientId`; handler sinkronisasi engagement bersifat idempoten (upsert-based), aman dijalankan konkuren untuk `clientId` berbeda.
- Q: FR-014 menduplikasi deskripsi alur FR-005/FR-006 — bagaimana menyelesaikannya? → A: FR-014 direvisi agar **mereferensikan FR-002, FR-005, dan FR-006b** tanpa mendeskripsikan alur inline; eliminasi risiko stale duplicate.
- Q: Apa perilaku rekap jika DB read data partisipan gagal (bukan API fetch gagal)? → A: Tampilkan `✅ [url] — N count` menggunakan nilai count dari return objek fetch; **lewati** baris `Partisipan:`; catat `logger.warn`. Tidak memblokir pengiriman rekap. Count dari sync (DB partisipan) dan count dari fetch (return value) dapat berbeda — gunakan nilai yang tersedia.
- Q: Apa yang terjadi jika operator terdaftar mengirim broadcast berformat valid via DM tapi tanpa URL IG/TikTok? → A: Bot membalas **satu pesan error** dari config key `operator_no_valid_url` (default: "Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda."); tidak mengirim respons tiga bagian; seen-marking tetap berlaku.
- Q: Apa yang terjadi jika grup klien terdaftar menerima broadcast berformat valid tapi tanpa URL IG/TikTok? → A: Bot **tidak merespons** ke grup; catat `logger.warn`; diperlakukan seolah bukan broadcast tugas — tidak ada ack "0 URL direkam".

### Session 2026-03-26 (plan clarification pass)

- Q: Migration 7 (data-model.md) now seeds 15 rows including 2 delta keys; plan.md Delta 6 also seeds those same 2 keys in Migration 009 — which is authoritative? → A: Revert Migration 7 to 13 rows; `operator_broadcast_rate_limit` and `operator_no_valid_url` seeded exclusively in Migration 009 (`20260326_009_add_operator_rate_limit_config.sql`). Migration 007 cannot be modified on deployed instances; Migration 009 is the correct forward delta. Total DEFAULT rows after both migrations: 15.

---

## Planning Decisions

Keputusan berikut dibuat selama sesi perencanaan dan dokumentasi, termasuk revisi setelah implementasi mengikuti alur chakranarayana menu #8.

> **Catatan label**: Label `PD-01` dst. digunakan di sini agar tidak bertabrakan dengan label `D1`–`D18` di `research.md` yang mendokumentasikan keputusan riset teknis berbeda.

| Keputusan | Ringkasan |
|---|---|
| PD-01: Outbound routing | Semua pesan keluar via `waOutbox.enqueueSend`; tidak pernah `waClient.sendMessage` langsung |
| PD-02: Config cache | In-memory `Map` dengan 60s TTL di `clientConfigService`; tidak ada dependensi Redis |
| PD-03: Kolom `first_attempt_at` | Ditambahkan ke `operator_registration_sessions` untuk mendukung jendela cooldown FR-019 |
| PD-04: Target penyimpanan tugas | Tulis ke `insta_post` / `tiktok_post` (bukan `insta_post_khusus`) dengan `task_source='broadcast_wa'` |
| PD-05: Scope refactor | `waAutoSosmedTaskService.js` di-refactor in-place; tidak diganti |
| PD-06: Penempatan `resolveClientIdForGroup` | Ada di `clientConfigService.js` (config concern, bukan registration concern) |
| PD-07: `deactivateOperator` | Di luar scope sesuai spec; TIDAK diimplementasikan dalam fitur ini |
| PD-08: Reset jendela cooldown | `upsertSession` mereset `attempt_count=1, first_attempt_at=NOW()` saat jendela kedaluwarsa |
| PD-09: Seen-marking | `waClient.readMessages([messageKey])` + jeda 1 detik dipanggil di awal handler (FR-009) |
| PD-10: Fetch sekuensial | `liveFetchAll` menggunakan `for...of` loop (bukan `Promise.allSettled` paralel) agar sinkronisasi engagement berjalan setelah semua URL per platform selesai — mengikuti alur chakranarayana Input Post Manual |
| PD-11: Sinkronisasi engagement headless | `handleFetchLikesInstagram(null, null, clientId)` dan `handleFetchKomentarTiktokBatch(null, null, clientId)` dipanggil setelah fetch per platform; mode headless (tanpa WA JID) — hanya simpan ke DB |
| PD-12: Dynamic import handler engagement | `import()` dinamis di dalam `liveFetchAll` untuk menghindari circular dependency |
| PD-13: Format rekap | Header `*Rekap Tugas Sosmed*`, ✅/❌ per URL, baris `Partisipan: @user...` dari DB; tidak ada pesan "Fetch sukses" terpisah |
| PD-14: Urutan respons DM | Rekap engagement → ack konfirmasi → daftar tugas hari ini (urutan ini mengikuti alur chakranarayana) |

---

## Implementation Artifacts

| Artifact | Path |
|---|---|
| Keputusan penelitian | [`research.md`](./research.md) |
| Data model (8 migrasi) | [`data-model.md`](./data-model.md) |
| Kontrak pesan WA | [`contracts/wa-message-contract.md`](./contracts/wa-message-contract.md) |
| Setup lokal | [`quickstart.md`](./quickstart.md) |
| Rencana implementasi | [`plan.md`](./plan.md) |
| Checklist tugas | [`tasks.md`](./tasks.md) |

# Feature Specification: WhatsApp Gateway — Auto-Response Pesan Komplain

**Feature Branch**: `001-wa-complaint-autoresponse`  
**Created**: 2026-03-25  
**Status**: Ready for Planning  
**Input**: Konsolidasi  menggantikan `001-wa-complaint-task-autoresponse`

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Member Mengajukan Komplain via WhatsApp (Priority: P1)

Seorang anggota/personel Kepolisian (disebut "reporter") mengirimkan pesan komplain terstruktur ke grup WhatsApp CICERO atau langsung sebagai pesan pribadi (DM) ke nomor gateway. Gateway mendeteksi format pesan komplain, melakukan verifikasi data reporter ke basis data CICERO, menganalisis aktivitas sosial media yang bersangkutan, lalu membalas secara otomatis di grup dengan ringkasan hasil triage dan langkah tindak lanjut menggunakan format baku `buildOperatorResponse()`. Secara bersamaan, ringkasan admin dikirim langsung ke pengirim menggunakan `buildAdminSummary()`.

**Why this priority**: Solusi komplain adalah kebutuhan operasional utama. Tanpa respons otomatis, operator harus merespons secara manual satu per satu — menghambat penanganan ratusan komplain harian.

**Independent Test**: Kirim pesan WhatsApp berformat "Pesan Komplain" yang valid ke grup uji (terdaftar di CICERO). Verifikasi bot membalas di grup dalam ≤ 10 detik dengan ringkasan triage, dan pengirim menerima DM ringkasan admin.

**Acceptance Scenarios**:

1. **Given** grup WA klien aktif dan bot terhubung, **When** anggota mengirim pesan dengan header "Pesan Komplain" beserta NRP, nama, polres, username IG/TikTok, dan deskripsi kendala, **Then** bot membalas di grup dalam ≤ 10 detik dengan pesan yang menyertakan status diagnosis, kecocokan username, ringkasan audit, dan langkah tindak lanjut.
2. **Given** reporter mencantumkan NRP yang terdaftar di CICERO, **When** pesan komplain diterima, **Then** bot memverifikasi username IG/TikTok reporter terhadap data CICERO dan melaporkan status kecocokan (cocok / tidak cocok).
3. **Given** reporter mencantumkan NRP yang terdaftar di CICERO, **When** pesan komplain diterima, **Then** bot memeriksa apakah username reporter sudah pernah muncul di data audit like/komentar (Instagram & TikTok) dalam 30 menit terakhir dan sepanjang waktu, dan melaporkan jumlah aktivitas tersebut.
4. **Given** reporter mencantumkan NRP yang tidak terdaftar di CICERO, **When** pesan komplain diterima, **Then** bot membalas dengan instruksi untuk melengkapi data atau mencocokkan NRP dengan data yang terdaftar.
5. **Given** pesan masuk ke grup WA, **When** pesan tersebut tidak mengandung header "Pesan Komplain", **Then** bot tidak membalas (mengabaikan pesan).

---

### User Story 2 — Komplain dengan Profil Sosmed Tidak Aktif (Priority: P2)

Reporter mengajukan komplain dengan username Instagram/TikTok yang kondisi profilnya tidak memenuhi syarat deteksi sistem: akun privat, belum memiliki foto profil, atau belum ada konten yang diupload. Gateway mendeteksi kondisi spesifik ini melalui layanan profil eksternal (RapidAPI) dan memberikan panduan perbaikan yang presisi disertai link langsung ke profil akun reporter.

**Why this priority**: Kasus profil bermasalah mendominasi volume komplain. Respons yang menyertakan link profil langsung dan panduan kondisi spesifik memungkinkan reporter memperbaiki sendiri tanpa eskalasi ke operator.

**Independent Test**: Kirim pesan komplain dengan username akun privat tanpa foto profil dan tanpa konten. Verifikasi bot membalas dengan (1) diagnosis kondisi spesifik yang bermasalah, (2) panduan perbaikan per kondisi, dan (3) link langsung ke profil akun tersebut.

**Acceptance Scenarios**:

1. **Given** reporter mengajukan komplain dengan username IG yang akun-nya bersifat privat, **When** bot memverifikasi profil via RapidAPI, **Then** respons menyertakan notifikasi akun privat terdeteksi dan instruksi mengubah ke akun publik disertai link langsung ke profil (`https://instagram.com/<username>`).
2. **Given** reporter mengajukan komplain dengan username IG yang belum memiliki foto profil, **When** bot memverifikasi profil via RapidAPI, **Then** respons menyertakan notifikasi belum ada foto profil dan instruksi menambahkan foto profil.
3. **Given** reporter mengajukan komplain dengan username IG yang belum memiliki konten (media_count = 0), **When** bot memverifikasi profil, **Then** respons menyertakan notifikasi belum ada konten dan instruksi upload minimal 1 postingan.

   > **Multi-kode**: Kondisi `media_count = 0` memicu **dua kode secara simultan**: `NO_CONTENT` (Scenario 3 — instruksi upload 1 postingan) **dan** `LOW_TRUST` (Scenario 4 — panduan 4 langkah aktivasi). Keduanya dilaporkan bersama dalam satu respons; `NO_CONTENT` menentukan urutan prioritas per triage chain.

4. **Given** reporter mengajukan komplain dengan username IG yang belum memiliki konten sama sekali (`media_count = 0`), **When** bot memverifikasi profil via layanan eksternal, **Then** bot menyertakan panduan 4 langkah aktivasi akun dalam respons grup: (1) Pastikan akun bersifat publik (bukan privat/terkunci), (2) Upload minimal 1 konten/postingan di akun tersebut, (3) Aktifkan dan gunakan akun minimal 7 hari sebelum siklus audit berikutnya, (4) Pastikan username yang digunakan sesuai dengan yang terdaftar di sistem CICERO.
5. **Given** layanan profil eksternal tidak dapat dijangkau saat pemrosesan komplain, **When** triage sedang berjalan, **Then** bot tetap membalas dengan data internal yang tersedia dan menginformasikan bahwa verifikasi eksternal sedang tidak tersedia.

---

### User Story 3 — Perbedaan Username & Konfirmasi Perubahan Data (Priority: P2)

Reporter mengirimkan komplain dengan username IG/TikTok yang berbeda dari yang tercatat di CICERO. Bot mendeteksi ketidakcocokan, membandingkan kedua akun berdasarkan aktivitas dan metrik terkini via RapidAPI, lalu mengajukan konfirmasi ke reporter apakah ingin memperbarui username di sistem. Jika reporter membalas "ya konfirmasi", bot secara otomatis memperbarui data di database CICERO. Jika reporter tercatat sudah pernah berpartisipasi, bot menyarankan komentar ulang.

**Why this priority**: Username mismatch adalah akar penyebab utama gagal-deteksi. Alur konfirmasi interaktif mengurangi intervensi manual operator dan menjaga integritas data DB.

**Independent Test**: Kirim komplain dengan username yang berbeda dari DB. Verifikasi (1) bot mengirim DM konfirmasi berisi perbandingan kedua akun, (2) balas "ya konfirmasi ig" → DB terupdate, (3) bot mengirim konfirmasi perubahan berhasil.

**Acceptance Scenarios**:

1. **Given** username di pesan komplain berbeda dengan username yang tersimpan di tabel `user` CICERO untuk NRP yang sama, **When** triage dijalankan, **Then** bot membandingkan kedua akun via RapidAPI (followers, media_count, is_private) dan menyertakan perbandingan metrik keduanya beserta link profil masing-masing dalam respons grup.
2. **Given** hasil perbandingan menunjukkan salah satu akun lebih relevan (followers + media_count lebih tinggi), **When** respons triage dikirim, **Then** bot mengirim DM terpisah ke reporter berisi saran akun yang lebih relevan dan instruksi: "Balas *ya konfirmasi ig* atau *ya konfirmasi tiktok* untuk memperbarui data."
3. **Given** reporter membalas "ya konfirmasi ig" atau "ya konfirmasi tiktok" dalam 15 menit, **When** bot menerima balasan dalam sesi konfirmasi aktif, **Then** bot memperbarui kolom username yang sesuai di tabel `user` (`UPDATE "user" SET insta/tiktok = $1 WHERE user_id = $2`) dan mengirim konfirmasi "Username berhasil diperbarui ke @[username]".
4. **Given** reporter tidak merespons dalam 15 menit, **When** sesi konfirmasi kadaluarsa, **Then** tidak ada perubahan di DB; reporter dapat mengajukan komplain baru untuk memulai ulang konfirmasi.
5. **Given** audit menunjukkan reporter sudah pernah berpartisipasi (all-time count > 0 di like IG atau komentar TikTok), **When** triage selesai, **Then** respons menyertakan notifikasi bahwa reporter tercatat sudah pernah berpartisipasi dan saran untuk melakukan komentar ulang pada konten terkait.

---

### Edge Cases

- Apa yang terjadi jika pesan komplain tidak memiliki header "Pesan Komplain" tapi berisi NRP? → Diabaikan, tidak ada respons.
- Apa yang terjadi jika pesan komplain diterima dari grup yang tidak terdaftar di CICERO? → Diabaikan, tidak ada respons.
- Apa yang terjadi jika bot menerima dua pesan komplain identik dari pengirim yang sama dalam waktu singkat? → Pesan yang sama tidak menghasilkan respons duplikat (lihat FR-009 dan T028 — dedup berdasarkan message ID, TTL 24 jam, max 10 000 entries LRU).
- Apa yang terjadi jika dua pesan komplain berbeda dikirim oleh pengirim yang sama secara berurutan? → Setiap pesan diproses secara independen (message-independent), tidak ada rate limit per pengirim.
- Apa yang terjadi jika koneksi WhatsApp terputus saat memproses pesan? → Worker outbox berhenti memproses; job yang sudah berada di antrian BullMQ tetap tersimpan di Redis. Saat koneksi pulih dan `attachWorker` dipanggil ulang, worker melanjutkan memproses job yang tertahan — tidak ada komplain terdrop.
- Apa yang terjadi jika komplain dikirim sebagai DM ke nomor gateway? → Bot memproses dan membalas langsung ke pengirim (private reply).
- Apa yang terjadi jika NRP pada komplain kosong atau hanya berisi spasi? → Bot membalas dengan instruksi untuk melengkapi NRP/NIP.
- Apa yang terjadi jika reporter tidak mencantumkan username IG maupun TikTok (keduanya kosong)? → Bot membalas dengan instruksi untuk melengkapi minimal satu username sosmed; triage tidak dijalankan.
- Apa yang terjadi jika reporter hanya mengisi Username IG tanpa TikTok (atau sebaliknya)? → Triage tetap berjalan; verifikasi dan audit hanya dilakukan untuk platform yang diisi.
- Apa yang terjadi jika reporter mengisi field username dengan URL lengkap (mis. `https://instagram.com/johndoe`)? → Parser menormalisasi URL menjadi username bersih `johndoe` sebelum triage dijalankan; reporter tidak mendapat peringatan, proses berjalan transparan.
- Apa yang terjadi jika URL yang diberikan adalah link postingan (mis. `https://instagram.com/p/ABC123/`) bukan link profil? → Hasil normalisasi akan menghasilkan nilai seperti `p` yang bukan username valid; sistem memperlakukan field sebagai tidak diisi dan membalas instruksi melengkapi username profil.
- Apa yang terjadi jika reporter tidak merespons DM konfirmasi perubahan username dalam 15 menit? → Sesi konfirmasi kadaluarsa otomatis; tidak ada perubahan di DB. Reporter dapat mengajukan komplain baru untuk memulai ulang konfirmasi.
- Apa yang terjadi jika reporter membalas "ya konfirmasi" tetapi tidak ada sesi konfirmasi aktif untuk sender tersebut? → Pesan diabaikan; tidak ada perubahan DB dan tidak ada respons bot (hindari loop).
- Apa yang terjadi jika kedua akun (DB dan komplain) tidak ditemukan di RapidAPI saat perbandingan mismatch? → Bot tetap menampilkan kedua username tanpa metrik perbandingan dan tetap mengirim DM konfirmasi dengan data terbatas.
- Apa yang terjadi jika reporter sudah berpartisipasi (audit all-time count > 0) tapi username mismatch? → Kedua kondisi dilaporkan: tampilkan aktivitas all-time dan saran komentar ulang; konfirmasi perubahan username tetap dikirim secara terpisah.
- Apa yang terjadi jika akun sosmed reporter bersifat privat? → Bot mendeteksi kondisi `is_private: true` dan menyertakan instruksi spesifik untuk mengubah ke publik beserta link profil langsung.
- Apa yang terjadi jika akun sosmed reporter belum memiliki foto profil? → Bot mendeteksi `profile_pic_url` kosong/null dan menyertakan instruksi menambahkan foto profil.
- Apa yang terjadi jika akun sosmed reporter belum memiliki konten (media_count = 0)? → Bot mendeteksi kondisi ini dan menyertakan instruksi upload minimal 1 postingan.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sistem HARUS mendeteksi pesan yang mengandung header "Pesan Komplain" (case-insensitive; dekorator format WhatsApp `*...*`, `_..._`, `~...~` HARUS dihapus dari teks sebelum pencocokan) hanya dari **grup klien aktif yang terdaftar di CICERO** atau **pesan pribadi (DM)** yang dikirim langsung ke nomor gateway. Pesan dari grup tidak terdaftar HARUS diabaikan.
- **FR-002**: Sistem HARUS mem-parsing field-field terstruktur dari pesan komplain dengan ketentuan: **Field wajib** — NRP/NIP, minimal 1 username sosmed (Instagram **atau** TikTok), dan deskripsi kendala (section "Kendala"). **Field opsional** — Nama, Polres/Satker, platform kedua (IG atau TikTok yang tidak diisi). Jika salah satu field wajib tidak ditemukan atau kosong, bot HARUS membalas dengan instruksi melengkapi field yang kurang dan tidak melanjutkan ke triage.

  **Normalisasi username**: Setelah parsing, sistem HARUS menormalisasi nilai field username dengan aturan berikut:
  - **Strip marker format WhatsApp terlebih dahulu**: hapus karakter `*`, `_`, `~` yang mengapit nilai (mis. `*johndoe*` → `johndoe`, `_johndoe_` → `johndoe`). Langkah ini diterapkan **sebelum** semua normalisasi lainnya.
  - Jika nilai mengandung domain `instagram.com` (mis. `https://instagram.com/johndoe`, `instagram.com/johndoe`, `www.instagram.com/johndoe/`) → ekstrak segmen path pertama setelah domain sebagai username.
  - Jika nilai mengandung domain `tiktok.com` (mis. `https://tiktok.com/@johndoe`, `https://vm.tiktok.com/@johndoe`) → ekstrak segmen path pertama, hapus karakter `@` di awal.
  - Jika nilai diawali `@` (mis. `@johndoe`) → hapus karakter `@`.
  - Hapus trailing slash, query string (`?...`), dan fragment (`#...`) dari hasil ekstraksi.
  - Jika hasil segmen path adalah salah satu dari segmen jalur sistem yang diketahui (`p`, `reel`, `tv`, `stories`, `explore`, `highlights`, `accounts`) → nilai dianggap bukan username profil dan diperlakukan sebagai field tidak diisi.
  - Jika setelah normalisasi nilai kosong, terlalu pendek (< 3 karakter), atau mengandung karakter ilegal (spasi, karakter selain `[a-zA-Z0-9._]`) → perlakukan sebagai field tidak diisi.
  - Normalisasi diterapkan **sebelum** lookup DB, verifikasi RapidAPI, dan perbandingan mismatch.
- **FR-003**: Sistem HARUS mengecek keberadaan NRP/NIP reporter di basis data CICERO menggunakan kolom `user_id` pada tabel `user` (`WHERE user_id = $1`) — kolom yang sama berlaku untuk NRP anggota Polri maupun NIP ASN. Sistem juga HARUS mencocokkan username IG/TikTok yang dilaporkan dengan data yang tersimpan di kolom `insta` (Instagram) dan `tiktok` (TikTok) pada tabel `user`.
- **FR-004**: Sistem HARUS menghitung jumlah aktivitas audit reporter (like Instagram, komentar TikTok) dalam jendela waktu 30 menit terakhir maupun sepanjang waktu (all-time).
- **FR-005**: Sistem HARUS mencoba memverifikasi profil akun sosmed reporter melalui layanan profil eksternal (RapidAPI) jika username tersedia. Verifikasi HARUS memeriksa dan melaporkan kondisi berikut secara spesifik:
  - **Privat/Publik** (`is_private`): Jika akun privat → sertakan instruksi ganti ke publik + link profil langsung (`https://instagram.com/<username>` atau `https://tiktok.com/@<username>`).
  - **Foto profil** (`profile_pic_url`): Jika kosong/null → sertakan instruksi menambahkan foto profil.
  - **Konten** (`media_count`): Jika 0 → sertakan instruksi upload minimal 1 postingan.
  - **Aktivitas rendah** (`media_count = 0`) → set triage code `LOW_TRUST`, sertakan panduan 4 langkah aktivasi: (1) Set akun ke publik, (2) Upload minimal 1 postingan, (3) Gunakan akun minimal 7 hari sebelum siklus audit, (4) Pastikan username sesuai data di CICERO.
  - Setiap kondisi bermasalah yang terdeteksi HARUS melampirkan **link langsung ke profil** akun reporter.
  - Jika RapidAPI tidak tersedia → bot tetap merespons dengan data internal saja (`EXTERNAL_NA`).
- **FR-006**: Sistem HARUS mengirimkan pesan respons triage ke **grup** WhatsApp tempat pesan komplain dikirim (atau langsung ke pengirim jika via DM), menggunakan format baku fungsi `buildOperatorResponse()` dari `complaintResponseTemplates.js`, mencakup: status diagnosis, kecocokan username, ringkasan audit, dan langkah tindak lanjut.
- **FR-007**: Sistem HARUS mengirimkan ringkasan admin secara terpisah langsung ke **pengirim** pesan komplain (private message) menggunakan format baku fungsi `buildAdminSummary()` dari `complaintResponseTemplates.js`. **Pengecualian**: Jika komplain dikirim via DM (`chatId === senderJid`), admin summary HARUS diabaikan — FR-006 sudah mengirim respons triage langsung ke pengirim sehingga mengirim lagi via FR-007 akan menghasilkan pesan duplikat ke JID yang sama.
- **FR-008**: Sistem HARUS mengabaikan pesan komplain yang dikirim oleh **ID gateway itu sendiri** (JID nomor gateway — bukan semua admin; cakupan hanya self-loop prevention).
- **FR-009**: Sistem HARUS mendeduplikasi pesan komplain menggunakan **TTL-bounded Map** in-memory: setiap entry menyimpan `{ messageId → timestampPertamaKaliDiproses }`. Entry dianggap kadaluarsa setelah **24 jam**; map HARUS membersihkan entry kadaluarsa saat lookup. Ukuran maksimum map adalah **10.000 entries**; jika batas tercapai, entry terlama (LRU) dieviksi terlebih dahulu. Memproses ulang message ID yang sama (dalam jendela 24 jam) tidak menghasilkan duplikasi respons. Cakupan dedup direset saat gateway restart (bukan saat reconnect biasa — job BullMQ yang tertahan tetap aman karena mekanisme retain FR-010). *(Penggunaan plain `Set` tanpa TTL/eviksi dilarang — melanggar Constitution VII.)*
- **FR-010**: Semua respons keluar HARUS diantrekan melalui sistem antrian pesan (BullMQ outbox) untuk mencegah pelanggaran batas pengiriman WhatsApp. Saat koneksi WhatsApp terputus, outbox worker HARUS berhenti memproses job namun job tetap tersimpan di Redis. Saat `attachWorker` dipanggil ulang setelah reconnect, worker HARUS melanjutkan job yang tertahan tanpa duplikasi.
- **FR-011**: Sistem HARUS menandai pesan masuk sebagai "sudah dibaca" (seen) sebelum mulai memproses, dengan jeda 1 detik.
- **FR-012**: Pesan STATUS WhatsApp (`status@broadcast`) HARUS selalu diabaikan dan tidak diproses.
- **FR-013**: Saat triage mendeteksi `USERNAME_MISMATCH` (username di pesan komplain ≠ username di tabel `user` CICERO untuk NRP tersebut), sistem HARUS membandingkan kedua akun via RapidAPI menggunakan metrik: `followers_count`, `media_count`, dan `is_private`. Akun dengan kombinasi `followers_count + media_count` lebih tinggi dan status publik dianggap lebih relevan. Hasil perbandingan (metrik keduanya + link profil masing-masing) HARUS disertakan dalam respons triage grup.
- **FR-014**: Setelah mengirim respons triage `USERNAME_MISMATCH`, sistem HARUS mengirim DM terpisah ke reporter berisi: username saat ini di CICERO, username di pesan komplain, ringkasan metrik perbandingan, saran akun yang lebih relevan, dan instruksi: "Balas *ya konfirmasi ig* untuk Instagram atau *ya konfirmasi tiktok* untuk TikTok jika ingin memperbarui data." Sesi konfirmasi HARUS disimpan in-memory menggunakan **format kunci `` `${senderJid}:${platform}` `` (karakter colon sebagai separator wajib)** dengan waktu expired 15 menit. Jika sesi sudah ada untuk key yang sama, sesi lama HARUS **ditimpa** (data dan TTL diperbarui dari pembuatan baru).
- **FR-015**: Saat bot menerima **pesan pribadi (DM)** — bukan dari grup — dari sender yang memiliki sesi konfirmasi aktif dan pesan berisi frasa `ya konfirmasi ig` atau `ya konfirmasi tiktok` (case-insensitive), sistem HARUS: (1) memperbarui kolom `insta` atau `tiktok` di tabel `user` menggunakan parameterized query `UPDATE "user" SET insta = $1 WHERE user_id = $2` (atau kolom `tiktok` equivalen), (2) mengirim konfirmasi keberhasilan ke reporter **melalui `enqueueSend`** (BullMQ outbox — Constitution VII), (3) menghapus sesi konfirmasi dari memori. Sistem HARUS mengabaikan frasa konfirmasi yang datang dari pesan grup. Jika tidak ada sesi aktif untuk sender tersebut, pesan HARUS diabaikan tanpa respons.
- **FR-016**: Jika triage menunjukkan reporter sudah pernah berpartisipasi (all-time count di like Instagram atau komentar TikTok > 0), sistem HARUS menyertakan dalam respons grup status `ALREADY_PARTICIPATED` beserta saran eksplisit untuk melakukan komentar ulang. Referensi konten: ambil URL postingan terbaru dari tabel `insta_post` atau `tiktok_post` berdasarkan **`client_id` klien aktif** (kolom `shortcode` di `insta_post` / `video_id` di `tiktok_post`, query: `WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`) berdasarkan platform yang relevan. Jika tidak ada postingan tersedia, sertakan instruksi generik: *"Silakan komentar ulang di postingan kampanye terbaru."*

### Key Entities

- **Pesan Komplain**: Pesan terstruktur berisi header "Pesan Komplain", identitas reporter (NRP/NIP, nama, polres, username sosmed), dan deskripsi kendala.
- **Reporter**: Anggota/personel yang mengajukan komplain; diidentifikasi dengan kolom `user_id` di tabel `user` CICERO — berlaku untuk NRP (anggota Polri) maupun NIP (ASN).
- **Hasil Triage**: Hasil analisis otomatis: status diagnosis, bukti audit internal, hasil verifikasi eksternal (termasuk: privacy status, foto profil, media_count, link profil langsung), rekomendasi tindak lanjut.
- **Grup Klien**: Grup WhatsApp yang terdaftar sebagai `client_group` pada data klien aktif di CICERO.
- **PendingConfirmation**: Sesi konfirmasi perubahan username in-memory, keyed by `` `${senderJid}:${platform}` `` (karakter colon sebagai separator wajib). Fields: `{senderJid, platform, oldUsername, newUsername, nrp, expiresAt}`. Expired otomatis setelah 15 menit dari pembuatan; maksimal satu sesi aktif per `senderJid + platform`.

### Triage Status Codes

| Code | Kondisi | Tindak Lanjut |
|------|---------|---------------|
| `NRP_NOT_FOUND` | NRP tidak terdaftar di CICERO | Instruksi lengkapi data/NRP |
| `USERNAME_MISMATCH` | Username tidak cocok dengan DB | Perbandingan akun + kirim DM konfirmasi (FR-013, FR-014) |
| `NO_ACTIVITY` | Tidak ada aktivitas audit | Instruksi mulai aktivitas |
| `ALREADY_PARTICIPATED` | Sudah pernah berpartisipasi (all-time > 0) | Saran komentar ulang (FR-016) |
| `LOW_TRUST` | Profil sosmed tidak aktif/rendah metrik | Panduan 4-langkah aktivasi akun (FR-005) |
| `ACCOUNT_PRIVATE` | Akun terprivat | Instruksi ganti ke publik + link profil |
| `NO_PROFILE_PHOTO` | Belum ada foto profil | Instruksi tambah foto profil |
| `NO_CONTENT` | Belum ada konten (media_count = 0) | Instruksi upload postingan |
| `OK` | Semua normal, sudah beraktivitas | Konfirmasi data sesuai |
| `EXTERNAL_NA` | RapidAPI tidak tersedia | Respons dengan data internal saja |

> **Prioritas & multi-kondisi**: Satu pesan komplain dapat memicu lebih dari satu kondisi bermasalah. Urutan prioritas evaluasi (pertama sampai terakhir): `NRP_NOT_FOUND` → `USERNAME_MISMATCH` → `ACCOUNT_PRIVATE` → `NO_PROFILE_PHOTO` → `NO_CONTENT` → `LOW_TRUST` → `ALREADY_PARTICIPATED` → `NO_ACTIVITY` → `OK`. `EXTERNAL_NA` bersifat additive — ditambahkan sebagai flag pelengkap di samping kode utama jika RapidAPI tidak tersedia. Semua kondisi bermasalah yang terdeteksi HARUS dilaporkan dalam respons (multi-kondisi diperbolehkan). Kode prioritas tertinggi menentukan *primary status* di header ringkasan triage.

---

## Success Criteria *(mandatory)*

- **SC-001**: Bot merespons pesan komplain yang valid dalam ≤ 10 detik setelah pesan diterima di grup atau DM. Semua panggilan ke RapidAPI HARUS dibatasi dengan timeout yang dikonfigurasi via env var `RAPIDAPI_TIMEOUT_MS` (default: 5 000 ms) untuk menjamin batas ini terpenuhi bahkan pada jalur dual-fetch FR-013.
- **SC-002**: 100% pesan komplain dengan format lengkap (NRP + username + kendala) menghasilkan respons triage memuat status diagnosis, kecocokan username, dan langkah tindak lanjut.
- **SC-003**: 0% pesan non-komplain direspons secara keliru dari jalur complaint handler (false positive khusus fitur ini).
- **SC-004**: Bot tetap beroperasi penuh dan memproses semua pesan komplain bahkan setelah WhatsApp client reconnect — job yang tertahan di Redis dilanjutkan saat `attachWorker` dipanggil ulang; tidak ada pesan terdrop.
- **SC-005**: Lebih dari 95% operator melaporkan respons bot relevan dan dapat langsung ditindaklanjuti.
  *(Catatan: mekanisme pengukuran — definisi kueri tabel `admin_notes` dan cara pencatatan kepuasan operator — bukan cakupan fitur ini; dideferral ke task observabilitas terpisah (belum dijadwalkan dalam branch ini).)*

---

## Assumptions

- Format pesan komplain mengikuti template baku: header "Pesan Komplain", diikuti field NRP/NIP, Nama, Polres/Satker, Username IG, Username TikTok, dan seksi "Kendala".
- Data anggota (NRP, username IG/TikTok) sudah tersedia dan diperbarui secara berkala di tabel `user` CICERO sebelum komplain diajukan.
- Data audit engagement (like IG, komentar TikTok) sudah di-populate secara berkala oleh proses terpisah dan tersedia di basis data CICERO untuk keperluan FR-004.
- Verifikasi profil sosmed eksternal dilakukan melalui RapidAPI; jika layanan tidak tersedia, bot tetap merespons dengan data internal saja.
- Satu WhatsApp client (gateway) menangani seluruh grup terdaftar.
- Jendela waktu audit standar adalah 30 menit ke belakang dari waktu pesan diterima.
- Sesi konfirmasi perubahan username disimpan in-memory dan expired setelah 15 menit; tidak bersifat persisten lintas restart.
- Kolom username sosmed di tabel `user`: `insta` untuk Instagram, `tiktok` untuk TikTok. Primary key tabel `user` adalah `user_id` (digunakan untuk menyimpan baik NRP Polri maupun NIP ASN).
- Link profil publik akun sosmed: `https://instagram.com/<username>` untuk IG; `https://tiktok.com/@<username>` untuk TikTok.
- Reporter dapat mengisi field username dengan URL penuh (mis. `https://instagram.com/johndoe`) atau dengan prefix `@`; parser akan menormalisasi ke username bersih sebelum diproses.

## Clarifications

### Session 2026-03-25 (dipecah dari 001)

- Scope pengirim komplain: grup klien terdaftar + DM langsung ke gateway (bukan semua grup).
- Format respons: kunci ke `buildOperatorResponse()` / `buildAdminSummary()` di `complaintResponseTemplates.js`.
- Rate limiting: tidak ada — semua komplain valid diproses; deduplikasi hanya pada message ID yang sama.
- SC-005 diukur via monitor eskalasi tabel `admin_notes` setiap 14 hari.
- Q: Isi panduan aktivasi akun untuk status LOW_TRUST → A: 4 langkah standar: (1) Set akun ke publik, (2) Upload minimal 1 postingan, (3) Gunakan akun min. 7 hari sebelum siklus audit, (4) Pastikan username sesuai data CICERO.
- Q: Field wajib untuk memproses komplain → A: NRP/NIP + minimal 1 username sosmed (IG atau TikTok) + Kendala; Nama dan Polres/Satker opsional.
- Q: Perilaku BullMQ job saat koneksi WA terputus → A: Retain — worker berhenti, job tetap di Redis; saat reconnect `attachWorker` dipanggil ulang dan worker resume tanpa duplikasi.
- Q: Kolom DB untuk lookup NRP/NIP → A: Primary key `user_id` di tabel `user`; berlaku untuk Polri (NRP) dan ASN (NIP); query `WHERE user_id = $1`. Kolom username: `insta` (Instagram), `tiktok` (TikTok).
- Q: Jangkauan deduplikasi message ID (FR-009) → A: TTL-bounded Map in-memory (24 jam TTL, max 10.000 entries LRU); direset saat proses restart; reconnect biasa tidak mereset dedup karena BullMQ retain sudah menjaga job. Plain `Set` tanpa TTL dilarang oleh Constitution VII.
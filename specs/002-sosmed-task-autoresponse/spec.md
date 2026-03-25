# Feature Specification: WhatsApp Gateway — Auto-Response Fetch Tugas Sosmed

**Feature Branch**: `002-sosmed-task-autoresponse`  
**Created**: 2026-03-25  
**Status**: Ready for Planning  
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
- Apa yang terjadi jika pesan broadcast diterima dari DM? → Diabaikan, tidak ada respons (fitur ini hanya untuk grup klien).
- Apa yang terjadi jika grup tidak terdaftar di CICERO? → Diabaikan, tidak ada respons.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sistem HARUS mendeteksi pesan broadcast tugas sosmed berdasarkan kombinasi kata kunci: salam waktu (pagi/siang/sore/malam), frasa "mohon izin dibantu", dan setidaknya satu kata aksi (like, comment, share, follow, subscribe, repost).
- **FR-002**: Sistem HARUS memproses broadcast tugas **hanya** dari grup WhatsApp yang terdaftar sebagai grup klien aktif di CICERO. Pesan DM dan pesan dari grup tidak terdaftar HARUS diabaikan.
- **FR-003**: Sistem HARUS mengekstrak semua URL Instagram dan TikTok dari pesan broadcast.
- **FR-004**: Sistem HARUS membedakan URL Instagram (mengandung `instagram.com` atau shortcode `ig.me`) dari URL TikTok (mengandung `tiktok.com` atau `vm.tiktok.com`).
- **FR-005**: Sistem HARUS melakukan **live fetch ke API Instagram/TikTok** pada saat broadcast diterima untuk setiap URL yang teridentifikasi, sehingga rekapitulasi mencerminkan data paling mutakhir.
- **FR-006**: Sistem HARUS membalas dengan pesan yang mencantumkan: ack deteksi broadcast, nama hari/tanggal saat ini, jumlah engagement per konten, dan daftar username yang sudah berpartisipasi.
- **FR-007**: Sistem HARUS mengabaikan URL yang bukan dari platform Instagram atau TikTok.
- **FR-008**: Semua respons keluar HARUS diantrekan melalui sistem antrian pesan (BullMQ outbox) untuk mencegah pelanggaran batas pengiriman WhatsApp.
- **FR-009**: Sistem HARUS menandai pesan masuk sebagai "sudah dibaca" (seen) sebelum mulai memproses, dengan jeda 1 detik.
- **FR-010**: Pesan STATUS WhatsApp (`status@broadcast`) HARUS selalu diabaikan dan tidak diproses.

### Key Entities

- **Broadcast Tugas Sosmed**: Pesan operator ke grup WA berisi instruksi aksi sosmed (like, comment, share) pada konten tertentu, disertai URL konten.
- **Data Engagement**: Hasil live fetch dari API IG/TikTok — jumlah like/komentar dan daftar username partisipan per konten.
- **Grup Klien**: Grup WhatsApp yang terdaftar sebagai `client_group` pada data klien aktif di CICERO; hanya grup ini yang dilayani.

---

## Success Criteria *(mandatory)*

- **SC-001**: Bot merespons broadcast tugas sosmed dalam ≤ 15 detik setelah pesan diterima, mencakup data engagement terbaru hasil live fetch.
- **SC-002**: 0% pesan non-broadcast direspons secara keliru dari jalur sosmed task handler (false positive khusus fitur ini).
- **SC-003**: Bot tetap beroperasi penuh dan memproses semua pesan broadcast bahkan setelah WhatsApp client reconnect — tidak ada pesan terdrop.

---

## Assumptions

- Grup klien aktif sudah terdaftar di kolom `client_group` tabel `clients` sebelum broadcast tugas mulai dikirim ke grup tersebut.
- Live fetch ke API IG/TikTok dilakukan via layanan yang sudah ada (`instaFetchPost.js` / `tiktokFetchPost.js`); jika fetch gagal, bot membalas dengan notifikasi data tidak tersedia.
- Resolusi klien target dari group JID dilakukan secara dinamis via `findClientsByGroup(chatId)` — tidak ada client ID yang di-hardcode.
- Satu WhatsApp client (gateway) menangani seluruh grup terdaftar.
- BullMQ outbox worker (`attachWorker`) sudah terhubung saat gateway startup (prasyarat dari feature 002 atau diselesaikan dalam feature ini sebagai foundational task).

## Clarifications

### Session 2026-03-25 (dipecah dari 001)

- Sumber data engagement: live fetch ke API IG/TikTok saat broadcast diterima (bukan DB snapshot).
- Scope grup: hanya grup klien terdaftar; DM diabaikan.
- Multi-message reply: bot mengirim ≥ 3 pesan sequential (ack + status summary + task recap) — tidak harus satu pesan tunggal.

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]  
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Key Entities *(include if feature involves data)*

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]

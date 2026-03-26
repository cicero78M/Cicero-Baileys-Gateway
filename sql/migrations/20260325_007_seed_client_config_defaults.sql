-- Migration: 20260325_007_seed_client_config_defaults.sql
-- Purpose: Seed 13 DEFAULT rows into client_config.
--          These are read at runtime via getConfig('DEFAULT', key).
-- Idempotent: ON CONFLICT DO NOTHING
-- Depends on: 20260325_001 (DEFAULT sentinel), 20260325_002 (client_config table)

INSERT INTO client_config (client_id, config_key, config_value, description) VALUES
  ('DEFAULT', 'broadcast_trigger_keywords',
   'pagi,siang,sore,malam',
   'Kata salam waktu pemicu deteksi broadcast'),

  ('DEFAULT', 'broadcast_action_keywords',
   'like,comment,share,follow,subscribe,repost',
   'Kata aksi sosmed wajib dalam broadcast'),

  ('DEFAULT', 'broadcast_required_phrase',
   'mohon izin dibantu',
   'Frasa wajib dalam setiap broadcast tugas'),

  ('DEFAULT', 'operator_unregistered_prompt',
   'Anda mengirim pesan tugas untuk dieksekusi, tapi database kami belum membaca Satker Asal anda. Apakah anda ingin mendaftarkan nomor anda sebagai operator tugas? (ya/tidak)',
   'Pesan konfirmasi ke nomor belum terdaftar'),

  ('DEFAULT', 'operator_satker_list_header',
   'Pilih Satker Anda dengan membalas nomor urut:',
   'Header daftar pilihan satker'),

  ('DEFAULT', 'operator_registration_ack',
   'Nomor Anda berhasil terdaftar sebagai operator untuk {satker_name}. Anda dapat mengirim pesan tugas kembali.',
   'Konfirmasi registrasi berhasil'),

  ('DEFAULT', 'operator_registration_declined',
   'Baik, pendaftaran dibatalkan.',
   'Pesan saat operator menolak registrasi'),

  ('DEFAULT', 'operator_invalid_choice',
   'Pilihan tidak valid. Silakan balas dengan nomor urut.',
   'Pesan saat pilihan satker tidak valid'),

  ('DEFAULT', 'operator_no_satker',
   'Tidak ada Satker aktif. Hubungi administrator.',
   'Pesan saat tidak ada satker aktif tersedia'),

  ('DEFAULT', 'operator_session_ttl_seconds',
   '300',
   'TTL sesi registrasi dalam detik'),

  ('DEFAULT', 'operator_registration_max_attempts',
   '5',
   'Maks percobaan sesi registrasi sebelum bot diam'),

  ('DEFAULT', 'operator_registration_cooldown_minutes',
   '60',
   'Window cooldown untuk menghitung attempt_count (menit)'),

  ('DEFAULT', 'task_input_ack',
   'Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.',
   'Ack tugas berhasil direkam')

ON CONFLICT (client_id, config_key) DO NOTHING;

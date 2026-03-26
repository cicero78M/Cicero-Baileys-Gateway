-- Migration 009: Add operator broadcast rate limit and no-valid-URL config defaults
INSERT INTO client_config (client_id, config_key, config_value, description)
VALUES
  ('DEFAULT', 'operator_broadcast_rate_limit', '20',
   'Maks jumlah broadcast per operator terdaftar per jam (window 60 menit bergulir)'),
  ('DEFAULT', 'operator_no_valid_url',
   'Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda.',
   'Pesan error saat broadcast operator terdaftar tidak mengandung URL IG/TikTok valid')
ON CONFLICT (client_id, config_key) DO NOTHING;

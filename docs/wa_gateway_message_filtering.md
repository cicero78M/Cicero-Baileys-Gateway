# WA Gateway Message Filtering Update

## Ringkasan

Modul handler pesan WA pada `src/service/waService.js` diperbarui agar **hanya merespons**:

1. Pesan dengan format **request bulk deletion**.
2. Pesan **komplain** yang valid sesuai parser komplain.

Pesan lain yang tidak relevan sekarang dianggap sebagai pesan biasa dan **diabaikan tanpa balasan** dari server.

## Detail Perubahan

- Pada alur `createHandleMessage()` (non-gateway user flow), fallback respons teks:
  - Sebelumnya: mengirim pesan *"Perintah lama tidak didukung..."*.
  - Sekarang: tidak mengirim balasan, hanya log internal bahwa pesan diabaikan.

- Pada alur `handleGatewayMessage()` (gateway flow), fallback respons teks:
  - Sebelumnya: mengirim pesan *"Perintah lama tidak didukung..."*.
  - Sekarang: tidak mengirim balasan, hanya log internal bahwa pesan diabaikan.

## Dampak

- Mengurangi noise balasan dari bot untuk pesan yang bukan format komplain/bulk deletion.
- Perilaku bot menjadi lebih ketat terhadap format pesan yang didukung.

## Catatan Operasional

- Tidak ada perubahan kontrak untuk alur komplain dan bulk deletion.
- Monitoring bisa dilakukan lewat log:
  - `Ignored non-relevant private message ...`
  - `Ignored non-relevant message ...`

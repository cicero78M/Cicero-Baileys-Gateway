# WhatsApp Message Reception Troubleshooting Guide

## Problem

The WhatsApp bot cannot read chat messages or receive messages, causing all menu request methods via wabot to fail.

## Common Causes

### 1. WA_SERVICE_SKIP_INIT Environment Variable

**Symptom**: Bot does not respond to any messages whatsoever.

**Cause**: The `WA_SERVICE_SKIP_INIT` environment variable is set to `"true"`.

**Impact**: When this variable is `"true"`:
- Message event listeners are NOT attached to WhatsApp clients
- Clients are NOT initialized
- No messages can be received
- Bot is completely non-functional for message handling

**Fail-fast behavior**:
- If `WA_SERVICE_SKIP_INIT="true"` **and** the environment is expected to receive messages, the service will **refuse to start**.
- An environment is considered "expected to receive messages" when:
  - `NODE_ENV` is **not** `"test"`, **or**
  - `WA_EXPECT_MESSAGES="true"` is explicitly set.
- Startup logs will state that listeners are not attached and the bot will not receive chats.

**Solution**:
```bash
# Check if the variable is set
echo $WA_SERVICE_SKIP_INIT

# If it shows "true", unset it or set to "false"
unset WA_SERVICE_SKIP_INIT
# OR
export WA_SERVICE_SKIP_INIT="false"

# Then restart the application
npm restart
```

**Note**: This variable should ONLY be set to `"true"` during automated testing. NEVER in production or any environment that should receive chats. If you must run with it in a non-test environment (e.g., maintenance), ensure `WA_EXPECT_MESSAGES` is **unset** or `"false"` and understand the service will remain offline for chat handling.

### 2. Client Not Ready

**Symptom**: Users receive "🤖 Bot sedang memuat, silakan tunggu" (Bot is loading, please wait) message.

**Cause**: WhatsApp client has not completed initialization or has disconnected.

**Check logs for**:
- `[WA] READY via ready` - Client is ready
- `[WA] Client not ready, message from X deferred` - Client not ready
- `[WA] Client disconnected` - Client lost connection

**Solution**:
1. Check if Chrome/Chromium is properly installed
2. Check if WhatsApp session is authenticated (QR code scan needed)
3. Check for authentication failures in logs
4. Restart the application to trigger re-initialization

**Fail-fast in production/expected-message environments**:
- Setelah proses init selesai, service akan mengecek fatal init error dan readiness semua client.
- Jika `WA_EXPECT_MESSAGES="true"` **atau** `NODE_ENV=production`, service **akan throw error** agar proses restart otomatis dan masalah terlihat.
- Skenario yang memicu fail-fast:
  - Missing Chrome (`missing-chrome`)
  - Auth failure (sesi WA gagal/invalid)
  - Awaiting QR scan (belum scan QR)
- Log akan memberi langkah perbaikan singkat, misalnya set `WA_PUPPETEER_EXECUTABLE_PATH` atau scan QR ulang.

### 3. Message Event Listeners Not Attached

**Symptom**: No log messages showing message reception despite WhatsApp being connected.

**Health check**: Use the WA health endpoint to confirm listener counts and skip-init state:
```bash
curl -s http://localhost:<PORT>/wa-health | jq
```

Expected fields in the response:
- `shouldInitWhatsAppClients`: `true` means WA clients should be initialized (skip-init is off).
- `clients[].messageListenerCount`: must be **> 0** for message reception.
- `clients[].readyListenerCount`: should be **> 0** when ready listeners are attached.

**Diagnostic**: Run the diagnostic checker:
```javascript
// In your startup logs, look for:
[WA] Attaching message event listeners to WhatsApp clients...
[WA] Message event listeners attached successfully.
[WA DIAGNOSTICS] ✓ waClient has 1 'message' listener(s)
[WA DIAGNOSTICS] ✓ waUserClient has 1 'message' listener(s)
[WA DIAGNOSTICS] ✓ waGatewayClient has 1 'message' listener(s)
```

**If listeners are missing**:
- Check `WA_SERVICE_SKIP_INIT` setting
- Check for errors during service initialization
- Review startup logs for exceptions

## Message Flow Debugging

To enable verbose debug logging for message flow troubleshooting, set:
```bash
export WA_DEBUG_LOGGING="true"
```

When enabled and a message is sent to the bot, you'll see these logs in sequence:

```
1. [WWEBJS-ADAPTER] Raw message received for clientId=wa-admin, from=628xxx@c.us
2. [WWEBJS-ADAPTER] Emitting 'message' event for clientId=wa-admin
3. [WA-EVENT-AGGREGATOR] Message received from adapter: wwebjs, jid: 628xxx@c.us
4. [WA-EVENT-AGGREGATOR] Processing wwebjs message: 628xxx@c.us:MESSAGE_ID
5. [WA] Incoming message from 628xxx@c.us: test message
```

**If you see**:
- Only log 1: Event emission is failing
- Only logs 1-2: Event aggregator is not receiving
- Only logs 1-3: Message handler is not being invoked
- Only logs 1-4: Message processing logic has an error
- All logs: Message is being processed normally

## Testing

### Quick Test
```bash
# Run the setup test script
node scripts/test-wa-setup.js

# Test with skip init enabled (should show "Should initialize clients: false")
WA_SERVICE_SKIP_INIT=true node scripts/test-wa-setup.js
```

### Full Integration Test
1. Start the application
2. Send a message to the WhatsApp bot
3. Check logs for the message flow sequence above
4. If any step is missing, identify the breaking point

## Prevention

### Release Checklist (before deploy)

- [ ] Confirm `WA_SERVICE_SKIP_INIT` is **unset** or `"false"` in production config.
- [ ] Validate the resolved runtime env (example):
  ```bash
  rg "WA_SERVICE_SKIP_INIT" .env .env.* ecosystem.config.js || true
  pm2 show cicero_v2 | rg WA_SERVICE_SKIP_INIT -n
  ```
- [ ] If `NODE_ENV=production` and `WA_SERVICE_SKIP_INIT="true"`, the service will exit on startup.

## Operational Runbook: WA_SERVICE_SKIP_INIT Production Guard

Use this checklist any time message reception drops to zero or before/after a deployment.

### 1) Audit all environment sources (must be unset or "false")

Check every place the environment could be injected:

- **.env / env files**
  - Verify `WA_SERVICE_SKIP_INIT` is **unset** or set to `"false"`.
  - Example:
    ```bash
    rg "WA_SERVICE_SKIP_INIT" .env .env.* || true
    ```
- **PM2 (ecosystem config)**
  - Ensure `env`/`env_production` explicitly set `WA_SERVICE_SKIP_INIT="false"`.
  - Example:
    ```bash
    rg "WA_SERVICE_SKIP_INIT" ecosystem.config.js
    pm2 show cicero_v2 | rg WA_SERVICE_SKIP_INIT -n
    ```
- **systemd**
  - Check unit files and drop-in overrides (`Environment=` / `EnvironmentFile=`).
  - Example:
    ```bash
    systemctl cat cicero_v2.service | rg WA_SERVICE_SKIP_INIT -n
    ```
- **Docker / Docker Compose / K8s**
  - Verify secrets/configmaps/env vars do **not** set it to `"true"`.
  - Example:
    ```bash
    rg "WA_SERVICE_SKIP_INIT" docker-compose*.yml k8s/*.y*ml || true
    kubectl describe deploy <deployment> | rg WA_SERVICE_SKIP_INIT -n
    ```

### 2) Enforce a production default (guard)

Ensure the deployment config forces the default to `"false"` in production (e.g., PM2).

### 3) Restart service and verify startup logs

After any environment change, restart the service and confirm the listeners attach:

```bash
pm2 restart cicero_v2 --env production
pm2 logs cicero_v2 --lines 200 | rg "Attaching message event listeners|listener"
```

Expected logs:
```
[WA] Attaching message event listeners to WhatsApp clients...
[WA DIAGNOSTICS] ✓ waClient has 1 'message' listener(s)
[WA DIAGNOSTICS] ✓ waUserClient has 1 'message' listener(s)
[WA DIAGNOSTICS] ✓ waGatewayClient has 1 'message' listener(s)
```

Listener counts must be **> 0**.

### 4) Record the incident and remediation

Log the change, including which env source was corrected, the restart time, and the
verification log snippet.

### In .env file
```bash
# WhatsApp Service Configuration
# WA_SERVICE_SKIP_INIT=false
# WARNING: Setting WA_SERVICE_SKIP_INIT=true will disable WhatsApp message reception
# This should ONLY be used during testing, NEVER in production
# When set to true, the bot will NOT receive any messages
```

### In CI/CD
- Ensure test environments set `WA_SERVICE_SKIP_INIT=true`
- Ensure production environments do NOT set this variable or set it to `false`
- Add health checks to verify message listeners are attached

### Monitoring
Monitor these metrics:
- Number of messages received per hour (should be > 0 in active systems)
- Client ready/not ready state transitions
- Authentication failures
- Connection drops

If message reception drops to zero unexpectedly, check the causes above.

## Related Files

- `src/service/waService.js` - Main WhatsApp service, message handlers
- `src/service/wwebjsAdapter.js` - WhatsApp Web.js client wrapper
- `src/service/waEventAggregator.js` - Message deduplication
- `src/utils/waDiagnostics.js` - Diagnostic utilities
- `.env.example` - Environment variable documentation

## Support

If the issue persists after checking all the above:
1. Collect full startup logs
2. Enable debug logging if available
3. Check WhatsApp Web.js library version compatibility
4. Verify Chrome/Chromium installation
5. Check for filesystem permission issues (session data directory)

## Kasus Khusus: `waitForClientReady timeout after 60000ms`

Gejala yang Anda kirimkan:
- `awaitingQrScan=false` tetapi `ready` tidak pernah tercapai dalam 60 detik.
- Error muncul dari helper `waitForClientReady(...)` di `waService`.

### Ringkasan Temuan Komunitas (Internet)

Kasus ini sering dibahas di komunitas `whatsapp-web.js`, terutama:
- GitHub Issues resmi `pedroslopez/whatsapp-web.js` (contoh: #5768, #5792, #3830, #3732, #5758).
- Banyak laporan menyatakan sesi sudah `authenticated`, tetapi event `ready` tidak muncul saat versi WhatsApp Web berubah atau saat ada mismatch web cache/version.

Pola solusi yang paling sering berhasil di thread-thread tersebut:
1. **Upgrade whatsapp-web.js ke rilis terbaru** saat ada regressi `ready` event.
2. **Pastikan sinkronisasi versi WA Web** (gunakan cache URL yang valid atau pin `webVersion` saat endpoint cache bermasalah).
3. **Validasi profil browser + executable Chrome/Chromium** (permission/path benar, tidak ada lock profile zombie).
4. **Reset session secara terukur** ketika state auth korup (hapus `session-<clientId>` hanya untuk client terdampak, lalu scan QR ulang).
5. **Tambahkan observability state transisi** (`authenticated`, `ready`, `disconnected`, `auth_failure`) agar timeout tidak “silent”.

### Best Practice Operasional untuk Cicero_V2

1. **Jangan hanya menunggu `ready`; sertakan health gate bertahap**
   - Tahap 1: tunggu `authenticated`.
   - Tahap 2: cek `getState()`/status adapter periodik.
   - Tahap 3: jika timeout, log context lengkap (sudah ada), lalu trigger recovery terkontrol.

2. **Atur timeout berdasarkan lingkungan**
   - Gunakan `WA_READY_TIMEOUT_MS` > 60000 ms pada server dengan I/O lambat atau cold start sering.
   - Pertahankan default 60000 ms untuk dev cepat, naikkan ke 90000–120000 ms untuk production yang resource-sharing.

3. **Stabilisasi versi WhatsApp Web**
   - Set `WA_WEB_VERSION_CACHE_URL` ke endpoint stabil.
   - Jika endpoint cache sering timeout/invalid, pin sementara `WA_WEB_VERSION` lalu review berkala.

4. **Higiene sesi dan profile Puppeteer**
   - Pastikan `WA_AUTH_DATA_PATH` persisten, writable, dan tidak dipakai lintas instance secara bersamaan.
   - Pastikan `WA_PUPPETEER_EXECUTABLE_PATH` menunjuk binary valid (`chmod +x` jika perlu).
   - Cegah profile lock dengan one-client-one-session-path.

5. **Recovery policy yang aman**
   - Retry inisialisasi dengan exponential backoff.
   - Jika `auth_failure`/logout: hapus sesi client terdampak saja, minta scan QR ulang.
   - Jika berkali-kali timeout dengan `awaitingQrScan=false`: restart browser context, lalu fallback ke reset session terarah.

### Daftar Referensi Komunitas

- https://github.com/pedroslopez/whatsapp-web.js/issues/5768
- https://github.com/pedroslopez/whatsapp-web.js/issues/5792
- https://github.com/pedroslopez/whatsapp-web.js/issues/3830
- https://github.com/pedroslopez/whatsapp-web.js/issues/3732
- https://github.com/pedroslopez/whatsapp-web.js/issues/5758
- https://wwebjs.dev/guide/creating-your-bot/authentication.html

### Checklist Investigasi Cepat (Saat Incident Berulang)

```bash
# 1) Pastikan versi paket
npm ls whatsapp-web.js

# 2) Validasi env krusial
printenv | rg 'WA_READY_TIMEOUT_MS|WA_AUTH_DATA_PATH|WA_PUPPETEER_EXECUTABLE_PATH|WA_WEB_VERSION|WA_WEB_VERSION_CACHE_URL'

# 3) Cek apakah session path benar-benar ada dan writable
ls -ld "$WA_AUTH_DATA_PATH" "$WA_AUTH_DATA_PATH"/session-wa-admin

# 4) Cek executable browser
ls -l "$WA_PUPPETEER_EXECUTABLE_PATH"

# 5) Pantau log lifecycle (ready/auth/disconnect)
pm2 logs cicero_V2 --lines 300 | rg '\[WA\]|ready|authenticated|auth_failure|disconnected|waitForClientReady'
```

Jika setelah checklist di atas masih timeout konsisten, lakukan **reinit client bertahap** (bukan restart total semua proses dulu), lalu eskalasi ke reset session pada client terdampak.

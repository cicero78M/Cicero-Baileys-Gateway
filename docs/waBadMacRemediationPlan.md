# WhatsApp Gateway Bad MAC Audit and Remediation Plan

## Scope

This document audits the repeated production log pattern:

```text
Session error:Error: Bad MAC Error: Bad MAC
at Object.verifyMAC (.../node_modules/libsignal/src/crypto.js:87:15)
at SessionCipher.doDecryptWhisperMessage (.../node_modules/libsignal/src/session_cipher.js:250:16)
at async SessionCipher.decryptWithSessions (.../node_modules/libsignal/src/session_cipher.js:147:29)
```

The audit is limited to the repository state currently available in `Cicero-Baileys-Gateway`. It does not assume production-only files, database schema, Redis keys, or PM2 runtime state that were not visible in this checkout.

## Verified facts from the codebase

1. The gateway uses Baileys, not `whatsapp-web.js`, for the active WhatsApp client. `package.json` includes `@whiskeysockets/baileys` and the gateway imports `makeWASocket`, `useMultiFileAuthState`, `makeCacheableSignalKeyStore`, and `DisconnectReason` from Baileys.
2. Auth state is stored on disk using Baileys multi-file auth state. If `WA_AUTH_DATA_PATH` is unset, the adapter uses `$HOME/.cicero/baileys_auth/session-${clientId}`.
3. The current gateway service still has an older local default auth folder name of `$HOME/.cicero/wwebjs_auth`, but the Baileys adapter itself writes under `$HOME/.cicero/baileys_auth` unless `WA_AUTH_DATA_PATH` is explicitly set.
4. `GATEWAY_WA_CLIENT_ID` is normalized to lowercase and must not remain `wa-gateway`; startup throws if the configured ID is mixed-case, defaults to `wa-gateway`, or has a case-mismatched session folder.
5. On Baileys `connection.update` close, the adapter resets auth only for disconnect status codes in `loggedOut`, `badSession`, and `timedOut`. For other close reasons, it reconnects up to three times without deleting auth data.
6. Incoming messages are accepted only after Baileys emits `message`; the service defers gateway messages if its readiness state is not ready.
7. PM2 config in this repo starts a single app named `cicero_v2` from `app.js` and sets `WA_SERVICE_SKIP_INIT=false` in both default and production env blocks.
8. No local `.env` file was present in this checkout, so production values for `WA_AUTH_DATA_PATH`, `GATEWAY_WA_CLIENT_ID`, `WA_DEBUG_LOGGING`, and PM2 runtime env were not verified here.

## What Bad MAC means in this context

`Bad MAC` is emitted by the Signal/libsignal layer while verifying an encrypted WhatsApp message. In this gateway, the most likely category is a mismatch between the incoming encrypted message and the local Baileys Signal session/key material loaded from the auth directory. It is not a PostgreSQL application query error, and the visible stack does not point to CICERO controller/service business logic.

Common production causes that match this codebase are:

- the auth folder for this gateway was copied, restored, partially overwritten, or shared with another process;
- more than one running process is using the same `GATEWAY_WA_CLIENT_ID` and the same `WA_AUTH_DATA_PATH`;
- session files were corrupted or not saved consistently during process restarts;
- `WA_AUTH_DATA_PATH` changed between deployments, so the process is reading stale or wrong key material;
- the linked WhatsApp device was reset/relinked elsewhere while the gateway kept old local session files;
- Baileys received historical or queued encrypted messages that no longer match local Signal state.

## Immediate production triage plan

Run these steps on the production host before changing code:

1. Capture runtime identity and process multiplicity.
   - `pm2 list`
   - `pm2 describe cicero_v2`
   - `pm2 env <pm2_id>`
   - Confirm there is exactly one WhatsApp gateway process using the same phone number, `GATEWAY_WA_CLIENT_ID`, and `WA_AUTH_DATA_PATH`.
2. Capture a safe env snapshot without secrets.
   - `pm2 env <pm2_id> | egrep '^(NODE_ENV|WA_|GATEWAY_WA_CLIENT_ID|USER_WA_CLIENT_ID|REDIS_URL|PORT)='`
   - Do not paste secrets into tickets/logs.
3. Locate the real Baileys auth folder.
   - If `WA_AUTH_DATA_PATH` is set, inspect `$WA_AUTH_DATA_PATH/session-$GATEWAY_WA_CLIENT_ID`.
   - If it is unset, inspect `$HOME/.cicero/baileys_auth/session-$GATEWAY_WA_CLIENT_ID`.
4. Verify that the auth folder is not shared by another PM2 app, cron job, backup restore job, or another server.
   - `find "$WA_AUTH_DATA_PATH" -maxdepth 2 -type d -name 'session-*' -print`
   - `lsof +D "$WA_AUTH_DATA_PATH/session-$GATEWAY_WA_CLIENT_ID"` if available.
5. Enable temporary Baileys diagnostics for one incident window only.
   - Set `WA_DEBUG_LOGGING=true` temporarily.
   - Restart the gateway.
   - Capture structured logs around `connection_closed`, `auth_failure`, `qr_code_generated`, and `baileys_version_fetched`.
   - Turn debug logging off after collecting data.
6. Preserve before-reset evidence.
   - Stop the app: `pm2 stop cicero_v2`.
   - Archive the auth folder: `tar -czf /tmp/baileys-auth-$(date +%Y%m%d-%H%M%S).tgz -C "$WA_AUTH_DATA_PATH" "session-$GATEWAY_WA_CLIENT_ID"`.
   - Do not delete production evidence before archiving.

## Recovery decision tree

### Case A: only a few Bad MAC lines and gateway remains ready

- Do not delete auth immediately.
- Confirm messages are still being received and sent.
- Keep the incident under observation and continue with instrumentation improvements below.

### Case B: Bad MAC repeats continuously but connection remains open

- Treat local Signal state as suspect.
- Stop the PM2 process.
- Archive auth folder.
- Move the session folder out of the live path.
- Start PM2 and scan the new QR.
- Verify `/wa-health` readiness and a real inbound/outbound message.

### Case C: Bad MAC plus disconnect/auth failure loops

- Confirm no duplicate process is running with same auth folder.
- If no duplicate is found, reset session after archiving evidence.
- If duplicate is found, stop all duplicates first; keep only one owner for the auth folder and phone number.

### Case D: after relink, Bad MAC returns quickly

- Verify that deployment scripts, rsync, backups, or container volume mounts are not restoring old session files.
- Verify `GATEWAY_WA_CLIENT_ID` and `WA_AUTH_DATA_PATH` are stable across PM2 restarts.
- Review whether multiple repositories/services are connecting the same WhatsApp device.

## Implemented operational diagnostics

1. Auth path diagnostics are now exposed by the Baileys adapter. The client exposes `sessionPath` and `authDataPath`, and `/wa-health` includes both values in its readiness snapshot.
2. The local fallback auth folder naming is aligned to `baileys_auth` in `waService` so startup validation points at the same default parent used by the Baileys adapter.
3. Baileys logger output is classified for Signal/session decrypt errors matching `Bad MAC`, `No session`, and `Session error`. The adapter records safe counters and emits a structured `signal_decrypt_error` event without logging message body content.
4. `/wa-health` now includes a `signalErrors` snapshot with total count, per-code counts, five-minute recent count, and the last redacted event summary.

## Remaining code-level remediation plan

1. Add a safe threshold action.
   - If `Bad MAC` exceeds a configured threshold within a window, mark the client degraded and notify admins.
   - Do not auto-delete auth by default; require an explicit env flag for automated quarantine/reset.
2. Add an operator runbook endpoint or script.
   - Provide a script that prints client ID, resolved auth path, folder existence, file count, PM2 process info, and duplicate ownership hints.
   - The script must redact secrets and must not mutate auth data unless called with an explicit reset flag.
3. Harden reconnect behavior.
   - Ensure reconnect attempts cannot overlap when multiple close events arrive quickly.
   - Add backoff and a lock around `reinitializeClient`.
   - Record last reconnect reason and timestamp in readiness diagnostics.
4. Reduce risky history decrypt pressure if confirmed by logs.
   - Evaluate changing `shouldSyncHistoryMessage` from always true to a safer setting, after confirming business impact on missed historical messages.
5. Add tests.
   - Unit-test auth path resolution.
   - Unit-test client ID validation.
   - Unit-test Bad MAC classification and threshold state transitions without real WhatsApp network calls.

## Rollback and safety

- Never run `WA_AUTH_CLEAR_SESSION_ON_REINIT=true` in production without a planned maintenance window, because this code deletes the live auth folder on initialization.
- Always archive the session folder before reset.
- Keep only one running owner of one auth folder.
- After reset/relink, verify inbound group processing, direct-message confirmation handling, and outbox sending.

## Open verification items

These items require production access and were not verifiable from this checkout:

- real PM2 process name on the host that emitted `2|gateway`;
- actual `WA_AUTH_DATA_PATH` and `GATEWAY_WA_CLIENT_ID` values;
- whether another process or repository uses the same WhatsApp account;
- exact frequency/window of Bad MAC events;
- whether Redis outbox backlog coincided with the incident;
- whether the issue started after a deployment, restart, auth folder restore, or WhatsApp relink.

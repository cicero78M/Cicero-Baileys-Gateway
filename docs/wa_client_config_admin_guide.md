# WhatsApp Client Config Admin Guide

## Overview

The WhatsApp client configuration workflow now includes:

- Self-message driven client selection with guided configuration changes.
- Session cleanup in the background for expired configuration sessions.
- Audit logging for applied and discarded configuration changes.
- Performance metrics exposed through the WA health route payload.
- Seed scripts for default `client_config` templates and admin authorization records.

## Operational Notes

- Incoming WhatsApp messages already flow through `waEventAggregator`, so client-config messages inherit the existing deduplication behavior.
- Outbound WhatsApp traffic still rides on the existing `waService` send pipeline, which is already rate-limited before transport.
- Expired config sessions are cleaned automatically by `ConfigSessionService` every 5 minutes by default.

## Admin Authorization Utility

Manage authorized WhatsApp numbers with:

```bash
node scripts/manageWaAdminAuthorization.js list
node scripts/manageWaAdminAuthorization.js stats
node scripts/manageWaAdminAuthorization.js grant +6281234567890 full
node scripts/manageWaAdminAuthorization.js scope +6281234567890 CLIENT_001 CLIENT_002
node scripts/manageWaAdminAuthorization.js revoke +6281234567890
node scripts/manageWaAdminAuthorization.js delete +6281234567890
```

## Default Template Seeding

Seed missing default `client_config` rows for WhatsApp configuration management with:

```bash
node scripts/seedWaClientConfigDefaults.js
node scripts/seedWaClientConfigDefaults.js --overwrite
```

This seeds:

- Default connection, message handling, notification, and automation values under `client_id = 'DEFAULT'`.
- Message templates used by the WhatsApp client-config workflow.

## Audit Reporting

Use `src/utils/configAuditReport.js` to build an operational summary from `client_config_audit_log`.

Typical report output includes:

- Total actions, sessions, confirmed sessions, and rollbacks.
- Most active administrators.
- Most modified configuration keys.
- Recent audit entries for a client or administrator.

## Metrics and Health

`src/routes/waHealthRoutes.js` now includes `waClientConfig` metrics, which track:

- Session starts, completions, cancellations, and rollbacks.
- Applied configuration changes.
- Cleanup job runs and removed sessions.
- Operation latency snapshots for key handler/service flows.

## Recommended Deployment Steps

1. Seed default config templates if they have not been inserted yet.
2. Register administrator WhatsApp numbers.
3. Verify `/config` from an authorized number.
4. Check the WA health route for readiness, dedup stats, and `waClientConfig` metrics.
5. Review `client_config_audit_log` after the first successful configuration change.

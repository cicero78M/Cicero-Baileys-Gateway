<!--
SYNC IMPACT REPORT
==================
Version change: 1.3.0 → 2.0.0
Bump rationale: MAJOR — entire authentication/controller layer and all non-WA HTTP
  routes removed. Scope reduced from a multi-feature web API to a focused WhatsApp
  auto-response gateway. Principles I, IV, and the Security Requirements table have
  been redefined to reflect this new bounded scope.
Modified principles:
  - I. Layered Architecture: removed `src/controller/` from mandatory chain;
    updated import chain to `route → service → model/repository`. Controller layer
    no longer exists — the sole HTTP route is the health endpoint.
  - III. Test Coverage: removed `wwebjsAdapter` reference (adapter deleted).
  - IV. Security-First Design: removed references to `authRequired`, `bcrypt`,
    `visitor_logs`, `login_log`, and rate limiting on auth endpoints (those layers
    no longer exist in this repository).
  - V. Observability: updated cron section to reference only the one planned cron
    (`cronWaNotificationReminder`; not yet implemented).
  - VII. WhatsApp Gateway Reliability: removed `wwebjsAdapter.js` reference
    (file deleted; Baileys is now the sole adapter).
  - VIII. Simplicity: updated service-directory count to reflect cleanup.
Added sections: none
Removed sections: none
Files changed in this scope-reduction session:
  - src/service/waAutoComplaintService.js — removed legacy clientRequestHandlers flow
  - src/service/waService.js — removed 200+ lines of user-menu, profile-verification,
    bulk-deletion, and mutual-reminder logic; only complaint + task dispatch remain
Templates requiring updates:
  - .specify/templates/plan-template.md  ✅ No changes required
  - .specify/templates/spec-template.md  ✅ No changes required
  - .specify/templates/tasks-template.md ✅ No changes required
Deferred TODOs:
  - TODO(CONSOLE_MIGRATION): console.* calls in service/handler/adapter layers
    remain; migrate to pino logger incrementally per-PR.
  - TODO(CRON_NOTIF_REMINDER): `cronWaNotificationReminder.js` is planned but not
    yet implemented; `waNotificationReminderStateModel.js` is the data layer placeholder.
-->

# Cicero_V2 Constitution

## Core Principles

### I. Layered Architecture (NON-NEGOTIABLE)

Every feature MUST be placed in the correct architectural layer:

- **`src/routes/`** — HTTP route definitions only; no business logic.
  Currently only `waHealthRoutes.js` exists (health endpoint).
- **`src/service/`** — Business logic, orchestration, external API calls.
- **`src/repository/`** — All direct database queries; no business logic.
- **`src/middleware/`** — Cross-cutting concerns: dedup, error handling, path guard.
- **`src/model/`** — Database model definitions and schema helpers.
- **`src/handler/`** — WhatsApp message routing logic and automation processors.
- **`src/config/`** — Environment loading and infrastructure clients (Redis, DB pool).

**Separation of Concerns — mandatory import chain:**
The permitted chain is: `route → service → model/repository`.
Handlers delegate to services; services MUST NOT contain Express-specific
objects (`req`, `res`).

**Single Responsibility Principle (SRP):**
Each function MUST have one clearly named responsibility. A function that exceeds
roughly 30 lines or performs more than one distinct task MUST be extracted into
a named helper or separate service function.

**Rationale**: Enforces separation of concerns, makes each layer independently
testable, and prevents logic from diffusing across files.

### II. Naming Conventions (NON-NEGOTIABLE)

- JavaScript identifiers (functions, variables, class instances) MUST use `camelCase`.
- Boolean functions MUST be prefixed with `is` or `has`
  (e.g., `isAuthorized`, `hasPermission`).
- Async functions MUST begin with a verb describing the action
  (e.g., `fetchInstagramPosts`, `sendReportViaWA`).
- File names MUST use `camelCase` with the appropriate extension
  (e.g., `userController.js`, `baileysAdapter.js`).
- Folder names MUST be lowercase with no spaces
  (e.g., `controller`, `service`, `middleware`).
- Database table and column names MUST use `snake_case`
  (e.g., `insta_post`, `client_id`, `created_at`).
- Primary keys MUST end with `_id` matching the entity name
  (e.g., `user_id`, `client_id`).

Deviations require explicit justification and MUST be documented in
`docs/naming_conventions.md`.

**Rationale**: Consistent naming reduces cognitive load, accelerates onboarding,
and prevents subtle bugs caused by mismatched identifiers across layers.

### III. Test Coverage (NON-NEGOTIABLE)

- Every new service, repository, middleware, and handler MUST ship
  with a corresponding unit test in `tests/`.
- Tests MUST use Jest (`npm test`) with Node.js v20+.
- A PR that reduces overall passing test count MUST NOT be merged.
- Integration-level tests are REQUIRED for:
  - WhatsApp adapter behavior changes (`baileysAdapter`).
  - Database migration correctness (run via `scripts/run_migration.js`).
- The `npm run lint` gate MUST pass before `npm test` is run.
- Tests MUST NOT depend on live external services (Instagram API, TikTok API,
  WhatsApp) — mock or stub all I/O boundaries.

**Rationale**: The project already has an extensive test suite (100+ test files).
Maintaining this discipline prevents regressions as the codebase grows.

### IV. Security-First Design

- All admin-initiated outbound WA messages MUST use the `authRequired` middleware
  if an admin HTTP route is added in future; currently no auth routes exist.
- Passwords MUST be hashed with `bcrypt` before storage if password-based auth
  is re-introduced; plaintext passwords MUST NOT appear in the database or logs.
- JWT secrets and all credentials MUST be loaded from environment variables via
  `src/config/env.js`; hardcoded secrets MUST NOT exist in source code.
- User-supplied input MUST be validated before being passed to any SQL query or
  external API call.
- SQL queries MUST use parameterised statements; string-interpolated SQL is
  forbidden.
- Sensitive routes (admin, internal health, WA gateway) MUST be protected by
  `sensitivePathGuard` middleware.
- API keys, tokens, and `.env` files MUST NOT be committed to version control.
- OWASP Top 10 issues (injection, broken auth, IDOR, etc.) MUST be addressed
  before a PR is merged.
- WhatsApp message payloads MUST be deduplicated via `waEventAggregator` before
  processing to prevent replay attacks and duplicate side-effects.

**Rationale**: Cicero_V2 handles sensitive personnel data, social media credentials,
and institutional workflows. Security lapses carry operational and reputational risk.

### V. Observability & Structured Logging

- Application logs MUST use `pino` (configured in `src/utils/logger.js`);
  `console.log` MUST NOT be used in production paths except for startup banners.
- Log entries MUST include at minimum: timestamp, log level, module/service name,
  and a human-readable message.
- Errors caught in `try/catch` blocks MUST be logged with the full error object
  (`err.message`, `err.stack`) before responding to the client.
  The canonical fail-safe pattern is:
  ```js
  import { logger } from '../utils/logger.js';
  try {
    // ... operation
  } catch (err) {
    logger.error({ err, route: 'POST /example' }, 'Operation failed');
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
  ```
- Every `async` route, controller, service, and handler function MUST wrap its
  main logic in `try/catch`; unhandled promise rejections in HTTP request paths
  are forbidden.
- Health endpoints (`/api/health/wa`) MUST expose key runtime metrics
  (WA client status, cache sizes, uptime).
- Cron jobs MUST log start, completion, and any skipped cycles with reason.
  (The planned `cronWaNotificationReminder` is not yet implemented; its model
  placeholder `waNotificationReminderStateModel.js` exists for future use.)
- WhatsApp sessions MUST log connection state transitions
  (connecting → ready → disconnected).

**Rationale**: The system runs unattended cron jobs and multi-tenant WA sessions.
Observable logs allow rapid diagnosis of failures without intrusive debugging.
The fail-safe `try/catch` pattern prevents silent errors that surface only as
downstream data corruption or user-visible 500 responses.

### VI. Database & Migration Discipline

- All schema changes MUST be implemented as versioned SQL migration files in
  `sql/migrations/` with the naming pattern `YYYYMMDD_description.sql`.
- Migrations MUST be executed via the runner `node scripts/run_migration.js
  <file>` — never applied by hand via a database console in production.
- Migration files MUST be idempotent where possible (use `IF NOT EXISTS`,
  `ON CONFLICT DO NOTHING`).
- Every new table MUST define a primary key, `created_at`, and `updated_at`
  columns at minimum.
- Frequently queried columns MUST have an index defined in the migration.
- Breaking schema changes (column removal, type change) MUST include a migration
  plan and backward-compatible interim step.
- The canonical schema is `sql/schema.sql`; it MUST be kept in sync with all
  applied migrations.

**Rationale**: Uncontrolled schema changes cause production outages and data
corruption. The runner's validation layer prevents common encoding errors.

### VII. WhatsApp Gateway Reliability

- WhatsApp client initialisation and session lifecycle MUST be managed exclusively
  through `baileysAdapter.js` (the sole adapter; `wwebjsAdapter.js` has been removed).
- All outbound WA messages MUST be queued through `waOutbox.js` (BullMQ, backed
  by Redis) to prevent rate-limit violations and message loss during reconnection.
- Message handlers (groups, direct, gateway) MUST be idempotent — re-delivering
  the same message ID MUST NOT produce duplicate side-effects.
- API endpoints that create or modify resources MUST be designed for safe retry:
  use PostgreSQL `INSERT ... ON CONFLICT DO NOTHING`, `ON CONFLICT DO UPDATE`
  (upsert), or a client-supplied idempotency key stored in a `requests` table.
  Retrying the same operation MUST yield the same observable outcome.
- Memory-unbounded data structures (plain `Set`, `Map` without TTL) MUST NOT be
  used in long-running WA session processes; use TTL-based caches instead.
- WA cron tasks MUST NOT be registered until the WA client emits a `ready` event;
  premature scheduling causes fatal startup crashes.
- Session credentials MUST be stored in the configured auth state directory and
  MUST NOT be committed to version control.

**Rationale**: WA session management has historically been the primary source of
memory leaks and runtime crashes. These rules encode the lessons from past incidents
documented in `docs/wa_memory_leak_fix.md` and `docs/wa_best_practices.md`.
Idempotency at the API level prevents duplicate records when clients retry on
network failure.

### VIII. Simplicity & YAGNI

- Features MUST NOT be added speculatively; every new route, service, or model
  MUST be traceable to a documented requirement.
- Helper utilities MUST NOT be created for a single use-case; extract reusable
  logic only when it is used in three or more places.
- Dependencies MUST NOT be added to `package.json` without evaluating whether an
  existing dependency already covers the need.
- ESM (`import`/`export`) is the mandatory module system; CommonJS `require()` is
  forbidden in new code.
- Avoid nested callbacks; use `async/await` throughout the codebase.
- All configuration values that differ between environments (URLs, ports, flags,
  secrets, feature toggles) MUST be defined in `src/config/env.js` and consumed
  via that module. Hardcoded strings or numbers that vary by environment MUST NOT
  appear in service, controller, or handler layers.

**Rationale**: This service is now focused on two auto-response features
(complaint triage and sosmed-task broadcast dispatch). Complexity has compounding
costs; further abstractions MUST be traceable to an explicit requirement.

## Security Requirements

The following controls are non-negotiable baseline requirements.

| Concern | Requirement |
|---|---|
| Authentication | No public auth routes; admin actions via direct DB or future auth middleware |
| Password storage | `bcrypt` with ≥ 12 rounds if auth is re-introduced |
| Input validation | Explicit type checks on all user-supplied fields |
| SQL safety | Parameterised queries only; no string interpolation |
| Secrets | Load from `process.env` via `env.js`; never hard-coded |
| CORS | Restrict `origin` to `env.CORS_ORIGIN`; credentials mode on |
A| Sensitive paths | `sensitivePathGuard` on `/api/health/wa` |
| WA deduplication | `waEventAggregator` prevents replay and double-processing |

Security vulnerabilities reported via GitHub Issues MUST receive an acknowledged
response within 48 hours and a patch within 7 calendar days.

## Development Workflow & Quality Gates

### Before Opening a PR

1. Run `npm run lint` — zero errors required.
2. Run `npm test` — all existing tests must pass; new code must include tests.
3. Confirm `git status --short` is clean (no untracked or modified files).
4. Run any relevant database migrations using `node scripts/run_migration.js`.

### PR Review Gates

- All reviewers MUST verify Constitution compliance before approving.
- PRs containing raw SQL outside `src/repository/` MUST be rejected.
- PRs adding `console.log` in service/controller/handler layers MUST be rejected.
- PRs that skip tests with `.skip` or `xit` without justification MUST be rejected.
- PRs affecting the WA adapter or session lifecycle MUST include a linked test in
  `tests/baileysAdapter.test.js` or equivalent.

### Branch & Commit Conventions

- Branch names: `###-short-description` (issue number prefix preferred).
- Commit messages: imperative mood, concise, referencing affected files
  (e.g., `fix(waService): prevent double listener registration on reinit`).
- PRs MUST reference the spec or issue they address in the body.

### Deployment

#### Containerised Deployment (Docker) — Preferred

- The preferred production deployment method is Docker Compose:
  `docker-compose up -d --build`
- The `Dockerfile` uses a multi-stage Alpine build; the final image runs as a
  non-root `appuser` for security.
- The `docker-compose.yml` orchestrates `postgres`, `redis`, and the `app` service
  (three services total; no external message broker required).
- All environment variables MUST be supplied via a `.env` file at repository root;
  `.env` MUST NOT be committed (excluded by `.dockerignore` and `.gitignore`).
- Named Docker volumes (`postgres_data`, `redis_data`, `wa_session`, `uploads`,
  `backups`) MUST be used for all stateful data; binding host paths directly in
  production is discouraged.

#### Bare-Metal Deployment (PM2)

- Bare-metal deployments use PM2 (`ecosystem.config.js`).
- All environment variables MUST be set before starting the process.
- Node.js version MUST be 20 or higher.

#### Common Prerequisites (Both Methods)

- PostgreSQL and Redis MUST be healthy before the Node process starts.
- Target uptime ≥ 99%; average API response time < 1 second
  (per KPI in `docs/vision_mission_kpi.md`).

## Governance

This constitution supersedes all other practices, guidelines, and README instructions
where there is a conflict. The following amendment procedure applies:

- **PATCH** (clarifications, wording): Any maintainer may amend; document in PR body.
- **MINOR** (new principle or section): Requires at least one other maintainer review.
- **MAJOR** (removing or redefining a principle): Requires team discussion, migration
  plan for affected code, and updated documentation before merge.

Version increments follow semantic versioning:
`MAJOR.MINOR.PATCH` — bump the appropriate segment per the change type above.

All PRs and code reviews MUST verify compliance with the active constitution version.
Runtime development guidance is captured in `docs/` (e.g., `docs/wa_best_practices.md`,
`docs/naming_conventions.md`, `docs/running_migrations.md`).

**Version**: 2.0.0 | **Ratified**: 2026-03-24 | **Last Amended**: 2026-07-14

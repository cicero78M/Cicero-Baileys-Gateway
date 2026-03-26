# Cicero-Baileys-Gateway Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-26

## Active Technologies
- Node.js 22, ESM (`"type": "module"`) + `@whiskeysockets/baileys`, `bullmq`, `bottleneck`, `pg`, `pino`, `axios` (001-wa-complaint-autoresponse)
- PostgreSQL — `"user"` table (PK: `user_id`, social cols: `insta`, `tiktok`); `insta_post` (PK: `shortcode`); `tiktok_post` (PK: `video_id`); `insta_like` (JSONB); `tiktok_comment` (JSONB); `clients` (`client_group` for group JID→clientId) (001-wa-complaint-autoresponse)
- Node.js 22, ESM (`import`/`export`) + `@whiskeysockets/baileys` (WA), `bullmq` + `ioredis` (outbox queue), `pg` (PostgreSQL), `pino` (logger), `bottleneck` (rate limiter) (003-sosmed-task-autoresponse)
- PostgreSQL (primary data + config + sessions), Redis (BullMQ backing store) (003-sosmed-task-autoresponse)
- Node.js 22 ESM (`import`/`export`) + Baileys (WA), BullMQ + Redis (outbox), pg (PostgreSQL), pino (logging), Jest (tests) (003-sosmed-task-autoresponse)
- PostgreSQL — new tables `client_config`, `operators`, `operator_registration_sessions`; altered `insta_post` + `tiktok_post` (003-sosmed-task-autoresponse)
- [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION] (003-sosmed-task-autoresponse)
- [if applicable, e.g., PostgreSQL, CoreData, files or N/A] (003-sosmed-task-autoresponse)
- JavaScript — Node.js ≥ 20, ESM (`import`/`export` only; no CommonJS `require`) + `@whiskeysockets/baileys` (WA adapter), `bullmq` + `ioredis` (outbox queue), `pg` (PostgreSQL client), `pino` (logger), `jest` (unit tests) (003-sosmed-task-autoresponse)
- PostgreSQL (8 migrations total after delta migration); Redis (BullMQ backing only — no direct key access in this service) (003-sosmed-task-autoresponse)

- Node.js 20 (ESM modules, `"type": "module"` in package.json) + `@whiskeysockets/baileys` (WA adapter), `bullmq` + `bottleneck` (outbox queue), `ioredis` (Redis), `pg` (PostgreSQL), `axios` (external APIs), `pino` (logger), `jest` (testing) (001-wa-complaint-task-autoresponse)

## Project Structure

```text
src/
tests/
```

## Commands

# Add commands for Node.js 20 (ESM modules, `"type": "module"` in package.json)

## Code Style

Node.js 20 (ESM modules, `"type": "module"` in package.json): Follow standard conventions

## Recent Changes
- 003-sosmed-task-autoresponse: Added JavaScript — Node.js ≥ 20, ESM (`import`/`export` only; no CommonJS `require`) + `@whiskeysockets/baileys` (WA adapter), `bullmq` + `ioredis` (outbox queue), `pg` (PostgreSQL client), `pino` (logger), `jest` (unit tests)
- 003-sosmed-task-autoresponse: Added [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]
- 003-sosmed-task-autoresponse: Added Node.js 22 ESM (`import`/`export`) + Baileys (WA), BullMQ + Redis (outbox), pg (PostgreSQL), pino (logging), Jest (tests)


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

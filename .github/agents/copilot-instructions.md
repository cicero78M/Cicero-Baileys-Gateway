# Cicero-Baileys-Gateway Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-25

## Active Technologies
- Node.js 22, ESM (`"type": "module"`) + `@whiskeysockets/baileys`, `bullmq`, `bottleneck`, `pg`, `pino`, `axios` (001-wa-complaint-autoresponse)
- PostgreSQL — `"user"` table (PK: `user_id`, social cols: `insta`, `tiktok`); `insta_post` (PK: `shortcode`); `tiktok_post` (PK: `video_id`); `insta_like` (JSONB); `tiktok_comment` (JSONB); `clients` (`client_group` for group JID→clientId) (001-wa-complaint-autoresponse)
- Node.js 22, ESM (`import`/`export`) + `@whiskeysockets/baileys` (WA), `bullmq` + `ioredis` (outbox queue), `pg` (PostgreSQL), `pino` (logger), `bottleneck` (rate limiter) (003-sosmed-task-autoresponse)
- PostgreSQL (primary data + config + sessions), Redis (BullMQ backing store) (003-sosmed-task-autoresponse)
- Node.js 22 ESM (`import`/`export`) + Baileys (WA), BullMQ + Redis (outbox), pg (PostgreSQL), pino (logging), Jest (tests) (003-sosmed-task-autoresponse)
- PostgreSQL — new tables `client_config`, `operators`, `operator_registration_sessions`; altered `insta_post` + `tiktok_post` (003-sosmed-task-autoresponse)

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
- 003-sosmed-task-autoresponse: Added Node.js 22 ESM (`import`/`export`) + Baileys (WA), BullMQ + Redis (outbox), pg (PostgreSQL), pino (logging), Jest (tests)
- 003-sosmed-task-autoresponse: Added Node.js 22, ESM (`import`/`export`) + `@whiskeysockets/baileys` (WA), `bullmq` + `ioredis` (outbox queue), `pg` (PostgreSQL), `pino` (logger), `bottleneck` (rate limiter)
- 001-wa-complaint-autoresponse: Added Node.js 22, ESM (`"type": "module"`) + `@whiskeysockets/baileys`, `bullmq`, `bottleneck`, `pg`, `pino`, `axios`


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

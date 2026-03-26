# Implementation Plan: WhatsApp Client Configuration Management

**Branch**: `004-wa-client-config` | **Date**: March 26, 2026 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-wa-client-config/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Enable WhatsApp-based client configuration management through self-messaging security model. Administrators send command words to themselves to access a guided Q&A workflow for viewing and modifying client configurations organized in logical groups (connection, message handling, notifications, automation rules). Features session state management, sequential conflict resolution, and graceful error handling.

## Technical Context

**Language/Version**: Node.js 20+, JavaScript ES2022 (ESM modules)  
**Primary Dependencies**: Express.js, Baileys (WhatsApp), BullMQ, pg (PostgreSQL), redis  
**Storage**: PostgreSQL (client configs, sessions, logs), Redis (session state, queuing)  
**Testing**: Jest with Node.js 20+ test runner  
**Target Platform**: Docker containers (Alpine Linux), PM2 bare-metal deployment  
**Project Type**: WhatsApp gateway service with auto-response capabilities  
**Performance Goals**: <1s API response time, handle concurrent WA sessions, 99% uptime  
**Constraints**: Self-messaging security only, 10min session timeout, sequential processing  
**Scale/Scope**: Multi-tenant WA clients, comprehensive config parameters, queue-based flow

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Layered Architecture**: New feature follows `handler → service → repository` pattern established for WhatsApp features  
✅ **II. Naming Conventions**: Uses camelCase for JS (configSession, clientId), snake_case for DB (client_config, session_state)  
✅ **III. Test Coverage**: Will include Jest unit tests for all new services, handlers, repositories  
✅ **IV. Security-First Design**: Self-messaging auth model, input validation, parameterized queries, no hardcoded secrets  
✅ **V. Observability**: Uses pino logging, try/catch patterns, proper error handling and session state logging  
✅ **VI. Database & Migration Discipline**: New tables require versioned migrations in sql/migrations/  
✅ **VII. WhatsApp Gateway Reliability**: Uses baileysAdapter, BullMQ queuing for outbound, idempotent handlers  
✅ **VIII. Simplicity & YAGNI**: Builds on existing WhatsApp handler patterns, minimal new abstractions

**Gate Status: ✅ PASS** - No constitution violations identified. Feature aligns with established architectural patterns.

**Post-Design Re-evaluation**: ✅ CONFIRMED 
- Architecture documented in [data-model.md](data-model.md) maintains layered separation
- [WhatsApp interface contract](contracts/whatsapp-interface.md) follows established message handling patterns
- Session management design uses existing PostgreSQL patterns with TTL cleanup
- All new database tables follow naming conventions and include proper indexes

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── handler/
│   └── waClientConfigHandler.js     # WhatsApp message routing for config commands
├── service/
│   ├── waClientConfigService.js     # Business logic for config workflow
│   └── configSessionService.js     # Session state management
├── repository/
│   ├── clientConfigRepository.js   # CRUD operations for client configurations  
│   └── configSessionRepository.js  # Session persistence and cleanup
├── model/
│   ├── clientConfigModel.js        # Client configuration schema helpers
│   └── configSessionModel.js       # Configuration session schema helpers
├── utils/
│   └── configValidator.js          # Input validation for configuration values

tests/
├── unit/
│   ├── waClientConfigHandler.test.js
│   ├── waClientConfigService.test.js
│   ├── configSessionService.test.js
│   ├── clientConfigRepository.test.js
│   └── configSessionRepository.test.js
└── integration/
    └── waClientConfig.integration.test.js

sql/migrations/
├── YYYYMMDD_add_client_config_tables.sql
└── YYYYMMDD_add_config_session_tables.sql
```

**Structure Decision**: Single Node.js service architecture following established Cicero_V2 layered pattern. New files integrate into existing `src/handler/`, `src/service/`, `src/repository/`, and `src/model/` directories maintaining separation of concerns.

## Complexity Tracking

> **Not Applicable** - No constitution violations identified that require justification.

---
description: "Task implementation plan for WhatsApp Client Configuration Management"
---

# Tasks: WhatsApp Client Configuration Management

**Input**: Design documents from `/specs/004-wa-client-config/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Test tasks included based on constitution requirement for comprehensive test coverage

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single Node.js project structure based on plan.md:
- **Source**: `src/handler/`, `src/service/`, `src/repository/`, `src/model/`, `src/utils/`
- **Tests**: `tests/unit/`, `tests/integration/`
- **Migrations**: `sql/migrations/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database schema and foundational structure for WhatsApp configuration management

- [x] T001 Create database migration for client_config table extensions in sql/migrations/YYYYMMDD_add_client_config_extensions.sql
- [x] T002 Create database migration for configuration session tables in sql/migrations/YYYYMMDD_add_configuration_session_tables.sql
- [x] T003 Create database migration for administrator authorization table in sql/migrations/YYYYMMDD_add_administrator_authorization_table.sql
- [x] T004 Create database migration for configuration audit log table in sql/migrations/YYYYMMDD_add_configuration_audit_log_table.sql

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Extend existing ClientConfiguration model with config_group and validation_pattern in src/model/clientConfigModel.js  
- [x] T006 [P] Create ConfigurationSession model with session state schema helpers in src/model/configSessionModel.js
- [x] T007 [P] Create AdministratorAuthorization model with phone number validation in src/model/administratorAuthorizationModel.js
- [x] T008 [P] Create ConfigurationAuditLog model for change tracking in src/model/configurationAuditLogModel.js
- [x] T009 Extend existing ClientConfigRepository with new query methods in src/repository/clientConfigRepository.js
- [x] T010 [P] Create ConfigurationSessionRepository with session CRUD operations in src/repository/configSessionRepository.js  
- [x] T011 [P] Create AdministratorAuthorizationRepository for permission checks in src/repository/administratorAuthorizationRepository.js
- [x] T012 [P] Create ConfigurationAuditLogRepository for audit trail logging in src/repository/configurationAuditLogRepository.js
- [x] T013 Create ConfigValidator utility with format validation rules in src/utils/configValidator.js
  - Connection group: host (hostname/IP), port (1-65535), SSL (boolean), timeout (positive integer)
  - Message handling: queue_size (positive integer), retry_attempts (0-10), rate_limit (format: number/unit)
  - Notifications: boolean flags for alerts, reports, status_updates
  - Automation: boolean flags for auto_response, processing rules
- [x] T014 Create ConfigSessionService for session state management in src/service/configSessionService.js
- [x] T015 Extend existing ClientConfigService with Q&A workflow methods in src/service/clientConfigService.js

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Select Active Client Configuration (Priority: P1) 🎯 MVP

**Goal**: Enable administrators to securely access configuration management via WhatsApp self-messaging and select from active clients

**Independent Test**: Send /config command to yourself and verify authorized access with active client list response

### Tests for User Story 1 

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T016 [P] [US1] Unit test for command recognition patterns in tests/unit/waClientConfigHandler.test.js
- [x] T017 [P] [US1] Unit test for administrator authorization validation in tests/unit/administratorAuthorizationRepository.test.js  
- [x] T018 [P] [US1] Integration test for complete client selection workflow in tests/integration/waClientConfig.integration.test.js

### Implementation for User Story 1

- [x] T019 [P] [US1] Create WhatsApp message handler with command pattern recognition in src/handler/waClientConfigHandler.js
- [x] T020 [US1] Create WhatsApp client configuration service with authorization checks in src/service/waClientConfigService.js
- [x] T021 [US1] Integrate handler with existing waService.js message listener chain in src/service/waService.js
  - Add handleClientConfigMessage import and call in main message processing function
  - Insert before existing waAutoComplaintService and waAutoSosmedTaskService calls
  - Ensure command recognition runs early in message processing pipeline
- [x] T022 [US1] Implement active client listing with professional message formatting in waClientConfigService.js
- [x] T023 [US1] Add session creation for client selection workflow in waClientConfigService.js  
- [x] T024 [US1] Implement security validation for self-messaging authentication in waClientConfigHandler.js
- [x] T025 [US1] Add error handling for unauthorized access and no active clients scenarios in waClientConfigService.js
- [x] T025a [US1] Implement inactive client detection and graceful rollback in src/service/configSessionService.js
  - Monitor client status during session lifecycle
  - Rollback pending changes when client becomes inactive
  - Notify administrator with professional error message
  - Clean up session state and audit log the rollback event

**Checkpoint**: At this point, administrators can authenticate and view active clients via WhatsApp commands

---

## Phase 4: User Story 2 - View Current Client Configuration (Priority: P2)

**Goal**: Display current client configuration in professional, organized format after client selection

**Independent Test**: Select a client and verify complete configuration overview displayed in logical sections

### Tests for User Story 2

- [ ] T026 [P] [US2] Unit test for configuration formatting and grouping in tests/unit/waClientConfigService.test.js
- [ ] T027 [P] [US2] Unit test for session state transitions in tests/unit/configSessionService.test.js
- [ ] T028 [P] [US2] Integration test for client selection to configuration display flow in tests/integration/waClientConfig.integration.test.js

### Implementation for User Story 2

- [ ] T029 [P] [US2] Implement client selection processing with session state update in src/service/waClientConfigService.js
- [ ] T030 [US2] Implement configuration retrieval with logical grouping (connection, message_handling, notifications, automation_rules) in waClientConfigService.js
- [ ] T031 [US2] Create professional message templates for configuration display in waClientConfigService.js
- [ ] T032 [US2] Add session state management for viewing_config stage in src/service/configSessionService.js
- [ ] T033 [US2] Implement configuration caching strategy following existing patterns in waClientConfigService.js
- [ ] T034 [US2] Add modification prompt handling with yes/no token recognition in waClientConfigService.js

**Checkpoint**: At this point, User Stories 1 AND 2 work independently - administrators can view any client's configuration

---

## Phase 5: User Story 3 - Modify Configuration Through Guided Workflow (Priority: P3)

**Goal**: Enable interactive Q&A workflow for systematic configuration parameter modification

**Independent Test**: Complete full modification workflow including group selection, parameter changes, validation, and confirmation

### Tests for User Story 3

- [ ] T035 [P] [US3] Unit test for Q&A workflow state machine in tests/unit/waClientConfigService.test.js
- [ ] T036 [P] [US3] Unit test for configuration validation and error messages in tests/unit/configValidator.test.js
- [ ] T037 [P] [US3] Integration test for complete modification workflow with rollback scenarios in tests/integration/waClientConfig.integration.test.js

### Implementation for User Story 3

- [ ] T038 [P] [US3] Implement configuration group selection workflow (connection, message_handling, notifications, automation_rules) in src/service/waClientConfigService.js
- [ ] T039 [US3] Implement parameter-specific Q&A prompts with validation rules in waClientConfigService.js
- [ ] T040 [US3] Add pending changes accumulation and rollback capability in src/service/configSessionService.js
- [ ] T041 [US3] Implement configuration validation with format rules and error feedback in waClientConfigService.js
- [ ] T042 [US3] Add change confirmation workflow with summary display in waClientConfigService.js
- [ ] T043 [US3] Implement atomic configuration commit with audit logging in waClientConfigService.js
- [ ] T044 [US3] Add session timeout warning and extension handling in configSessionService.js
- [ ] T045 [US3] Implement concurrent access conflict resolution with request queueing in waClientConfigService.js

**Checkpoint**: All user stories should now be independently functional with complete configuration management capability

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: System reliability, monitoring, and production readiness

- [ ] T046 [P] Add comprehensive error logging with pino logger integration across all services
- [ ] T047 [P] Implement session cleanup cron job for expired configuration sessions
- [ ] T048 [P] Add admin authorization management utilities for phone number registration
- [ ] T049 [P] Create configuration audit report generation utilities  
- [ ] T050 [P] Add performance monitoring for WhatsApp message processing latency
- [ ] T051 Add integration with existing waEventAggregator deduplication patterns
- [ ] T052 Add integration with existing waOutbox rate-limiting for all outbound messages
- [ ] T053 Add graceful client inactive detection with pending change rollback
- [ ] T054 Add configuration templates and default values for new clients
- [ ] T055 Add comprehensive documentation updates for administrator onboarding

---

## Dependencies

### User Story Completion Order (Sequential)
1. **User Story 1** (MVP) → Can be delivered as standalone admin authentication and client browsing
2. **User Story 2** (Builds on US1) → Adds configuration viewing capability 
3. **User Story 3** (Builds on US1+US2) → Completes full modification workflow

### Parallel Execution Examples

**Within User Story 1**:
- T016, T017, T018 (all test files) can run in parallel
- T019, T020 (handler and service) can be developed in parallel once foundational phase complete

**Within User Story 2**: 
- T026, T027, T028 (all test files) can run in parallel
- T029, T032, T033 (different service aspects) can be developed in parallel

**Within User Story 3**:
- T035, T036, T037 (all test files) can run in parallel  
- T038, T039, T040 (different workflow components) can be developed in parallel

### Critical Path
T001-T004 (migrations) → T005-T015 (foundational models/services) → T019-T025 (US1 core) → T029-T034 (US2 core) → T038-T045 (US3 core)

---

## Implementation Strategy

### MVP First (Recommended)
Implement and deploy **User Story 1 only** as initial MVP:
- Provides immediate value: secure admin authentication and client browsing
- Validates WhatsApp integration and security model  
- Establishes foundation for subsequent enhancements
- Reduces deployment risk with minimal scope

### Incremental Delivery
Each user story delivers independently testable value:
- **Post-US1**: Administrators can authenticate and browse clients
- **Post-US2**: Administrators can also view current configurations  
- **Post-US3**: Complete configuration management capability

### Parallel Development Strategy
After foundational phase (T005-T015):
- **Team A**: Focus on User Story 1 implementation (T019-T025)
- **Team B**: Work on User Story 1 tests (T016-T018) 
- **Team C**: Begin User Story 2 preparation and tests (T026-T028)

This approach maximizes development velocity while maintaining story independence.
# Research Findings: WhatsApp Client Configuration Management

**Phase 0 Output** | **Date**: March 26, 2026

## Research Areas

Based on technical context analysis and feature requirements, the following areas required research to inform implementation decisions:

1. **Existing Client Configuration Architecture** 
2. **WhatsApp Message Handler Integration Patterns**
3. **Session Management Best Practices**
4. **Configuration Validation Approaches**
5. **Q&A Workflow Implementation Patterns**

---

## Findings

### **Decision: Client Configuration Storage Model**

**Rationale**: Adopt existing key-value configuration pattern with caching layer
- **Existing Schema**: `client_config` table with (client_id, config_key, config_value) 
- **Service Layer**: Cached lookups with cascade to DEFAULT client
- **Access Pattern**: Repository → Service with 60-second TTL cache

**Alternatives Considered**:
- JSON blob storage: Rejected due to lack of query flexibility  
- Separate tables per config group: Rejected due to schema complexity

**Implementation Choice**: Extend existing [src/service/clientConfigService.js](src/service/clientConfigService.js) and [src/repository/clientConfigRepository.js](src/repository/clientConfigRepository.js) patterns

---

### **Decision: WhatsApp Handler Integration**

**Rationale**: Follow established command recognition and routing patterns
- **Entry Point**: Integrate with [src/service/waService.js](src/service/waService.js) message listener  
- **Deduplication**: Use [src/service/waEventAggregator.js](src/service/waEventAggregator.js) (24h TTL, 10k entry cap)
- **Command Recognition**: Text pattern matching for "/config", "CONFIG", "configure"
- **JID Routing**: Direct messages only (@s.whatsapp.net), filter groups/newsletters
- **Outbound Messages**: Use [src/service/waOutbox.js](src/service/waOutbox.js) BullMQ rate-limited queue (40 msg/min)

**Alternatives Considered**: 
- Natural language parsing: Rejected due to complexity and reliability concerns
- HTTP webhook trigger: Rejected due to security requirements (self-messaging only)

**Implementation Choice**: New waClientConfigHandler.js following auto-response service patterns

---

### **Decision: Session State Management**

**Rationale**: Database-backed sessions with TTL for reliability across restarts
- **Storage Model**: New `client_config_sessions` table similar to `operator_registration_sessions`
- **State Machine**: `selecting_client` → `viewing_config` → `modifying_config` → `confirming_changes`
- **Session Data**: Store session_id, phone_number, stage, client_id, pending_changes, expires_at
- **TTL Strategy**: 10-minute default with extension capability via timeout warnings
- **Cleanup**: Periodic purge of expired sessions

**Alternatives Considered**:
- In-memory sessions: Rejected due to loss on service restart 
- Redis-backed sessions: Rejected to minimize external dependencies

**Implementation Choice**: Repository pattern with upsert logic matching existing session management

---

### **Decision: Configuration Validation**

**Rationale**: Basic validation with format rules using established patterns
- **Input Parsing**: Use existing [src/utils/handleNormalizer.js](src/utils/handleNormalizer.js) patterns for URL/handle validation
- **Token Recognition**: Yes/No tokens following [src/service/operatorRegistrationService.js](src/service/operatorRegistrationService.js) pattern
- **Type Validation**: Numeric parsing for ports, boolean parsing for flags, URL validation for endpoints
- **Error Messages**: Professional language with specific guidance, similar to registration flow

**Alternatives Considered**:
- Schema validation libraries: Rejected for simplicity and consistency 
- Complex business rule validation: Deferred to basic format-only validation

**Implementation Choice**: New configValidator.js utility following existing normalization patterns

---

### **Decision: Q&A Workflow Architecture**

**Rationale**: State machine approach with sequential message flows
- **Flow Control**: Multi-stage dialog similar to operator registration workflow
- **Response Sequencing**: Multiple queued messages via waOutbox enqueueSend() 
- **Configuration Grouping**: Present logical groups (connection → message handling → notifications → automation)
- **Progress Tracking**: Session state tracks current group and parameter being configured
- **Rollback Support**: Store pending changes separately from committed configuration

**Alternatives Considered**:
- Single-message configuration: Rejected due to complexity and user experience
- Menu-driven selection: Rejected due to WhatsApp text interface limitations

**Implementation Choice**: State machine with professional messaging templates stored in client_config

---

## Technology Integration Points

### **Required Database Migrations**

1. **client_config_sessions table**: Store workflow state with TTL
2. **Indexes**: Add performance indexes for session lookups by phone_number
3. **Configuration templates**: Add default Q&A text templates to client_config DEFAULT client

### **Service Layer Integration** 

- **Extend**: [src/service/clientConfigService.js](src/service/clientConfigService.js) with Q&A workflow methods
- **New**: configSessionService.js for session state management
- **New**: waClientConfigService.js for WhatsApp message workflow orchestration

### **Handler Layer Integration**

- **New**: [src/handler/waClientConfigHandler.js](src/handler/waClientConfigHandler.js) following established patterns
- **Integration**: Register handler in waService.js message listener chain

### **Testing Strategy**

- **Unit Tests**: Jest tests for all service and repository classes
- **Integration Tests**: WhatsApp handler flow testing with mocked waClient 
- **Session Tests**: State machine transition verification
- **Validation Tests**: Input parsing and error handling verification

---

**Research Complete** - All implementation decisions informed by existing architectural patterns
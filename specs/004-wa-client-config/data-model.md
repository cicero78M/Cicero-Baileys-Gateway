# Data Model: WhatsApp Client Configuration Management

**Phase 1 Output** | **Date**: March 26, 2026  
**Source**: [Feature Specification](spec.md)

## Entity Definitions

### **ClientConfiguration**

Represents configuration settings for a specific WhatsApp client, organized in logical groups.

**Attributes**:
- `client_id` (string, required): References existing clients table
- `config_key` (string, required): Hierarchical key identifying specific configuration parameter  
- `config_value` (text, required): Serialized configuration value (string, numeric, JSON)
- `description` (text, optional): Human-readable description of configuration purpose
- `config_group` (string, required): Logical grouping (connection, message_handling, notifications, automation_rules)
- `validation_pattern` (string, optional): Regex or validation rule for input validation
- `created_at` (timestamp, required): Configuration creation timestamp
- `updated_at` (timestamp, required): Last modification timestamp

**Relationships**:
- Belongs to Client (via client_id foreign key)
- Uses Default fallback pattern (DEFAULT client_id for system defaults)

**Validation Rules**:
- Primary key: (client_id, config_key) - enforces uniqueness per client
- config_key format: `{group}.{parameter}` (e.g., "connection.host", "notifications.enabled")
- config_group must be one of: connection, message_handling, notifications, automation_rules

**State Transitions**:
- Created → Active (when added to client)
- Active → Modified (when updated via Q&A workflow)
- Modified → Active (after confirmation and commit)

---

### **ConfigurationSession**

Tracks active configuration workflow sessions between administrators and the system.

**Attributes**:
- `session_id` (string, primary key): UUID identifying unique session
- `phone_number` (string, required): WhatsApp number of administrator
- `client_id` (string, required): Target client being configured  
- `current_stage` (string, required): Current workflow stage
- `configuration_group` (string, optional): Current logical group being configured
- `pending_changes` (jsonb, optional): Uncommitted configuration changes  
- `original_state` (jsonb, optional): Backup of original configuration for rollback
- `timeout_extensions` (integer, default 0): Number of session extensions granted
- `expires_at` (timestamp, required): Session expiry time (10-minute default)
- `created_at` (timestamp, required): Session creation timestamp
- `updated_at` (timestamp, required): Last activity timestamp

**Relationships**:
- References Client (via client_id)
- Associated with Administrator Authorization (via phone_number)

**Validation Rules**:
- phone_number must exist in linked administrator registry
- expires_at must be future timestamp
- current_stage must be valid workflow stage
- Only one active session per phone_number allowed

**State Transitions**:
- Created (selecting_client) → Client Selected (viewing_config) → Modifying (modifying_config) → Confirming (confirming_changes) → Completed (session deleted)
- Any stage → Extended (timeout_warning → session_extended)
- Any stage → Rollback (if client becomes inactive)
- Any stage → Expired (session cleanup)

**Valid Stages**:
- `selecting_client`: Choosing from active client list  
- `viewing_config`: Displaying current configuration
- `modifying_config`: Interactive Q&A for parameter changes
- `confirming_changes`: Final confirmation before commit
- `timeout_warning`: Extension prompt state

---

### **AdministratorAuthorization**

Links WhatsApp numbers to server access permissions for configuration management.

**Attributes**:
- `phone_number` (string, primary key): WhatsApp number in international format
- `is_authorized` (boolean, required): Whether number can access config management
- `client_access_scope` (jsonb, optional): Array of client IDs this admin can configure
- `permission_level` (string, required): Access level (full, readonly, specific_clients)
- `created_at` (timestamp, required): Authorization grant timestamp
- `updated_at` (timestamp, required): Last permission modification

**Relationships**:
- Has many ConfigurationSessions (via phone_number)
- Referenced by audit logs for change tracking

**Validation Rules**:
- phone_number format: +[country][number] (e.g., +6281234567890)
- permission_level must be one of: full, readonly, specific_clients
- client_access_scope required when permission_level = specific_clients

**State Transitions**:
- Created → Active (when phone number linked to server)
- Active → Suspended (temporary access removal)
- Suspended → Active (access restoration)
- Active → Revoked (permanent removal)

---

### **ConfigurationAuditLog**

Records all configuration changes with administrator identification and timestamps.

**Attributes**:
- `log_id` (serial, primary key): Unique audit log identifier
- `session_id` (string, required): References configuration session
- `client_id` (string, required): Affected client
- `phone_number` (string, required): Administrator who made change
- `action_type` (string, required): Type of action performed
- `config_key` (string, optional): Specific configuration key modified  
- `old_value` (text, optional): Previous configuration value
- `new_value` (text, optional): Updated configuration value
- `change_summary` (text, required): Human-readable description of change
- `created_at` (timestamp, required): Action timestamp

**Relationships**:
- References ConfigurationSession (via session_id)
- References Client (via client_id)  
- References AdministratorAuthorization (via phone_number)

**Validation Rules**:
- action_type must be one of: view_config, start_session, modify_config, confirm_changes, rollback_session, extend_session
- For modify_config action: config_key, old_value, new_value required
- change_summary required for all actions

**State Transitions**:
- Immutable (audit records are write-once, never updated or deleted)

---

## Logical Relationships

```text
AdministratorAuthorization (phone_number)
    ||
    || 1:M
    ||
ConfigurationSession (session_id, phone_number, client_id)
    ||                ||
    || 1:M            || M:1  
    ||                ||
ConfigurationAuditLog (log_id, session_id) → Client (client_id)
                                               ||
                                               || 1:M
                                               ||
                                           ClientConfiguration (client_id, config_key)
```

## Storage Implementation

### **Database Tables**

Based on research findings, extend existing schema patterns:

**New Tables**:
- `client_config_sessions` - Configuration session state storage
- `administrator_authorization` - WhatsApp number permissions  
- `client_config_audit_log` - Change tracking and compliance

**Extended Tables**:
- `client_config` - Add config_group and validation_pattern columns

### **Caching Strategy** 

Following existing [clientConfigService.js](../../../src/service/clientConfigService.js) pattern:
- In-memory TTL cache (60-second expiry) for configuration lookups
- Session state cached during active workflow (cleared on completion)
- Administrator authorization cached with longer TTL (300 seconds)

### **Index Strategy**

Performance indexes based on access patterns:
- `client_config_sessions (phone_number, expires_at)` - Active session lookups
- `client_config (client_id, config_group)` - Grouped configuration retrieval  
- `client_config_audit_log (client_id, created_at DESC)` - Change history queries
- `administrator_authorization (phone_number)` - Permission checks

## Data Flow Patterns

### **Configuration Retrieval Flow**
1. Administrator request → Session validation → Client selection
2. Client configurations grouped by config_group → Display formatting  
3. Cache-first lookup with DATABASE fallback (60s TTL)
4. DEFAULT client cascade for missing client-specific values

### **Configuration Modification Flow**  
1. Session state update → Pending changes accumulation → Validation
2. Multi-parameter Q&A workflow → Rollback capability preservation
3. Final confirmation → Atomic commit → Audit log creation
4. Cache invalidation → Session cleanup → Success notification

### **Session Lifecycle Flow**
1. Command recognition → Authorization check → Session creation (10min TTL)
2. State machine transitions → Activity timestamp updates → Extension handling
3. Completion or timeout → Session deletion → Audit trail preservation
4. Background cleanup → Expired session purging → Resource reclamation
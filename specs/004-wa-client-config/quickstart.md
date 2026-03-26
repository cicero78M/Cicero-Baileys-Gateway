# Quick Start: WhatsApp Client Configuration Management

**For**: Developers and Administrators  
**Date**: March 26, 2026

## Overview

WhatsApp-based client configuration management allows authorized administrators to view and modify client settings through secure self-messaging. Administrators send configuration commands to their own WhatsApp number to access an interactive Q&A workflow.

## For Administrators

### **Getting Access**

1. **Link WhatsApp Number**: Ensure your WhatsApp number is registered with the server administrator
2. **Verify Authorization**: Confirm your number appears in the administrator authorization table
3. **Test Access**: Send `/config` to yourself to verify you receive a client list response

### **Basic Usage Workflow**

```text
1. Send command:     /config
2. Select client:    2  
3. Choose action:    yes (to modify)
4. Select group:     1 (connection settings)
5. Modify parameter: Enter new values when prompted
6. Confirm changes:  yes (to apply)
```

### **Available Configuration Groups**

| Group | Parameters | Examples |
|-------|------------|----------|
| **Connection** | Host, Port, SSL, Timeout | gateway.example.com, 8080, Yes, 30s |
| **Message Handling** | Queue Size, Retry Count, Rate Limits | 1000, 3, 40/min |
| **Notifications** | Alerts, Reports, Status Updates | Enabled/Disabled |  
| **Automation** | Auto-Response, Processing Rules | Complaint handling, Task broadcast |

### **Session Management**

- **Session Duration**: 10 minutes default
- **Extension**: Reply "extend" when prompted for +10 minutes  
- **Concurrent Access**: Queued if another admin is configuring same client
- **Timeout Recovery**: Restart with `/config` if session expires

### **Safety Features**

- ✅ **Preview Changes**: See all modifications before applying
- ✅ **Rollback Protection**: Changes cancelled if client goes offline  
- ✅ **Audit Trail**: All changes logged with administrator identification
- ✅ **Self-Messaging Only**: Commands only work when sent to yourself

## For Developers

### **Prerequisites**

- Node.js 20+ 
- PostgreSQL (existing schema)
- Redis (existing connection)
- Jest for testing

### **Quick Setup**

```bash
# 1. Run database migrations
node scripts/run_migration.js sql/migrations/YYYYMMDD_add_client_config_tables.sql
node scripts/run_migration.js sql/migrations/YYYYMMDD_add_config_session_tables.sql

# 2. Install dependencies (if any new ones needed)
npm install

# 3. Run tests
npm test -- --testPathPattern="waClientConfig"

# 4. Start development server
npm run dev
```

### **Architecture Overview**

```text
WhatsApp Message → waService.js → waClientConfigHandler.js
                                      ↓
                                waClientConfigService.js ← configSessionService.js  
                                      ↓                          ↓
                            clientConfigRepository.js    configSessionRepository.js
                                      ↓                          ↓
                               PostgreSQL (client_config)  PostgreSQL (sessions)
```

### **Key Integration Points**

**Message Handler Registration** (src/service/waService.js):
```javascript
import { handleClientConfigMessage } from '../handler/waClientConfigHandler.js';

// Add to message listener chain
if (await handleClientConfigMessage(messageData)) {
  return; // Message handled
}
```

**Configuration Access** (any service):
```javascript
import { getConfig, setConfig } from '../service/clientConfigService.js';

const hostValue = await getConfig('CLIENT_001', 'connection.host');
await setConfig('CLIENT_001', 'connection.host', 'new.host.com');
```

**Session State Management**:
```javascript
import { createConfigSession, updateSessionStage } from '../service/configSessionService.js';

const sessionId = await createConfigSession(phoneNumber, clientId);
await updateSessionStage(sessionId, 'viewing_config');
```

### **File Structure**

```text
src/
├── handler/waClientConfigHandler.js      # WhatsApp message routing
├── service/
│   ├── waClientConfigService.js          # Main workflow orchestration  
│   └── configSessionService.js           # Session state management
├── repository/
│   ├── clientConfigRepository.js         # EXTENDS existing file
│   └── configSessionRepository.js        # NEW: Session CRUD
└── model/
    ├── clientConfigModel.js              # EXTENDS existing file
    └── configSessionModel.js             # NEW: Session schema helpers

sql/migrations/
├── YYYYMMDD_add_client_config_tables.sql # Schema changes
└── YYYYMMDD_add_config_session_tables.sql # Session tables

tests/
├── unit/waClientConfigHandler.test.js     # Handler tests
├── unit/waClientConfigService.test.js     # Service tests  
└── integration/waClientConfig.integration.test.js # End-to-end tests
```

### **Database Schema**

**New Tables:**
```sql
-- Configuration sessions
CREATE TABLE client_config_sessions (
  session_id VARCHAR(36) PRIMARY KEY,
  phone_number VARCHAR(30) NOT NULL,
  client_id VARCHAR(100) NOT NULL,
  current_stage VARCHAR(50) NOT NULL,
  configuration_group VARCHAR(50),
  pending_changes JSONB,
  original_state JSONB,
  timeout_extensions INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Administrator authorization  
CREATE TABLE administrator_authorization (
  phone_number VARCHAR(30) PRIMARY KEY,
  is_authorized BOOLEAN NOT NULL DEFAULT true,
  client_access_scope JSONB,
  permission_level VARCHAR(20) NOT NULL DEFAULT 'full',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logging
CREATE TABLE client_config_audit_log (
  log_id SERIAL PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  client_id VARCHAR(100) NOT NULL,
  phone_number VARCHAR(30) NOT NULL,
  action_type VARCHAR(30) NOT NULL,
  config_key VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  change_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Extended Columns:**
```sql
-- Add to existing client_config table
ALTER TABLE client_config ADD COLUMN config_group VARCHAR(50);
ALTER TABLE client_config ADD COLUMN validation_pattern VARCHAR(200);
```

## Testing

### **Unit Testing**

```bash
# Test specific components
npm test -- waClientConfigHandler.test.js
npm test -- configSessionService.test.js

# Test with coverage  
npm test -- --coverage --testPathPattern="waClientConfig"
```

### **Integration Testing**

```bash
# End-to-end workflow testing
npm test -- waClientConfig.integration.test.js

# Test with Database (requires test DB setup)
npm test -- --testPathPattern="integration" --runInBand
```

### **Manual Testing WhatsApp Flow**

1. **Setup Test Environment**: 
   - Ensure WhatsApp client connected and ready
   - Add your phone number to administrator_authorization table
   - Create test client entries in clients table

2. **Test Basic Flow**:
   - Send `/config` to yourself
   - Verify client list response  
   - Complete full modification workflow
   - Check audit logs in database

3. **Test Error Cases**:
   - Send from unauthorized number (should get no response)
   - Let session timeout (should get timeout warning)
   - Send invalid input during Q&A (should get validation errors)

## Deployment

### **Migration Steps**

1. **Database**: Run migration scripts during maintenance window
2. **Code Deployment**: Standard deployment process (Docker or PM2)
3. **Configuration**: Verify administrator_authorization table populated  
4. **Validation**: Test configuration access with authorized administrator
5. **Monitoring**: Check logs for successful handler registration

### **Rollback Plan**

1. **Code Rollback**: Deploy previous version
2. **Database Rollback**: Run reverse migration scripts (if needed)
3. **Session Cleanup**: Clear any active configuration sessions
4. **Verification**: Confirm system returns to previous functionality

## Troubleshooting

### **Common Issues**

| Issue | Symptom | Solution |
|-------|---------|----------|
| No response to `/config` | Silent failure | Check administrator_authorization table |
| Session timeout too quickly | Workflow interrupted | Verify session TTL configuration |
| Configuration not saving | Changes lost | Check PostgreSQL connection and permissions |
| Validation errors | Can't save values | Review configValidator.js patterns |

### **Debug Commands**

```sql  
-- Check active sessions
SELECT * FROM client_config_sessions WHERE expires_at > NOW();

-- View recent audit logs
SELECT * FROM client_config_audit_log ORDER BY created_at DESC LIMIT 10;

-- Check administrator permissions
SELECT * FROM administrator_authorization WHERE phone_number = '+1234567890';
```

### **Logging**

Monitor these log patterns:
- `waClientConfig: session created` - New configuration sessions
- `waClientConfig: config modified` - Configuration changes
- `waClientConfig: session expired` - Timeout events
- `waClientConfig: unauthorized access` - Security violations

## Next Steps

1. **Review [Feature Specification](spec.md)** for complete requirements
2. **Study [Data Model](data-model.md)** for entity relationships
3. **Examine [WhatsApp Interface Contract](contracts/whatsapp-interface.md)** for message flows
4. **Follow established patterns** from existing auto-response services
5. **Implement incrementally** following TDD practices with Jest tests

---

**Ready to start development?** Begin with handler implementation following existing src/handler/ patterns.
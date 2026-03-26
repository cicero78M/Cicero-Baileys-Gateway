# WhatsApp Message Interface Contract

**Type**: WhatsApp Text Message Interface  
**Version**: 1.0  
**Date**: March 26, 2026

## Overview

Defines the conversational interface contract for WhatsApp-based client configuration management. Administrators interact with the system through structured text messages sent to themselves.

## Security Model

**Authentication**: Self-messaging only (administrator sends messages to their own WhatsApp number)  
**Authorization**: Phone number must be linked to server and registered in administrator_authorization table  
**Access Control**: Per-administrator client access scope enforcement

## Command Interface

### **Initiation Commands**

**Trigger Patterns**:
```text
/config
CONFIG  
configure
```

**Security Validation**:
- Message sender JID must match administrator's registered WhatsApp number
- JID format: {phone_number}@s.whatsapp.net (direct messages only)  
- Group messages (@g.us) and newsletter messages (@newsletter) are filtered out

**Response Contract**:
```text
--- SUCCESS RESPONSE ---
🔧 CLIENT CONFIGURATION MANAGEMENT

Available active clients:
1. CLIENT_001 (Production Gateway)
2. CLIENT_002 (Development Gateway)  
3. CLIENT_003 (Staging Gateway)

Reply with the number (1-3) to select a client for configuration.

Session expires in 10 minutes.
```

```text
--- NO ACTIVE CLIENTS ---
⚠️ CLIENT CONFIGURATION MANAGEMENT

No active clients available for configuration at this time.

Please ensure at least one client is running and try again.
```

```text  
--- UNAUTHORIZED ACCESS ---
(No response - silent rejection for unauthorized phone numbers)
```

## Session Workflow Contract

### **Stage 1: Client Selection**

**Input Contract**:
```text
Pattern: Single numeric digit (1-N where N is number of available clients)
Example: "2"
```

**Response Contract**:
```text
--- VALID SELECTION ---
📋 CURRENT CONFIGURATION - CLIENT_002

🔗 CONNECTION SETTINGS:
• Host: gateway.example.com  
• Port: 8080
• SSL Enabled: Yes
• Timeout: 30 seconds

📨 MESSAGE HANDLING:
• Max Queue Size: 1000
• Retry Attempts: 3  
• Rate Limit: 40 messages/minute

🔔 NOTIFICATIONS:
• Status Alerts: Enabled
• Error Notifications: Enabled
• Daily Reports: Disabled

⚙️ AUTOMATION RULES:
• Auto-Response: Enabled
• Complaint Processing: Enabled
• Task Broadcasting: Enabled

Would you like to modify any configuration settings? (yes/no)
```

```text
--- INVALID SELECTION ---
❌ Invalid selection. Please choose a number between 1-3.

Available active clients:
1. CLIENT_001 (Production Gateway)
2. CLIENT_002 (Development Gateway)
3. CLIENT_003 (Staging Gateway)

Reply with the number (1-3) to select a client.
```

### **Stage 2: Modification Confirmation**

**Input Contract**:
```text
Positive: yes, ya, iya, y, ok, okay, setuju, benar, betul, modify
Negative: no, tidak, n, batal, cancel, stop, tolak, skip
```

**Response Contract**:
```text
--- MODIFICATION ACCEPTED ---
🛠️ CONFIGURATION MODIFICATION

Which configuration group would you like to modify?

1. CONNECTION SETTINGS
2. MESSAGE HANDLING  
3. NOTIFICATIONS
4. AUTOMATION RULES

Reply with the number (1-4) to select a group.
```

```text
--- MODIFICATION DECLINED ---
✅ Configuration review completed.

No changes made to CLIENT_002 configuration.
Session ended.
```

### **Stage 3: Group Selection & Parameter Modification**

**Input Contract**:
```text  
Pattern: Single numeric digit (1-4 for configuration groups)
Example: "1"
```

**Response Contract**:
```text
--- GROUP SELECTED - CONNECTION SETTINGS ---
🔗 CONNECTION SETTINGS CONFIGURATION

Current values:
1. Host: gateway.example.com
2. Port: 8080
3. SSL Enabled: Yes
4. Timeout: 30 seconds

Which parameter would you like to modify? (1-4)
Or reply "back" to choose a different group.
```

**Parameter Modification Contract**:
```text
--- PARAMETER MODIFICATION PROMPT ---
🔧 MODIFY HOST

Current value: gateway.example.com

Enter new host address:
• Must be valid hostname or IP address
• Example: api.newgateway.com

Or reply "cancel" to skip this parameter.
```

**Validation Response Contract**:
```text
--- VALID INPUT ---
✅ Host updated to: api.newgateway.com

Continue with next parameter? (yes/no)
```

```text
--- INVALID INPUT ---  
❌ Invalid host format.

Host must be:
• Valid hostname (example.com) 
• Valid IP address (192.168.1.1)
• No spaces or special characters

Please enter a valid host address:
```

### **Stage 4: Change Confirmation**

**Input Contract**:
```text
Confirmation: yes, ya, confirm, apply, save
Rejection: no, cancel, rollback, discard
```

**Response Contract**:
```text
--- CONFIRMATION PROMPT ---
📝 CONFIGURATION CHANGES SUMMARY

CLIENT_002 - Pending Changes:
• Host: gateway.example.com → api.newgateway.com
• Port: 8080 → 9090
• SSL Enabled: Yes → No

Apply these changes? (yes/no)

⚠️ Changes will take effect immediately and may require client restart.
```

```text
--- CHANGES APPLIED ---
✅ CONFIGURATION UPDATED SUCCESSFULLY

CLIENT_002 configuration has been updated with 3 changes:
• Host: api.newgateway.com
• Port: 9090  
• SSL Enabled: No

Changes logged for audit trail.
Session completed.
```

```text
--- CHANGES REJECTED ---
🚫 Configuration changes discarded.

CLIENT_002 configuration remains unchanged.
Session ended.
```

## Error Handling Contract

### **Session Timeout**

**Warning Message** (8 minutes into session):
```text
⏰ SESSION TIMEOUT WARNING

Your configuration session expires in 2 minutes.

Reply "extend" to add 10 more minutes, or continue with your current task.
```

**Extension Response**:
```text
⏰ SESSION EXTENDED

Session timeout extended by 10 minutes.
Current task: CLIENT_002 Connection Settings modification

Please continue.
```

**Timeout Expiry**:
```text
⏱️ SESSION EXPIRED

Your configuration session has timed out.
No changes were applied to CLIENT_002.

Send /config to start a new session.
```

### **Client Inactive During Session**

```text
⚠️ CLIENT UNAVAILABLE  

CLIENT_002 became inactive during configuration.
All pending changes have been rolled back.

No configuration changes were applied.
Session ended.
```

### **Concurrent Access Conflict**

```text
🚦 CONFIGURATION IN PROGRESS

Another administrator is currently configuring CLIENT_002.

Your request has been queued. Estimated wait time: 3 minutes.

You will receive a notification when it's your turn.
```

## Technical Interface Details

### **Message Routing Requirements**

- All messages processed through waEventAggregator for deduplication (24h TTL)
- Outbound messages queued via waOutbox (BullMQ, 40 messages/minute rate limit)
- Session state persisted to PostgreSQL (survives service restarts)
- Professional language templates loaded from client_config DEFAULT values

### **Session State Persistence**

```sql
-- Session state storage format
{
  "session_id": "uuid-v4",
  "phone_number": "+6281234567890", 
  "client_id": "CLIENT_002",
  "current_stage": "modifying_config",
  "configuration_group": "connection",
  "pending_changes": {
    "connection.host": {
      "old_value": "gateway.example.com",
      "new_value": "api.newgateway.com"  
    }
  },
  "timeout_extensions": 1,
  "expires_at": "2026-03-26T15:30:00Z"
}
```

### **Audit Logging Contract**

Every configuration change generates audit log entry:
```sql
-- Audit log entry format
{
  "session_id": "uuid-v4",
  "client_id": "CLIENT_002", 
  "phone_number": "+6281234567890",
  "action_type": "modify_config",
  "config_key": "connection.host",
  "old_value": "gateway.example.com",
  "new_value": "api.newgateway.com", 
  "change_summary": "Host address updated via WhatsApp configuration workflow"
}
```

## Interface Compatibility

**WhatsApp Client Compatibility**: Baileys library interface  
**Message Format**: Plain text only (no rich media, buttons, or interactive elements)  
**Character Limits**: Standard WhatsApp message limits (4096 characters)  
**Response Time**: Target <5 seconds for configuration display, <3 seconds for command acknowledgment

## Version History

- **v1.0** (2026-03-26): Initial WhatsApp configuration interface contract
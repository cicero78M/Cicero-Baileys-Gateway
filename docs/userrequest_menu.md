# User Request Menu - Documentation

Last updated: 2026-02-08

## Overview

The `userrequest` menu is a WhatsApp-based interactive flow that allows users to:
1. Register their WhatsApp number by linking it to their NRP/NIP
2. View their profile information
3. Update their profile data (nama, pangkat, satfung, jabatan, Instagram, TikTok, desa binaan)

## Architecture

### Files Structure

```
src/
├── handler/
│   └── menu/
│       ├── userMenuHandlers.js        # Main menu handlers and flow logic
│       ├── userMenuValidation.js      # Input validation functions
│       └── userMenuHelpers.js         # Display formatting helpers
├── service/
│   └── waService.js                   # Entry point, detects "userrequest" command
└── model/
    └── userModel.js                   # Database operations for user data
```

### Key Components

#### 1. userMenuHandlers.js
Contains all step handlers for the user menu flow:
- `main` - Entry point, determines user's registration status
- `confirmUserByWaIdentity` - Confirms user identity
- `inputUserId` - Handles manual NRP/NIP input
- `confirmBindUser` - Confirms WhatsApp number binding
- `tanyaUpdateMyData` - Asks if user wants to update data
- `confirmUserByWaUpdate` - Confirms before showing update fields
- `updateAskField` - Field selection menu
- `updateAskValue` - Handles field value input and validation

#### 2. userMenuValidation.js
Centralized validation logic:
- `validateNRP()` - Validates NRP/NIP (6-18 digits)
- `validateTextField()` - Validates text fields with length limits
- `validateInstagram()` - Validates Instagram username/URL
- `validateTikTok()` - Validates TikTok username/URL
- `validateListSelection()` - Validates selection from numbered list

#### 3. userMenuHelpers.js
Display formatting utilities:
- `formatUserReport()` - Formats user data for display
- `getFieldInfo()` - Gets field display name and current value
- `formatFieldList()` - Formats field selection menu
- `formatFieldUpdatePrompt()` - Formats update prompt with current value
- `formatUpdateSuccess()` - Formats success message
- `formatOptionsList()` - Formats numbered options list

## User Flow

### Flow A: Registered User (WhatsApp found in database)

```
1. User sends "userrequest"
   ↓
2. System finds WhatsApp number → Shows user data
   ↓
3. User confirms identity (ya/tidak)
   ↓ (ya)
4. System asks: Want to update data?
   ↓ (ya)
5. Show field selection menu (1-7)
   ↓
6. User selects field (e.g., "2" for Pangkat)
   ↓
7. System shows current value + input prompt
   ↓
8. User enters new value
   ↓
9. System validates and updates
   ↓
10. Return to step 2 (show updated data)
```

### Flow B: New User (WhatsApp not found)

```
1. User sends "userrequest"
   ↓
2. System prompts for NRP/NIP
   ↓
3. User enters NRP/NIP (e.g., "87020990")
   ↓
4. System validates (6-18 digits)
   ↓
5. System finds user in database
   ↓
6. System asks: Link WhatsApp to this account?
   ↓ (ya)
7. System updates whatsapp field → Shows user data
   ↓
8. Continue to Flow A step 4
```

## Field Validation Rules

| Field | Min Length | Max Length | Format | Additional Validation |
|-------|-----------|-----------|--------|---------------------|
| NRP/NIP | 6 digits | 18 digits | Numbers only | Must exist in database |
| Nama | 2 chars | 100 chars | Uppercase (auto-converted) | - |
| Pangkat | - | - | From predefined list | Case-insensitive match |
| Satfung | - | - | From predefined list | Case-insensitive match |
| Jabatan | 2 chars | 100 chars | Uppercase (auto-converted) | - |
| Instagram | 1 char | 30 chars | Lowercase alphanumeric | No reserved usernames, no duplicates |
| TikTok | 1 char | 30 chars | Lowercase alphanumeric | No duplicates |
| Desa Binaan | 2 chars | 100 chars | Uppercase (auto-converted) | Only for Ditbinmas users |

**Note**: Text fields (Nama, Jabatan, Desa) are automatically converted to uppercase to match database conventions. If future fields require different casing, the `validateTextField()` function should be extended with a casing parameter.

## Error Handling

### Validation Errors
- User-friendly error messages with examples
- No internal error details exposed
- Clear instructions on how to fix

### Database Errors
- Logged with context (handler name, user info)
- Generic user-facing message
- Session maintained (no crash)

### Network Errors (Google Contacts)
- Non-critical errors are logged and ignored
- User update succeeds even if contact save fails

## Session Management

### Session Data Structure
```javascript
{
  menu: "userrequest",
  step: "main",                    // Current step in flow
  user_id: "87020990",            // User's NRP/NIP
  identityConfirmed: true,        // Whether user confirmed identity
  isDitbinmas: false,             // Whether user is in Ditbinmas
  updateField: "pangkat",         // Currently updating field
  updateUserId: "87020990",       // User ID for update
  bindUserId: "87020990",         // User ID for binding
  availableTitles: [],            // Cached pangkat list
  availableSatfung: [],           // Cached satfung list
  exit: false,                    // Session exit flag
}
```

### Timeout Behavior
- Session timeout: 5 minutes
- Warning at 4 minutes
- Auto-cleanup on timeout
- User must restart with "userrequest"

## Best Practices Applied

### 1. Input Validation
✅ Centralized validation functions
✅ Consistent error messages
✅ Length limits on all text fields
✅ Reserved username protection
✅ Duplicate detection

### 2. Error Handling
✅ Try-catch blocks on all database operations
✅ Separate critical vs non-critical errors
✅ Context logging for debugging
✅ User-friendly error messages
✅ Graceful degradation

### 3. User Experience
✅ Show current values before updates
✅ Clear examples in prompts
✅ Visual indicators (emojis)
✅ Consistent message format
✅ Progress indication
✅ Multiple ways to cancel (batal, tidak)

### 4. Code Quality
✅ Separated concerns (validation, display, logic)
✅ Reusable helper functions
✅ Consistent naming conventions
✅ Comprehensive documentation
✅ No magic numbers/strings

### 5. Security
✅ No internal errors exposed
✅ Input sanitization
✅ Length limits prevent DoS
✅ Reserved username protection
✅ Parameterized queries (inherited from userModel)

## Common Issues & Solutions

### Issue: User can't find their data
**Solution**: Check if NRP/NIP is correct in database. User should contact Opr Humas Polres.

### Issue: Instagram/TikTok already registered
**Solution**: User should use different account or contact operator to unlink old account.

### Issue: Session timeout
**Solution**: User restarts by typing "userrequest" again.

### Issue: Validation error not clear
**Solution**: Check error messages include examples and clear instructions.

## Testing Checklist

- [ ] New user registration flow
- [ ] Existing user update flow
- [ ] Invalid NRP/NIP handling
- [ ] Duplicate Instagram/TikTok detection
- [ ] Field validation (each field type)
- [ ] Session timeout handling
- [ ] Cancel at each step
- [ ] Database error handling
- [ ] Ditbinmas-specific fields
- [ ] Multiple updates in one session

## Future Improvements

### Potential Enhancements
1. **Rate Limiting**: Prevent user enumeration attacks
2. **Audit Trail**: Log all profile changes with timestamp
3. **Multi-field Update**: Allow updating multiple fields at once
4. **Session Recovery**: Resume after timeout
5. **Phone Verification**: Confirm WhatsApp ownership via OTP
6. **Undo Changes**: Allow reverting recent updates
7. **Change History**: Show user their recent changes
8. **Admin Override**: Allow operators to force-bind numbers

### Performance Optimizations
1. Cache frequently accessed data (pangkat list, satfung list)
2. Batch database updates if multiple fields changed
3. Async contact saving to reduce latency

## Maintenance Notes

### When Adding New Field
1. Add validation to `userMenuValidation.js`
2. Add helper to `userMenuHelpers.js`
3. Update `allowedFields` array in `updateAskField`
4. Update `getFieldInfo` mapping
5. Add test cases
6. Update this documentation

### When Changing Validation Rules
1. Update validation function in `userMenuValidation.js`
2. Update `FIELD_LIMITS` constants
3. Update error messages
4. Test thoroughly
5. Update documentation

## References

- [User Registration Guide](./wa_user_registration.md)
- [Database Structure](./database_structure.md)
- [Naming Conventions](./naming_conventions.md)
- [WhatsApp Best Practices](./wa_best_practices.md)

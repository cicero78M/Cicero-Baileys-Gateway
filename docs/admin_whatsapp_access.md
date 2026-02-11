# ADMIN_WHATSAPP Access Control Documentation

## Overview

The system provides **multiple access mechanisms** for `oprrequest` menu. The `dirrequest` menu is now **accessible from all WhatsApp numbers** without any authorization restrictions.

**Important:** The admin number `6281235114745` must be included in the `ADMIN_WHATSAPP` environment variable to have access to the `oprrequest` menu.

## Configuration

### Environment Variable

Add admin WhatsApp numbers to your `.env` file:

```env
# Include 6281235114745 and other admin numbers
ADMIN_WHATSAPP=6281235114745,628123456789,628987654321
```

**Format:**
- Comma-separated list of WhatsApp numbers
- Numbers should start with country code (e.g., 62 for Indonesia)
- Numbers can be with or without `@c.us` suffix (system normalizes them)

### Example Configurations

```env
# Single admin (the required admin number)
ADMIN_WHATSAPP=6281235114745

# Multiple admins (including the required admin number)
ADMIN_WHATSAPP=6281235114745,628123456789,628987654321

# With @c.us suffix (also works)
ADMIN_WHATSAPP=6281235114745@c.us,628123456789@c.us
```

## Access Mechanisms

### oprrequest Menu

Users can access the `oprrequest` menu through **three mechanisms** (checked in order):

1. **ADMIN_WHATSAPP** (Highest Priority)
   - Location: `src/service/waService.js` line ~2352
   - Check: `isAdminWhatsApp(chatId)`
   - Behavior: Shows client selection menu for all org-type clients
   - Implementation: Calls `startAdminOprRequestSelection()`

2. **Operator**
   - Location: `src/service/waService.js` line ~2362
   - Check: `findByOperator(waId)`
   - Behavior: Direct access to operator menu for their assigned client

3. **Super Admin**
   - Location: `src/service/waService.js` line ~2363
   - Check: `findBySuperAdmin(waId)`
   - Behavior: Direct access to operator menu for their assigned client

### dirrequest Menu

The `dirrequest` menu is now **accessible from all WhatsApp numbers** without any authorization restrictions.

- Location: `src/service/waService.js` line ~2451
- Check: None (open access)
- Behavior: Shows client selection menu for all active directorate clients
- Implementation: Fetches via `findAllActiveDirektoratClients()`

**Note:** Previously, dirrequest had multiple access mechanisms similar to oprrequest. As of the latest update, all WhatsApp numbers can access dirrequest and select from available directorate clients.

## Access Flow Diagrams

### oprrequest Access Flow

```
User sends "oprrequest"
    ↓
Is user in ADMIN_WHATSAPP? → YES → Show client selection for all org clients
    ↓ NO
Is user an Operator? → YES → Show operator menu for their client
    ↓ NO
Is user a Super Admin? → YES → Show operator menu for their client
    ↓ NO
Deny access with error message
```

### dirrequest Access Flow

```
User sends "dirrequest"
    ↓
Show client selection for all directorate clients
    ↓
User selects a client
    ↓
Access dirrequest menu for selected client
```

## Implementation Details

### isAdminWhatsApp Function

Located in: `src/utils/waHelper.js` (lines 119-132)

```javascript
export function isAdminWhatsApp(number) {
  const adminNumbers = (process.env.ADMIN_WHATSAPP || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.endsWith("@c.us") ? n : n.replace(/\D/g, "") + "@c.us"));
  const normalized =
    typeof number === "string"
      ? number.endsWith("@c.us")
        ? number
        : number.replace(/\D/g, "") + "@c.us"
      : "";
  return adminNumbers.includes(normalized);
}
```

**Functionality:**
1. Reads `ADMIN_WHATSAPP` from environment
2. Splits by comma and trims whitespace
3. Normalizes all numbers to include `@c.us` suffix
4. Normalizes input number to include `@c.us` suffix
5. Returns true if normalized input is in admin list

### Number Normalization

The system automatically normalizes WhatsApp numbers:

- `628123456789` → `628123456789@c.us`
- `628123456789@c.us` → `628123456789@c.us` (no change)
- `62-812-345-6789` → `628123456789@c.us` (removes non-digits)

## Usage Examples

### For ADMIN_WHATSAPP Users

1. **Accessing oprrequest:**
   - Send message: `oprrequest`
   - System shows list of all org-type clients
   - Select client by number or client_id
   - Access operator menu for selected client

2. **Accessing dirrequest:**
   - Send message: `dirrequest`
   - System shows list of all active directorate clients (same behavior as all users)
   - Select client by number or client_id
   - Access dirrequest menu for selected client

### For All WhatsApp Users

1. **Accessing dirrequest:**
   - Send message: `dirrequest`
   - System shows list of all active directorate clients
   - Select client by number or client_id
   - Access dirrequest menu for selected client

### For Operator/Super Admin Users

1. **Accessing oprrequest:**
   - Send message: `oprrequest`
   - System automatically identifies your assigned client
   - Direct access to operator menu (no client selection)

## Security Considerations

1. **oprrequest Access:** ADMIN_WHATSAPP check runs **before** operator/super admin checks, ensuring admins always get full access regardless of their database roles.

2. **dirrequest Access:** No authorization restrictions - all WhatsApp numbers can access dirrequest and select from available directorate clients.

3. **Number Format:** All numbers are normalized to prevent bypassing through format variations.

4. **Environment-based:** Admin list for oprrequest is loaded from `.env` file, separate from database configurations.

5. **No Fallback for oprrequest:** If a user doesn't match any access mechanism for oprrequest, access is denied with a clear error message.

## Testing

Tests are located in: `tests/adminWhatsappAccess.test.js`

Run tests with:
```bash
npm test tests/adminWhatsappAccess.test.js
```

## Troubleshooting

### User cannot access oprrequest despite being in ADMIN_WHATSAPP

1. Check if `.env` file exists and is loaded
2. Verify `ADMIN_WHATSAPP` is set correctly (comma-separated, no spaces in numbers)
3. Check if user's WhatsApp number matches exactly (including country code)
4. Restart the application after changing `.env`

### Admin gets "operator only" error for oprrequest

This should not happen if `ADMIN_WHATSAPP` is configured correctly. The admin check runs first. If you see this error:
1. Verify the number is in `ADMIN_WHATSAPP`
2. Check application logs for `isAdminWhatsApp` function calls
3. Ensure `.env` file is in the correct location

### Client selection doesn't show for dirrequest

For all users, client selection is fetched from database:
- Fetches all active directorate clients via `findAllActiveDirektoratClients()`

If no clients appear, check database for clients with appropriate types and active status.

### Client selection doesn't show for oprrequest (admins only)

For admins, client selection is fetched from database:
- Fetches all clients with `client_type = 'org'`

If no clients appear, check database for clients with appropriate types and status.

## Maintenance

### Adding new admin WhatsApp numbers (for oprrequest access):

1. Edit `.env` file
2. Add number to comma-separated list in `ADMIN_WHATSAPP`
3. Restart application
4. Test access by sending `oprrequest` message

No database changes or code modifications needed!

### Note on dirrequest access

Since dirrequest is now accessible from all WhatsApp numbers, no configuration is needed to grant access to new users. All users can type `dirrequest` to access the menu.

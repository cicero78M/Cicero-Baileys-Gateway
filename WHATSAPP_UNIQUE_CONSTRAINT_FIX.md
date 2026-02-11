# WhatsApp Unique Constraint Migration Fix

## Problem
The migration `20260209_add_unique_constraint_user_whatsapp.sql` was failing with error:
```
ERROR:  could not create unique index "idx_user_whatsapp_unique"
DETAIL:  Key (whatsapp)=(6282335802593) is duplicated.
```

This occurred even after running the UPDATE query to remove duplicates, indicating the query wasn't catching all duplicate cases.

## Root Cause
The original UPDATE query used only `created_at` for comparison:
```sql
WHERE u2.created_at < u1.created_at
```

This left duplicates when multiple users had:
- The same WhatsApp number AND
- The EXACT same `created_at` timestamp

Without a tie-breaker, the query couldn't determine which record to keep when timestamps were identical.

## Solution
Added `user_id` as a tie-breaker in the comparison logic:
```sql
WHERE u2.whatsapp = u1.whatsapp 
  AND (u2.created_at < u1.created_at 
       OR (u2.created_at = u1.created_at AND u2.user_id < u1.user_id))
```

This ensures:
1. Primary sort: Keep the user with the earliest `created_at`
2. Tie-breaker: If timestamps are equal, keep the user with the lexicographically smallest `user_id`
3. Deterministic results: Same input data always produces the same output

## Manual Verification Test Case

### Scenario 1: Different created_at timestamps
```sql
-- Setup
INSERT INTO "user" (user_id, nama, whatsapp, created_at) VALUES 
  ('user1', 'First', '6282335802593', '2025-01-01 10:00:00+00'),
  ('user2', 'Second', '6282335802593', '2025-01-02 10:00:00+00');

-- Run migration UPDATE
-- Expected: user1 keeps whatsapp, user2's whatsapp becomes NULL
```

### Scenario 2: Same created_at timestamps (the fix)
```sql
-- Setup
INSERT INTO "user" (user_id, nama, whatsapp, created_at) VALUES 
  ('user_b', 'User B', '6282335802593', '2025-01-01 10:00:00+00'),
  ('user_a', 'User A', '6282335802593', '2025-01-01 10:00:00+00'),
  ('user_c', 'User C', '6282335802593', '2025-01-01 10:00:00+00');

-- Run migration UPDATE
-- Expected: user_a keeps whatsapp (lexicographically first)
--           user_b and user_c whatsapp becomes NULL
```

### Scenario 3: NULL and empty values excluded from unique constraint
```sql
-- Setup
INSERT INTO "user" (user_id, nama, whatsapp) VALUES 
  ('user1', 'No Phone 1', NULL),
  ('user2', 'No Phone 2', NULL),
  ('user3', 'Empty Phone 1', ''),
  ('user4', 'Empty Phone 2', '');

-- Run migration
-- Expected: All records remain, partial index excludes NULL/empty values from uniqueness check
```

## Files Changed
- `/sql/migrations/20260209_add_unique_constraint_user_whatsapp.sql`
  - Added tie-breaker logic using `user_id` when `created_at` timestamps are equal
  - Updated comment to explain the tie-breaker approach

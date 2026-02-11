# Migration Testing Instructions

## Issue Fixed
Migration `20260209_add_unique_constraint_user_whatsapp.sql` was failing because the duplicate cleanup logic didn't handle cases where users had the same WhatsApp number AND the same `created_at` timestamp.

## What Changed
Updated the UPDATE query in the migration to use `user_id` as a tie-breaker when `created_at` values are equal:

```sql
-- OLD (broken)
WHERE u2.created_at < u1.created_at

-- NEW (fixed)
WHERE (u2.created_at < u1.created_at 
       OR (u2.created_at = u1.created_at AND u2.user_id < u1.user_id))
```

## Manual Testing with PostgreSQL

### Prerequisites
- Access to the `cicero_db` database
- PostgreSQL client (psql)
- Backup of the database (recommended)

### Test Procedure

#### 1. Create test data with duplicate WhatsApp numbers

```sql
-- Connect to the database
\c cicero_db

-- Create test users with duplicate WhatsApp numbers
INSERT INTO "user" (user_id, nama, whatsapp, created_at, updated_at) 
VALUES 
  ('test_user_1', 'Test User 1', '628TEST123456', '2025-01-01 10:00:00+00', NOW()),
  ('test_user_2', 'Test User 2', '628TEST123456', '2025-01-02 10:00:00+00', NOW()),
  ('test_user_3', 'Test User 3', '628TEST123456', '2025-01-01 10:00:00+00', NOW())
ON CONFLICT (user_id) DO NOTHING;

-- Verify test data created
SELECT user_id, whatsapp, created_at 
FROM "user" 
WHERE user_id LIKE 'test_user_%' 
ORDER BY user_id;
```

Expected output: 3 rows with duplicate WhatsApp numbers

#### 2. Run the migration UPDATE query

```sql
-- This is the fixed UPDATE from the migration
UPDATE "user" u1
SET whatsapp = NULL, updated_at = NOW()
WHERE u1.whatsapp IS NOT NULL 
  AND u1.whatsapp != ''
  AND EXISTS (
    SELECT 1 
    FROM "user" u2 
    WHERE u2.whatsapp = u1.whatsapp 
      AND (u2.created_at < u1.created_at 
           OR (u2.created_at = u1.created_at AND u2.user_id < u1.user_id))
  );

-- Check results
SELECT user_id, whatsapp, created_at 
FROM "user" 
WHERE user_id LIKE 'test_user_%' 
ORDER BY user_id;
```

Expected output:
- `test_user_1`: whatsapp = '628TEST123456' (kept - earliest created_at, and among the tied timestamps, smallest user_id)
- `test_user_2`: whatsapp = NULL (removed - later created_at)
- `test_user_3`: whatsapp = NULL (removed - same created_at as test_user_1 but larger user_id)

#### 3. Verify unique index creation

```sql
-- Create the unique index (should succeed now)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_whatsapp_unique 
ON "user"(whatsapp) 
WHERE whatsapp IS NOT NULL AND whatsapp != '';

-- Try to insert a duplicate (should fail)
INSERT INTO "user" (user_id, nama, whatsapp, created_at) 
VALUES ('test_user_4', 'Test User 4', '628TEST123456', NOW());
```

Expected: The INSERT should fail with a unique constraint violation error.

#### 4. Verify NULL and empty string handling

```sql
-- Insert multiple NULL and empty values (should succeed)
INSERT INTO "user" (user_id, nama, whatsapp, created_at) 
VALUES 
  ('test_null_1', 'No Phone 1', NULL, NOW()),
  ('test_null_2', 'No Phone 2', NULL, NOW()),
  ('test_empty_1', 'Empty 1', '', NOW()),
  ('test_empty_2', 'Empty 2', '', NOW())
ON CONFLICT (user_id) DO NOTHING;

-- Verify insertions succeeded
SELECT user_id, whatsapp 
FROM "user" 
WHERE user_id LIKE 'test_%' 
ORDER BY user_id;
```

Expected: All inserts succeed. The partial index allows multiple NULL and empty string values.

#### 5. Cleanup test data

```sql
-- Remove test users
DELETE FROM "user" WHERE user_id LIKE 'test_%';

-- Verify cleanup
SELECT COUNT(*) FROM "user" WHERE user_id LIKE 'test_%';
```

Expected: 0 rows

## Running the Full Migration

Once testing is complete, run the full migration:

```sql
\c cicero_db
\i sql/migrations/20260209_add_unique_constraint_user_whatsapp.sql
```

This will:
1. Clear duplicate WhatsApp numbers (keeping the earliest created user for each number)
2. Create the unique constraint index
3. Prevent future duplicate WhatsApp numbers from being inserted

## Rollback (if needed)

```sql
-- Drop the unique index
DROP INDEX IF EXISTS idx_user_whatsapp_unique;
```

Note: This does NOT restore the WhatsApp numbers that were set to NULL. You would need to restore from backup for that.

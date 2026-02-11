# Running Database Migrations

This guide explains how to safely run SQL migrations in the Cicero_V2 project.

## Quick Start

Use the migration runner script to execute migrations safely:

```bash
node scripts/run_migration.js sql/migrations/<migration-file>.sql
```

**Example:**
```bash
node scripts/run_migration.js sql/migrations/20260209_add_unique_constraint_user_whatsapp.sql
```

## Why Use the Migration Runner?

The migration runner script (`scripts/run_migration.js`) provides:

1. **Validation**: Detects common issues before execution
   - HTML entities (`&lt;`, `&gt;`, `&amp;`)
   - Truncated lines
   - Invalid SQL structure

2. **Safety**: Executes migrations with proper error handling
3. **Visibility**: Provides colored console output for easy monitoring
4. **Error Recovery**: Shows detailed error messages when something goes wrong

## Common Migration Issues

### Issue 1: HTML-Encoded SQL

**Symptom**: Migration fails with syntax errors or "relation does not exist"

**Cause**: SQL was copied from an HTML page without decoding entities:
- `<` becomes `&lt;`
- `>` becomes `&gt;`
- `&` becomes `&amp;`

**Example of corrupted SQL:**
```sql
-- WRONG (HTML-encoded)
WHERE u2.created_at &lt; u1.created_at

-- CORRECT
WHERE u2.created_at < u1.created_at
```

**Solution**: 
- Always use the migration runner script
- Never copy SQL from HTML sources
- Get migration files directly from the repository

### Issue 2: Database Connection Issues

**Symptom**: "connection refused" or "cannot connect to server"

**Cause**: PostgreSQL is not running or `.env` configuration is incorrect

**Solution**:
1. Check if PostgreSQL is running:
   ```bash
   systemctl status postgresql
   # or
   pg_isready
   ```

2. Verify `.env` configuration:
   ```bash
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=cicero_db
   DB_USER=cicero
   DB_PASS=your_password
   ```

3. Test connection:
   ```bash
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME
   ```

### Issue 3: Table Does Not Exist

**Symptom**: "ERROR: relation 'user' does not exist"

**Cause**: Migration is being run on a database that hasn't been initialized

**Solution**:
1. First, create the schema:
   ```bash
   psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f sql/schema.sql
   ```

2. Then run migrations in order:
   ```bash
   ls sql/migrations/*.sql | sort | while read f; do
     node scripts/run_migration.js "$f"
   done
   ```

## Manual Migration Execution

If you need to run migrations manually with `psql`:

```bash
# Connect to database
psql -h $DB_HOST -U $DB_USER -d $DB_NAME

# Run migration
\i sql/migrations/20260209_add_unique_constraint_user_whatsapp.sql

# Or in one command
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f sql/migrations/20260209_add_unique_constraint_user_whatsapp.sql
```

**⚠️ Important**: When running manually, ensure:
- SQL file has no HTML entities
- You're connected to the correct database
- Required tables exist
- You have necessary permissions

## Migration Best Practices

1. **Always backup before running migrations:**
   ```bash
   pg_dump -h $DB_HOST -U $DB_USER $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Test migrations in development first:**
   - Run on a copy of production data
   - Verify results before applying to production

3. **Run migrations in order:**
   - Follow the date-based naming convention (YYYYMMDD)
   - Don't skip migrations

4. **Document changes:**
   - Each migration should have comments explaining what it does
   - Update relevant documentation after applying

5. **Handle duplicates before unique constraints:**
   - The WhatsApp migration demonstrates this pattern
   - First clean up duplicates, then add constraint

## Specific Migration: WhatsApp Unique Constraint

The migration `20260209_add_unique_constraint_user_whatsapp.sql` adds a unique constraint to the `user.whatsapp` field.

**What it does:**

1. **Cleans up duplicates**: Sets `whatsapp` to NULL for duplicate entries, keeping only the earliest created user
   - Primary sort: by `created_at` (earliest wins)
   - Tie-breaker: by `user_id` (lexicographically smallest wins)

2. **Adds unique index**: Creates a partial unique index that:
   - Prevents duplicate WhatsApp numbers
   - Allows multiple NULL values
   - Allows multiple empty strings

**Testing:**

See [MIGRATION_TESTING_GUIDE.md](../MIGRATION_TESTING_GUIDE.md) for detailed testing instructions.

**Rollback:**

If you need to remove the unique constraint:
```sql
DROP INDEX IF EXISTS idx_user_whatsapp_unique;
```

Note: This does NOT restore WhatsApp numbers that were set to NULL. You must restore from backup for that.

## Troubleshooting

### Migration fails with "syntax error"

1. Check for HTML entities in the SQL file:
   ```bash
   grep -n "&lt;\|&gt;\|&amp;" sql/migrations/*.sql
   ```

2. Verify file encoding:
   ```bash
   file sql/migrations/<migration-file>.sql
   # Should show: ASCII text or UTF-8 Unicode text
   ```

### Migration runs but doesn't work as expected

1. Check transaction status:
   ```sql
   SELECT * FROM pg_stat_activity WHERE state = 'idle in transaction';
   ```

2. Verify the migration completed:
   ```sql
   -- For the WhatsApp migration
   \d+ "user"  -- Check if index exists
   SELECT COUNT(*) FROM "user" 
   WHERE whatsapp IN (
     SELECT whatsapp FROM "user" 
     WHERE whatsapp IS NOT NULL AND whatsapp != ''
     GROUP BY whatsapp HAVING COUNT(*) > 1
   );  -- Should return 0
   ```

### Need to re-run a migration

1. If migration failed partway through, you may need to:
   - Restore from backup
   - Or manually clean up partial changes

2. Check what was applied:
   ```sql
   -- Check indexes
   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'user';
   
   -- Check constraints  
   SELECT conname, contype, pg_get_constraintdef(oid)
   FROM pg_constraint WHERE conrelid = '"user"'::regclass;
   ```

## Additional Resources

- [MIGRATION_TESTING_GUIDE.md](../MIGRATION_TESTING_GUIDE.md) - Testing procedures
- [WHATSAPP_UNIQUE_CONSTRAINT_FIX.md](../WHATSAPP_UNIQUE_CONSTRAINT_FIX.md) - Specific WhatsApp migration details
- [database_structure.md](./database_structure.md) - Database schema documentation
- [PostgreSQL Documentation](https://www.postgresql.org/docs/) - Official PostgreSQL docs

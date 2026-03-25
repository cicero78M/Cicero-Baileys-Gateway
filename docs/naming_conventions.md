# Naming Conventions
*Last updated: 2025-06-25*

This document summarizes the naming style used throughout **Cicero_V2**. Follow these guidelines to keep the codebase and database consistent.

## Folders & Files

- Folder names use lowercase letters with no spaces, for example `controller`, `service`, `middleware`.
- File names follow *camelCase* with an extension appropriate to the language (`.js`, `.ts`, etc.), e.g. `userController.js`, `cronRekapLink.js`.
- Avoid special characters other than hyphens (`-`) or underscores (`_`).

## Functions

- Functions use *camelCase*. The first word is lowercase and subsequent words start with a capital letter, e.g. `getAllUsers`, `createClient`.
- Boolean functions are prefixed with `is` or `has`, such as `isAuthorized` or `hasPermission`.
- Async functions should begin with a verb that describes the action, for example `fetchInstagramPosts` or `sendReportViaWA`.

## Database

- Table names use `snake_case` in lowercase, e.g. `insta_post`, `tiktok_comment`.
- Column names also use `snake_case`, for example `client_id`, `created_at`.
- Primary keys use the suffix `_id` to match the entity, such as `user_id` or `client_id`.
- Add indexes on columns that are frequently queried.

### Deviations

| Table | Deviation | Justification |
|---|---|---|
| `operators` | `phone_number VARCHAR(30) PRIMARY KEY` (no `_id` suffix) | Phone number is the stable, unique business key. No surrogate ID is warranted—the phone number is both the lookup key and the natural identity of an operator. |
| `operator_registration_sessions` | `phone_number VARCHAR(30) PRIMARY KEY` (no `_id` suffix) | Session is keyed by the caller’s phone number; only one active session per number can exist at a time. Using a surrogate key adds no value and complicates the upsert-on-conflict pattern. |

These guidelines may be expanded as needed but serve as the basic reference for adding new modules.

## SQL Migration Files

Migration files in `sql/migrations/` use the pattern `YYYYMMDD_NNN_description.sql`, where:
- `YYYYMMDD` is the date the migration was authored.
- `NNN` is a zero-padded sequence number within the same date (e.g. `001`, `002`).
- `description` is a short `snake_case` summary of the migration's purpose.

Example: `20260325_003_create_operators.sql`

This deviates from the constitution's base pattern (`YYYYMMDD_description.sql`) to support multiple migrations within a single day without relying on alphabetical ordering. The sequence number serves as the unambiguous order guarantee.

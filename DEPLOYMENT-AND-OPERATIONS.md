# KBMS deployment and operations pack

This guide describes the current KBMS deployment. The staff portal at `/` is connected to the configured Supabase development project; `/?demo=1` remains a separate browser-local demo. The connected project is not an approved school production database. Do not enter real student records until the school approves hosting, data-processing terms, data location/transfers, retention, device controls and operating policies.

## 1. Local demo

Extract `KBMS-Official-Demo.zip` and run `START-DEMO.bat` on Windows. The demo uses fictional records and browser-local storage. It is not multi-device, not an official record system and not connected to school accounts.

## 2. Backend deployment (school-controlled project only)

1. Create a separate disposable development Supabase project. Do not use production for first migration tests.
2. Keep the project URL and publishable/anon key in the browser config only. Never put the service-role key in `config.js`, HTML, JavaScript, a spreadsheet or a staff device.
3. Apply `schema.sql` to the disposable database and run `tests/postgres-smoke-test.sql`. The smoke test must be run as a privileged database operator in a test project. Resolve every SQL error before proceeding.
4. Enable Supabase Auth email/password authentication in the disposable project (email delivery is not used by this username-based account flow; the Edge Function creates confirmed internal Auth identities). Install the Supabase CLI and link the local project directory to the disposable project.
5. Deploy the functions from this package:

   ```sh
   supabase functions deploy kbms-username-login
   supabase functions deploy kbms-staff-admin
   ```

   `supabase/config.toml` deliberately disables JWT verification only for `kbms-username-login`, because it is the public credential-exchange endpoint. Supabase Auth still verifies the password and applies its password-token rate limits. The staff administration function requires a valid JWT and independently checks the caller's active administrator role.
6. `config.js` is currently configured for the development Supabase project using only its HTTPS URL and publishable key. Keep service-role and secret keys out of the browser. For any new school-approved environment, replace these values with that project's URL and publishable key.
7. Create the initial school-approved administrator account and bootstrap it using `bootstrap-first-super-admin.sql`. This one-time operation must be performed by the project owner after verifying the Auth user UUID. Replace the clearly marked UUID and display-name placeholders; never run the template unchanged.
8. Sign in with the bootstrap username, provision a second administrator, verify the second account, and only then use the normal staff directory to provision other staff. Temporary passwords are shown once in the administrator's browser; deliver them privately and require the staff member to change them at first sign-in.
9. Test all roles with separate accounts. Confirm teacher visibility is limited to assigned classes/subjects, and that librarian/bookstore/approver/admin actions are rejected by the server when unauthorized.

The synthetic username email domain is `staff.kbms.invalid`. It is internal to Supabase Auth and is not an email inbox. Staff sign in with the username and password; no staff email address is needed for this username flow. Do not enable public email/password sign-in as an alternative unless the school chooses and configures it deliberately.

## 3. Backups and restore drills

The package includes encrypted logical-backup scripts:

- Linux/macOS: `scripts/backup-postgres.sh`
- Windows PowerShell: `scripts/backup-postgres.ps1`
- Disposable restore drill: `scripts/restore-drill.sh`

Requirements: PostgreSQL client tools (`pg_dump`, `pg_restore`), GnuPG and a school-controlled encryption key. The scripts require `DATABASE_URL` and `GPG_RECIPIENT`; no credentials are embedded. Backups are written with restrictive permissions, encrypted before the plaintext dump is removed, checksummed and pruned according to `RETENTION_DAYS` (default 30).

Example (Linux/macOS):

```sh
export DATABASE_URL='postgresql://...'
export GPG_RECIPIENT='school-backup-key@example.org'
export BACKUP_DIR='/secure/kbms-backups'
./scripts/backup-postgres.sh
```

For a restore drill, point `DATABASE_URL` only at a disposable database, set `BACKUP_FILE` and `CONFIRM_NONPRODUCTION=YES`, then run `scripts/restore-drill.sh`. It requires typing `RESTORE-DISPOSABLE` before it replaces the target database.

**Important:** a `pg_dump` logical backup is an additional recovery layer, not a substitute for provider-managed point-in-time recovery, platform configuration backups or the school's approved disaster-recovery plan. Confirm that the selected connection role can back up all required schemas. Supabase-managed Auth/platform data may require provider-specific export/backup procedures. The school must schedule the job, protect the encryption key separately and perform witnessed restore drills.

## 4. Current automated checks

From the `KBMS-Work` directory:

```sh
node --check app.js
node --check xlsx-export.js
node tests/checks.mjs
bash -n scripts/backup-postgres.sh scripts/restore-drill.sh
```

The multi-sheet Excel generator is also round-trip tested with `openpyxl` in the development environment. These checks do not prove SQL migration execution, Supabase RLS behavior, Edge Function deployment, multi-device behavior or full browser acceptance.

## 5. Decisions the school must still supply

- Hosting/provider approval, data-protection review, data location and retention rules.
- The initial administrator identity and authorized staff roster/roles.
- Approved weekly library return day, late-fee exceptions/waivers and any renewal policy.
- Official class/subject structure and teacher assignments.
- Final clearance, departure, promotion and academic-year rollover procedures.
- Backup owner, encryption-key custodian, retention schedule and recovery objectives.
- Deployment domain, HTTPS hosting, device access and production sign-off.

Until those are supplied and the tests are passed against the school's own disposable environment, keep the connected backend as development-only and keep the public `?demo=1` scenario fictional and browser-local.

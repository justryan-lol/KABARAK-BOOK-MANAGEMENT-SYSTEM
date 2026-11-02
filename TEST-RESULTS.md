# KBMS development verification

Run date: 1 November 2026

## Passed

- `node --check app.js`, `node --check config.js` and `node --check xlsx-export.js`.
- `node tests/checks.mjs` — static regression assertions passed for asset integrity, role safeguards, audited approvals, protected history, atomic circulation/textbook RPCs, username authentication flow, first-login password change, staff administration functions, multi-sheet Excel and backup tooling.
- `tsc --noEmit` checked both Supabase Edge Function TypeScript files using a local declaration shim for the Deno/Supabase runtime interfaces. This is static type checking, not a deployed Edge Function test.
- Multi-sheet `.xlsx` workbook was opened with `openpyxl`; worksheet names, Unicode/special characters, leading-zero identifiers and formula-looking text round-tripped correctly as text.
- `bash -n scripts/backup-postgres.sh scripts/restore-drill.sh` — shell syntax passed.
- `manifest.json` parses; local assets resolve; CSS brace counts match.
- Local HTTP server returned `200 OK` for the application entry point.
- ZIP integrity check passed after packaging.

## Attempted but blocked / not available

- Chromium headless launch timed out before returning the DOM. Browser end-to-end behavior is therefore not certified by this environment.
- PostgreSQL migration and RLS execution were not run: no local PostgreSQL client/server or Docker runtime is available, and no school-controlled Supabase development project is connected.
- Supabase Edge Functions were not deployed. Username login, account provisioning, role enforcement, approvals, realtime synchronization and multi-device concurrency still need acceptance tests in a disposable Supabase project.
- Backup and restore scripts were syntax-checked, not run against a real database or school encryption key.

## Included in this development build

- Username-based sign-in through a Supabase Edge Function, backed by Supabase Auth password verification.
- Administrator-only staff provisioning, password reset, activation/deactivation and role changes through a protected Edge Function; temporary credentials are displayed once and require a first-login password change.
- Connected approval request and Principal/deputy/admin decision UI using the audited server-side decision RPC.
- Connected academic-year, class, subject and dated teacher-assignment management; class teachers allocate only within their assigned class, while subject teachers are restricted to assigned subjects.
- Seven-sheet Excel audit export: follow-up, students, library inventory/history, textbook inventory/history and clearances.
- Encrypted PostgreSQL logical-backup scripts, checksum handling, retention cleanup and an explicitly gated disposable restore drill.
- Deployment guide and first-super-administrator bootstrap template.

## Still requires school/provider involvement

- Approve provider, hosting, privacy/data-protection review, data location, retention and deployment domain.
- Supply the first authorized administrator identity and official staff/role list.
- Confirm weekly library return day, penalty exceptions and renewal policy.
- Supply official class/subject structure, academic-year dates and teacher assignments.
- Deploy the SQL and Edge Functions to a school-controlled disposable project; run migrations, RLS/role tests, browser tests and multi-device concurrency tests.
- Configure scheduled backups, custody of encryption keys, provider PITR and a witnessed restore drill.
- Approve production rollout and only then load real student data.

The local demo remains fictional and single-browser. No production service or real school account has been connected.

## 1 November 2026 — form cancellation and bookstore bulk import
- `node --check app.js`: PASS
- `node tests/checks.mjs`: PASS, including checks for cancel bypassing required fields, close/cancel not invoking save logic, textbook import template/actions, duplicate-code rejection, all-or-nothing validation and the one-row-per-copy confirmation.
- Headless Chromium launch was attempted but timed out in this environment; interactive browser acceptance testing remains outstanding.


## Additional checks — 2026-11-01

- Academic-year setup and Archives navigation/rendering: static regression checks passed.
- Named class creation and bookstore-admin insert policy: static regression checks passed.
- Archive RPC safeguards (current year cannot be archived or reactivated; class/student snapshots are retained): static regression checks passed.
- Cloudflare Pages build script: shell syntax check passed; a local build using placeholder demo project settings produced the expected runtime-only `dist/` assets. This validates packaging, not a live Cloudflare deployment.
- PostgreSQL migration and live RLS/RPC behavior remain unexecuted because no disposable Supabase project is connected. Browser-level workflow testing also remains outstanding.

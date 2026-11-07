# Shared demo and tester-account readiness (approval required)

## Current state

The public `/?demo=1` route intentionally switches to a separate IndexedDB database named `mhsk-bookstore-demo`. `app.js` sets `DEMO_MODE`, `DB_NAME`, and `state.demoMode` at startup; `connectSupabase()` explicitly leaves `state.syncConfig` and `state.supabase` unset in demo mode. The fictional scenario loader and migration helpers (`loadFictionalDemoData`, `upgradeDemoScenario`, and `repairDemoClassDirectory`) write only to browser-local IndexedDB. Circulation, textbook allocation/return, student register/import, class setup, archives, clearances, reports, staff workflow preview and audit examples read/write these local stores. Other testers and devices do not see those records.

This is not shared-demo access. No change in this repair connects the demo route to the currently configured Supabase development project, creates a Supabase project, provisions accounts, seeds data or changes billing.

## Recommended smallest safe migration

1. Obtain school/project-owner approval and create a distinct demo-only Supabase project. Do not reuse the staff/development project. Store only that project's URL and publishable key in a separately built Cloudflare Pages environment.
2. Apply the existing schema to the demo project in a disposable test phase, then test RLS and every role before any public demo. Seed only fictional data into that isolated project; keep seed scripts and reset procedures explicitly demo-only and audited.
3. Build a separate demo deployment (recommended) so the app's one Supabase client is configured entirely for the demo backend. Give it its own `SUPABASE_URL` and `SUPABASE_ANON_KEY`; never select backends from an untrusted browser query parameter and never include a service-role key in the build.
4. Reuse `kbms-username-login`, `kbms-staff-admin`, `staff_profiles`, and `staff_memberships` in the demo project. The existing account workflow already generates a random temporary password, requires first-login change, checks the active administrator on the server, protects super-admin assignment, and deactivation updates the role membership through the audited database function. A newly provisioned demo administrator can create individual tester accounts after the isolated project is deployed.
5. Keep the existing local `?demo=1` route until the shared demo passes acceptance. Then expose shared demo access through the normal website using a clear demo entry and authentication on the separate demo deployment/backend. Do not make a public route silently authenticate as a shared account.
6. Decide demo account expiration, data reset cadence, abuse/rate controls, account owner, audit retention and privacy notice before sharing the URL.

## Account-system review and remaining checks

- The browser invokes `kbms-staff-admin`; its Edge Function requires a valid user JWT and independently checks an active `admin`/`super_admin` membership. The service-role credential is read server-side only.
- `kbms-username-login` verifies that both the profile and membership are active before password authentication. Existing RLS policies and database RPCs still need negative role tests against the isolated demo project.
- The UI provisions normal staff accounts, not a demo-scoped account type. A separate demo project provides the isolation boundary; do not add a `Create Demo Account` action to the real staff environment.
- Membership assignment changes are written to the append-only audit trigger. Password reset and Auth user creation do not appear to have a dedicated audit event in the inspected function; verify the deployed audit coverage and consider an additive, protected server-side audit operation in the demo project before relying on it for account lifecycle accountability.
- Temporary passwords are returned once and displayed in an alert for private delivery. They are not written to the app database as plaintext; verify Supabase Auth's password-storage behavior and enforce strong password/leaked-password controls in the demo project's settings.
- Admins can choose among all existing roles. For demos, the operator should create a least-privilege demo administrator only when needed and grant testers the lowest role that supports their assigned walkthrough. Never choose `admin` or `super_admin` for reviewers.

## Deployment variables and permissions

Cloudflare Pages build settings should be set separately for the demo deployment's Preview and Production environments:

- `SUPABASE_URL`: the approved demo project's HTTPS URL.
- `SUPABASE_ANON_KEY`: that project's publishable/anon key.

The build script requires these variables and intentionally has no fallback to the current project. Supabase service-role/secret keys belong only in Supabase Edge Function secrets, configured by the demo project owner. Provisioning, schema deployment, account creation and demo seeding require project-owner/admin approval. No such setup has been performed by this change.

## Acceptance checklist before sharing

- Confirm the demo hostname and normal-website entry point.
- Verify the deployed `config.js` points only to the demo project.
- Confirm fictional-only student/book data and per-tester credentials.
- Test teacher, librarian, bookstore, auditor and demo-admin boundaries with separate accounts, including denied writes/RPCs.
- Test provisioning, one-time password delivery, forced password change, password reset and deactivation.
- Confirm account lifecycle audit records and an approved demo reset method.
- Run browser tests and verify no demo request can reach the staff project.

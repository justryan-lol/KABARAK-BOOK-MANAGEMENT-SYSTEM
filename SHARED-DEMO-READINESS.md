# Shared demo and tester-account readiness (approval required)

## Current state

The public `/?demo=1` route continues to use browser-local IndexedDB. The optional `/?demo=cloud` route uses the configured Supabase development project, normal staff authentication, and a separate browser database/auth key. The shared demo seed is an admin-only RPC that atomically adds fictional records and never deletes existing rows. All authorized accounts on the selected project can see the seeded records; users without an active staff membership are rejected by the existing sign-in flow.

The shared route does not create accounts or bypass staff authentication. The migration has been added to the repository but has not been applied to Supabase; the seed is unavailable until an authorized project operator applies it.

## Recommended smallest safe migration

1. The approved development project can be used for internal testing, but a distinct demo-only Supabase project is safer for external reviewers because all authorized accounts on one project share the same records. Never use the school production project for the shared demo.
2. Apply `supabase/migrations/20261124154800_shared_demo_seed.sql` after the base KBMS schema. The seed RPC is atomic, admin-only, collision-checked, and non-destructive; test it with an administrator in the approved development project before inviting reviewers.
3. Build a separate demo deployment (recommended) so the app's one Supabase client is configured entirely for the demo backend. Give it its own `SUPABASE_URL` and `SUPABASE_ANON_KEY`; never select backends from an untrusted browser query parameter and never include a service-role key in the build.
4. Reuse `kbms-username-login`, `kbms-staff-admin`, `staff_profiles`, and `staff_memberships` in the demo project. The existing account workflow already generates a random temporary password, requires first-login change, checks the active administrator on the server, protects super-admin assignment, and deactivation updates the role membership through the audited database function. A newly provisioned demo administrator can create individual tester accounts after the isolated project is deployed.
5. Keep `?demo=1` as the no-account local demo. The `?demo=cloud` route requires staff sign-in and never silently authenticates as a shared account.
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

The build script accepts project URL and publishable/anon key variables, or validates the checked-in public config. Never put service-role/secret keys in the browser. The new seed migration has not yet been applied to the configured development project; a signed-in admin must run the seed once after deployment. Cloudflare hosting and schema deployment are not performed by the build script.

## Acceptance checklist before sharing

- Confirm the demo hostname and normal-website entry point.
- Verify the deployed `config.js` points only to the demo project.
- Confirm fictional-only student/book data and per-tester credentials.
- Test teacher, librarian, bookstore, auditor and demo-admin boundaries with separate accounts, including denied writes/RPCs.
- Test provisioning, one-time password delivery, forced password change, password reset and deactivation.
- Confirm account lifecycle audit records and an approved demo reset method.
- Run browser tests and verify no demo request can reach the staff project.

# KBMS online teacher demo — Cloudflare Pages plan

This package describes fictional-data demos only. `/?demo=1` is browser-local. The optional `/?demo=cloud` route authenticates staff against the configured development Supabase project and stores the approved demo dataset there. Use it only after the project owner confirms the workspace is safe for shared fictional records; never point it at school production. A dedicated demo Supabase project remains the recommended setup for inviting external testers.

## Architecture

- Cloudflare Pages serves the static KBMS application over HTTPS.
- A separate, owner-approved Supabase project holds fictional demo records and demo-only staff accounts.
- The Supabase publishable/anon key is public by design; database RLS and server-side RPC authorization remain mandatory. Never put a Supabase service-role key in the site.
- Staff and demo deployments must use different Supabase projects and separately controlled Pages build environments.
- `/?demo=1` uses browser-local IndexedDB; `/?demo=cloud` uses the configured Supabase backend and a separate browser cache/auth namespace.

## Build and environment

Configure Cloudflare Pages with build command `bash scripts/build-cloudflare.sh` and output directory `dist`. Set both variables in Preview and Production, pointing only to the intended deployment backend:

- `SUPABASE_URL` — an HTTPS Supabase project URL.
- `SUPABASE_ANON_KEY` — that project's publishable/anon key.

When both Cloudflare build variables are present, they override the repository runtime configuration. If Pages does not expose dashboard variables to the build shell, the script validates and packages the existing public `config.js` rather than failing before deployment. That file is client-visible and must contain only the intended Supabase project URL and publishable/anon key; never put a service-role key in it. Keep the repository config pointed at the approved demo backend before sharing the site. The script copies `responsive.css` and `spacious.css` and verifies their first-load stylesheet links in the generated `dist/index.html`.

Locally:

```bash
export SUPABASE_URL='https://YOUR-APPROVED-PROJECT.supabase.co'
export SUPABASE_ANON_KEY='YOUR-PUBLISHABLE-OR-ANON-KEY'
bash scripts/build-cloudflare.sh
```

Review the generated `dist/config.js` target before deployment. `config.js` contains public runtime configuration only. Supabase service-role/secret keys must be set as Supabase Edge Function secrets, never as Pages client variables.

## Shared demo requirements

The cloud demo seed is an explicit, admin-only RPC that inserts fictional rows atomically, refuses known demo-ID collisions, and never deletes existing records. Authorized staff on the selected development project can see those rows. A dedicated demo project with fictional-only data, role-tested RLS, demo-specific accounts, audited account lifecycle operations, rate limits and an approved reset/retention procedure remains safer for external reviewers. Do not provision demo users in a school production project.

Apply `supabase/migrations/20261124154800_shared_demo_seed.sql` to the selected development project before opening `/?demo=cloud`. The full `schema.sql` also includes this migration. The project must already have the KBMS schema, deployed sign-in functions and an active admin account. The build script does not apply SQL, seed data, create accounts or deploy the site. See `SHARED-DEMO-READINESS.md` for the isolated-demo recommendation and acceptance checklist.

## Before sharing

- Verify the generated deployment's Supabase URL is the dedicated demo project.
- Confirm all demo names and transactions are fictional.
- Test each reviewer role, denied requests, password change/reset and deactivation.
- Confirm account lifecycle audit coverage, strong-password settings, abuse controls and a demo reset process.
- Test page assets, responsive styles, login and major school workflows in a browser.

# KBMS online teacher demo — Cloudflare Pages plan

This package describes a **fictional-data demo only**. A shared demo is not provisioned by this repository change and must not connect to the school's staff/production database.

## Architecture

- Cloudflare Pages serves the static KBMS application over HTTPS.
- A separate, owner-approved Supabase project holds fictional demo records and demo-only staff accounts.
- The Supabase publishable/anon key is public by design; database RLS and server-side RPC authorization remain mandatory. Never put a Supabase service-role key in the site.
- Staff and demo deployments must use different Supabase projects and separately controlled Pages build environments.
- The current `/?demo=1` experience is browser-local IndexedDB, not a multi-device shared backend.

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

A shared reviewer experience requires a separate demo project, fictional-only seed data, role-tested RLS, demo-specific accounts, audited account lifecycle operations, rate limits and an approved reset/retention procedure. The existing normal staff account administration can be reused inside that isolated project. Do not provision demo users in the current staff project or point the public demo route at it.

See `SHARED-DEMO-READINESS.md` for current IndexedDB behavior, account flow review and a staged migration/acceptance checklist. Project creation, schema deployment, seeding, account provisioning and deployment require owner approval and are not performed by this build script.

## Before sharing

- Verify the generated deployment's Supabase URL is the dedicated demo project.
- Confirm all demo names and transactions are fictional.
- Test each reviewer role, denied requests, password change/reset and deactivation.
- Confirm account lifecycle audit coverage, strong-password settings, abuse controls and a demo reset process.
- Test page assets, responsive styles, login and major school workflows in a browser.

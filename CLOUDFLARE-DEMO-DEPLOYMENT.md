# KBMS online teacher demo — Cloudflare Pages plan

This package is prepared for a **fictional-data demo only**. It is not deployed, and it must not be connected to the school's production database.

## Architecture

- Cloudflare Pages serves the static KBMS application over HTTPS.
- A separate Supabase project named for the demo holds fictional demo records and demo-only staff accounts.
- The Supabase publishable/anon key is public by design; database Row Level Security (RLS) and server-side RPC authorization remain mandatory. Never place a Supabase service-role key in this site.
- Production school data must use a different Supabase project and a separately controlled deployment.

## One-time setup

1. Create a **new demo-only Supabase project**. Do not reuse any school production project.
2. Apply `schema.sql` to that demo project and run `tests/postgres-smoke-test.sql`. Deploy the username login and staff-admin Edge Functions as described in `DEPLOYMENT-AND-OPERATIONS.md`.
3. Create fictional demo users and records only. Configure RLS and test each demo role before sharing the URL.
4. Put this project in a private GitHub repository. Do not upload credentials, database dumps, student data, service-role keys or backup encryption keys.
5. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git** and select the private repository.
6. Set the production branch to `main`, build command to `bash scripts/build-cloudflare.sh`, and build output directory to `dist`.
7. Add these build environment variables to both Preview and Production, pointing **only to the demo project**:
   - `SUPABASE_URL` — the demo project's HTTPS URL.
   - `SUPABASE_ANON_KEY` — the demo project's publishable/anon key.
8. Deploy. Cloudflare supplies a `*.pages.dev` address. Send that link and each invited reviewer their own demo username and temporary password.

Cloudflare Pages Git integration automatically builds deployments when changes are pushed. It also supports preview deployments for branches. Keep preview and production environment variables pointed at the demo backend, never at the real school database.

## Build locally before publishing

On a machine with Bash and Node.js, set the two demo environment variables and run:

```bash
export SUPABASE_URL='https://YOUR-DEMO-PROJECT.supabase.co'
export SUPABASE_ANON_KEY='YOUR-DEMO-PUBLISHABLE-OR-ANON-KEY'
bash scripts/build-cloudflare.sh
```

The deployable static site is generated in `dist/`. The build script deliberately refuses to build if either demo setting is missing. It copies only runtime assets into `dist/`, not SQL, scripts, docs, tests, or backup utilities.

## Before sharing the demo

- Test teacher-reviewer and administrator demo accounts independently.
- Confirm the teacher reviewer has near-full permissions only inside the demo project.
- Confirm the demo database contains invented records only.
- Confirm sign-in, imports, class setup, archive flow, library issue/return, bookstore issue/return, exports and feedback work.
- Enable strong passwords and account rate limits; give every reviewer an individual account.
- Decide how demo resets are performed and retain an audit trail of reviewer actions.

## Important limitations

This Cloudflare plan deploys the **front-end** only. Supabase remains the database, authentication and server-side transaction backend. Cloudflare Pages does not make the local browser database shared by itself. The online demo becomes multi-user only after its separate Supabase project, schema, RLS and Edge Functions are configured and verified.

Cloudflare's current Pages documentation supports Git-connected deployments, build environment variables and preview deployments. Git integration is the recommended route for this maintained project; Cloudflare documents that a Git-integrated Pages project cannot later be switched to Direct Upload.

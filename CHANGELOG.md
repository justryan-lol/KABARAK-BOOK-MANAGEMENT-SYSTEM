## 2026-11-07 — first-load stylesheet and shared-demo safety

- Cloudflare build now injects an explicit responsive stylesheet link into generated HTML, so new visitors receive responsive overrides without relying on an installed service worker.
- Removed the build script's silent Supabase configuration fallback; deployments must explicitly set the target URL and public key.
- Bumped the service-worker cache and retained the source-folder fallback without duplicating styles in built Pages output.
- Added `SHARED-DEMO-READINESS.md` documenting the current IndexedDB-only demo, isolated-demo migration steps, existing account flow, audit coverage gaps and approval boundaries.
- Updated regression checks and Cloudflare demo deployment guidance. No Supabase project, database, account or deployment was changed.

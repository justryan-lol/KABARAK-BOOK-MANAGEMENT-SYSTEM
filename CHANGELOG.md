# Development build changes

## Complete development pass after Demo 8

- Added protected Supabase Edge Functions for username/password sign-in and administrator-only staff provisioning, password reset, activation/deactivation and role changes.
- Added first-login temporary-password change flow.
- Connected governance UI now supports staff management, academic-year creation/switching, class and subject directories, date-bound teacher assignments and server-audited Principal approval decisions.
- Added class-teacher allocation support constrained to the teacher's assigned class; subject teachers remain limited to their assigned subjects.
- Expanded Excel audit export into seven worksheets covering follow-up, student register, library inventory and history, textbook inventory and history, and clearances.
- Added encrypted PostgreSQL logical-backup scripts for Linux/macOS and Windows, checksum/retention handling and a guarded disposable restore drill.
- Added first-super-administrator bootstrap template and deployment/operations guide.
- Updated service-worker cache version so browsers fetch the changed app assets.

This is a development package, not a production deployment. See `TEST-RESULTS.md` for exactly what was verified and what still needs a school-controlled Supabase environment.

## Bookstore returns desk

- Added a dedicated **Process returns** navigation screen under Bookstore.
- Added independent search across outstanding textbook allocations by student name, admission number, textbook title, subject and individual copy code.
- Added a focused return queue showing academic year, due date, physical copy status and a direct record-return action.
- Kept the same server-confirmed return operation in connected mode; the allocation history is retained.
- Added regression checks for the dedicated screen and navigation.

## 1 November 2026 — form cancellation and bulk bookstore intake
- Fixed add/edit dialogs so Cancel and the close control bypass required-field validation and close without running save logic.
- Added a dedicated bookstore bulk-import action and downloadable CSV template for physical textbook copies.
- Bulk import accepts CSV and XLSX, supports repeated textbook titles with distinct copy codes, validates the full batch (including duplicate codes), and imports nothing if any row is invalid.
- Added a pre-import summary/confirmation and clarified the one-row-per-physical-copy rule.
- Added regression checks for cancellation behavior and textbook bulk-import safeguards.

## 2026-11-01 — Academic-year archives and Cloudflare demo preparation

- Added separate Bookstore **Academic year setup** and **Archives** screens.
- Added named class/stream creation using form/grade + class name (e.g., `Form 3 Delta`) to an academic year; year creation remains an administrator responsibility.
- Added protected academic-year archive RPC. It refuses to archive the current year, closes the selected year, deactivates its classes and records archive metadata without deleting student or transaction history.
- Added immutable class roster snapshots for exact `current_class` matches; archive screen exposes archived rosters read-only. Students are not automatically marked graduated and clearances/outstanding books still require their own workflows.
- Added local-demo academic-year setup and archive workflow.
- Added Cloudflare Pages build configuration, security headers and a deployment guide for a separate fictional-data demo backend.
- Bumped service-worker cache version.

## 2026-11-07 — responsive layout and navigation refinement
- Added a responsive refinement stylesheet for narrower desktop/tablet/mobile layouts, visible scrollbars, non-clipping tables and dialogs, and readable navigation.
- Fixed the public introduction page to flow vertically instead of clipping its lower sections at one viewport height.
- Updated the service worker to layer the responsive stylesheet over the existing design and precache it for offline use.
- Updated Cloudflare Pages packaging and static regression assertions for the new asset. Browser and deployment acceptance testing remain required.

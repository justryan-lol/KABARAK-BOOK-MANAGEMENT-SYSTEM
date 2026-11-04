# KBMS — Kabarak Book Management System

**Moi High School – Kabarak** · Official demonstration build

This is a local presentation build using fictional records only. It is not connected to the school's live data and must not be used for official lending, clearance or staff access.

## Start the demo

1. Extract the complete `KBMS-Work` folder.
2. On Windows, double-click `START-DEMO.bat`.
3. Open `http://127.0.0.1:8000/` if the browser does not open automatically.
4. On Overview, select **Load official demo records**.
5. Follow the walkthrough links to Student Register, Issue & Return, Textbook Register, Clearance & Reports, and Staff & Approvals.

The local server is bound to this computer only. Data is stored in this browser profile and does not synchronize to other devices.

## Prepared fictional scenario

- 1,000 fictional Grade 10 students distributed across Tana, Athi, Nzoia and Mara houses, both school sections and four class groups.
- Four individually coded library copies, kept separate from the bookstore register.
- 13 distinct textbook titles with 80 individually coded copies per title (1,040 physical textbook copies).
- 750 active textbook allocations across the 13 titles, each linked to a unique student and physical copy.
- Two active library loans, including one overdue loan showing the KSh 5-per-calendar-day estimate.
- Separate library and bookstore clearance history for one student.
- Five fictional staff profiles, two teacher assignments and one pending approval request.

Every name, admission number, staff profile, book title, code and transaction is invented.

## Features demonstrated

- Library copy cataloguing, issue, return, overdue tracking and late-fee estimates.
- Textbook register, individual copies and class/subject allocation workflows.
- Dedicated **Bookstore → Process returns** screen with search by admission number, student name, textbook title, subject or copy code; returns retain the original allocation history.
- Student register, profiles, CSV and Excel (`.xlsx`) intake, duplicate checks and a downloadable student template.
- Separate library and bookstore clearance history and guarded student departure. In shared mode, clearance is append-only and completion/reopening uses server-checked audited functions.
- Follow-up reports with CSV, a multi-worksheet `.xlsx` audit workbook and browser print-to-PDF.
- A local fictional staff/teacher assignment workflow preview; connected deployments include server-checked staff provisioning, username sign-in, mandatory first-login password changes and Principal approval decisions.

## Important limitations

- **No production database is configured.** The demo is single-browser and local-only.
- In local demo mode, staff/approval examples are fictional and do not create login accounts or authorize official actions. In connected mode, the governance screen uses the included protected Supabase Edge Functions and approval RPC; those functions still need deployment and live role testing in a school-controlled development project.
- Connected sign-in uses a staff username and password through `kbms-username-login`. Staff accounts are provisioned by an active administrator through `kbms-staff-admin`; temporary passwords are displayed once and must be changed at first sign-in. The username flow uses an internal `@staff.kbms.invalid` Auth address, not an email inbox.
- Database-side teacher allocation checks the active academic year, school section, assigned class, assigned subject, copy availability and duplicate allocations before committing a batch atomically. The deadline must exactly match the configured academic-year end date. Subject-teacher access to textbook copies and allocation history is scoped by subject; class teachers are scoped to their assigned class. Library issues and returns use server-side functions that lock the student/copy records; bookstore and teacher class allocations use atomic server-side batch functions. Staff assignments require active staff and class records; subject-teacher assignments also require an active subject. Assignment history cannot be deleted or rewritten, only closed with an end date. Student departure and clearance operations lock the student record so they cannot race with new issues or allocations. Library loans, textbook allocations, clearance events and audit events cannot be directly rewritten or deleted by authenticated clients. Date-sensitive server rules use the Africa/Nairobi calendar date. These controls are implemented in SQL but have not yet been executed against PostgreSQL.
- The schema includes an atomic current-academic-year switch, serialized staff-role changes, protected staff assignment history and a restricted staff-role assignment function. The included `kbms-staff-admin` Edge Function creates Auth accounts, assigns roles through the audited database function, resets passwords and activates/deactivates accounts. The browser never receives the service-role key.
- No live identity provider or school database is configured. The Edge Functions, staff onboarding UI, connected Principal approval queue, multi-sheet Excel export, encrypted backup scripts and disposable restore drill are included as deployable source, but they have not been deployed or tested against a live Supabase project. Backup scheduling, provider-managed point-in-time recovery and a witnessed restore remain operational tasks.
- In connected mode, synchronized school records are cleared from the browser on sign-out and when a different staff account signs in. Normal sign-out is paused while changes remain queued; unexpected session expiry clears the device cache and warns if pending changes were lost.
- The weekly library return day and any penalty exceptions must be confirmed by the school. The demo uses an example due date and shows an estimate, not a payment record.
- Hosting, privacy, data retention, provider location, ODPC compliance and school authorization require review before real student data is entered.

## Spreadsheet intake

Student and library imports accept `.xlsx` and `.csv`. Excel files are read from the first worksheet in the browser; no third-party conversion service is used. The whole file is validated before saving. If any row has an error or a duplicate admission number / book code, the import is stopped without adding rows. Existing student records are not overwritten.

Student headers: `admission_number`, `full_name`, `house`, `school_section`, `grade`, `class_number`. You may use `current_class` or `class_name` instead of `class_number`; the supplied class label is retained. House and school section are stored separately in the database; only an authorized administrator can correct either field. The combined code is maintained for display and compatibility. House codes are T, A, N and M; school section is G or B. A combined code such as TG is also accepted. If the spreadsheet supplies only a house name or initial, it must also supply the school section; KBMS will not guess it.

## Database foundation

`schema.sql` contains the evolving PostgreSQL foundation for the full staff role set, academic years, configurable classes and subjects, staff assignments, individual textbook copies, separate clearances, approval requests, audit events, configurable policy settings and row-level access rules. Approval decisions are restricted to a server-side function; direct updates to the approval queue are revoked. Old prototype sales tables are not created by this schema; if they exist from an earlier test installation, the script only revokes client access and does not automatically delete their old rows.

The SQL has not yet been applied to or tested against a PostgreSQL project. It needs a disposable development deployment and a full migration/RLS test before any pilot. Configure a current academic year with a four-digit starting year label and approved start/end dates before enabling shared textbook allocations. The `admin_set_staff_membership` RPC only assigns a role to an existing Auth user; it is not an account-creation function. Never place a service-role key or database password in browser code.

## Developer regression checks

From this folder, run:

```sh
node --check app.js
node --check config.js
node tests/checks.mjs
bash -n scripts/backup-postgres.sh scripts/restore-drill.sh
```

After applying `schema.sql` to a disposable Supabase development project, run `tests/postgres-smoke-test.sql` in the SQL editor. It checks RLS, protected function grants, immutable-history privileges, uniqueness indexes and the staff-membership audit trigger without changing records.

These checks validate JavaScript syntax and key security invariants in the SQL source. They do not replace applying `schema.sql` to a disposable PostgreSQL/Supabase development project, testing row-level security with separate staff accounts, or completing browser end-to-end tests.

### Allocation history protection

In a configured shared database, teachers submit allocations through the checked `teacher_allocate_textbooks` RPC. Bookstore staff can create allocations through the insert policy. Returns use `return_textbook_copy`, which checks the staff role and closes only an outstanding allocation using the server date. Authenticated clients cannot directly update or delete textbook allocation history. Corrections should be handled through a separately designed, audited correction workflow rather than editing old records.


See `DEPLOYMENT-AND-OPERATIONS.md` for the Edge Function deployment, first administrator bootstrap, encrypted backups and restore drill.


## Bookstore academic-year setup and archives

The Bookstore navigation now has separate **Academic year setup** and **Archives** screens. A bookstore administrator can add named classes (for example, `Form 3 Delta`) to an academic year created by an authorised school administrator. The current academic year cannot be archived. Releasing a completed year archives its classes, captures an immutable student roster snapshot where the student's stored `current_class` exactly matches the class label, and keeps all transaction and clearance history. It does not automatically graduate students or clear outstanding books; student departure and library/bookstore clearance remain separate processes.

The connected database requires the migration `supabase/migrations/202611010001_archive_years_and_bookstore_class_setup.sql` (also incorporated into `schema.sql`). Apply it to a disposable test project first and verify RLS/RPC behavior before any school deployment.

## Cloudflare Pages teacher-demo deployment

See `CLOUDFLARE-DEMO-DEPLOYMENT.md`. The project includes `wrangler.toml`, `_headers` and `scripts/build-cloudflare.sh`. Cloudflare Pages serves the front-end; a separate Supabase demo project supplies shared records, authentication and server-side authorization. The build script requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` for that demo project and intentionally copies only runtime assets into `dist/`. It does not deploy the site or configure the Supabase project automatically.

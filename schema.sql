create extension if not exists pgcrypto;

create table if not exists public.staff_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'librarian', 'read_only')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  admission_number text not null,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  house_code text not null check (house_code in ('AB', 'AG', 'MB', 'MG', 'NB', 'NG', 'TB', 'TG')),
  grade text not null check (grade in ('Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'Form 1', 'Form 2', 'Form 3', 'Form 4')),
  class_number smallint not null check (class_number between 1 and 16),
  clearance_status text not null default 'Pending' check (clearance_status in ('Pending', 'Cleared')),
  academic_status text not null default 'active' check (academic_status in ('active', 'graduated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admission_number)
);

create unique index if not exists students_admission_number_casefold
  on public.students (lower(admission_number));

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  accession_code text not null unique
    check (accession_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$'),
  prefix text check (prefix ~ '^[A-Z]{2,6}$'),
  accession_number text check (accession_number ~ '^[0-9]{3,8}$'),
  purchase_year smallint check (purchase_year between 1900 and 2100),
  title text not null check (length(trim(title)) between 1 and 240),
  subject text not null check (length(trim(subject)) between 1 and 100),
  publisher text not null default '',
  condition text not null default 'Available' check (condition in ('Available', 'Damaged', 'Lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.books alter column prefix drop not null;
alter table public.books alter column accession_number drop not null;
alter table public.books alter column purchase_year drop not null;
alter table public.books drop constraint if exists books_accession_code_check;
alter table public.books drop constraint if exists books_check;
alter table public.books drop constraint if exists books_accession_code_format;
alter table public.books add constraint books_accession_code_format
  check (accession_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$');
create unique index if not exists books_accession_code_casefold
  on public.books (lower(accession_code));
alter table public.books add column if not exists description text not null default '';
alter table public.books add column if not exists cover_image text;

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  book_id uuid not null references public.books (id) on delete restrict,
  student_admission_snapshot text not null,
  student_name_snapshot text not null,
  house_code_snapshot text not null check (house_code_snapshot in ('AB', 'AG', 'MB', 'MG', 'NB', 'NG', 'TB', 'TG')),
  grade_snapshot text not null,
  class_number_snapshot smallint not null check (class_number_snapshot between 1 and 16),
  book_code_snapshot text not null,
  book_title_snapshot text not null,
  purchase_year_snapshot smallint check (purchase_year_snapshot between 1900 and 2100),
  issued_at date not null default (now() at time zone 'Africa/Nairobi')::date,
  due_date date,
  returned_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (returned_at is null or returned_at >= issued_at),
  check (due_date is null or due_date > issued_at)
);

alter table public.loans alter column purchase_year_snapshot drop not null;

create unique index if not exists loans_one_open_loan_per_copy
  on public.loans (book_id) where returned_at is null;
create index if not exists loans_student_history on public.loans (student_id, issued_at desc);
create index if not exists loans_open_by_due_date on public.loans (due_date) where returned_at is null;

create table if not exists public.academic_rollovers (
  target_year integer primary key check (target_year between 2020 and 2200),
  processed_students integer not null,
  executed_by uuid not null references auth.users (id),
  executed_at timestamptz not null default now()
);

alter table public.staff_memberships enable row level security;
alter table public.students enable row level security;
alter table public.books enable row level security;
alter table public.loans enable row level security;
alter table public.academic_rollovers enable row level security;

drop policy if exists staff_read_own_membership on public.staff_memberships;
create policy staff_read_own_membership on public.staff_memberships
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists staff_read_library on public.students;
create policy staff_read_library on public.students for select to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists staff_write_library on public.students;
create policy staff_write_library on public.students for all to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')))
  with check (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')));

drop policy if exists staff_read_library on public.books;
create policy staff_read_library on public.books for select to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists staff_write_library on public.books;
create policy staff_write_library on public.books for all to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')))
  with check (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')));

drop policy if exists staff_read_library on public.loans;
create policy staff_read_library on public.loans for select to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists staff_write_library on public.loans;
create policy staff_write_library on public.loans for all to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')))
  with check (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')));

drop policy if exists admin_read_rollovers on public.academic_rollovers;
create policy admin_read_rollovers on public.academic_rollovers for select to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role = 'admin'));

grant select on public.staff_memberships to authenticated;
grant select, insert, update, delete on public.students, public.books, public.loans to authenticated;
grant select on public.academic_rollovers to authenticated;

create or replace function public.rollover_student_cohorts(p_target_year integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  staff_role text;
begin
  if p_target_year < 2020 or p_target_year > 2200 then
    raise exception 'Target academic year is outside the supported range';
  end if;

  select m.role into staff_role
    from public.staff_memberships m
    where m.user_id = (select auth.uid()) and m.active;

  if staff_role is distinct from 'admin' then
    raise exception 'An active library administrator account is required';
  end if;

  insert into public.academic_rollovers (target_year, processed_students, executed_by)
  values (p_target_year, 0, (select auth.uid()))
  on conflict (target_year) do nothing;

  if not found then
    raise exception 'Academic rollover for % has already been completed', p_target_year;
  end if;

  update public.students
  set academic_status = case
        when grade in ('Form 4', 'Grade 12') then 'graduated'
        else 'active'
      end,
      grade = case
        when p_target_year >= 2028 then case grade
          when 'Grade 7' then 'Grade 8'
          when 'Grade 8' then 'Grade 9'
          when 'Grade 9' then 'Grade 10'
          when 'Grade 10' then 'Grade 11'
          when 'Grade 11' then 'Grade 12'
          when 'Form 1' then 'Grade 10'
          when 'Form 2' then 'Grade 11'
          when 'Form 3' then 'Grade 12'
          else grade
        end
        else case grade
          when 'Grade 7' then 'Grade 8'
          when 'Grade 8' then 'Grade 9'
          when 'Grade 9' then 'Form 1'
          when 'Form 1' then 'Form 2'
          when 'Form 2' then 'Form 3'
          when 'Form 3' then 'Form 4'
          else grade
        end
      end,
      clearance_status = 'Pending',
      updated_at = now()
  where academic_status = 'active';

  get diagnostics changed = row_count;
  update public.academic_rollovers set processed_students = changed where target_year = p_target_year;
  return changed;
end;
$$;

revoke all on function public.rollover_student_cohorts(integer) from public;
grant execute on function public.rollover_student_cohorts(integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'students') then
      alter publication supabase_realtime add table public.students;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'books') then
      alter publication supabase_realtime add table public.books;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'loans') then
      alter publication supabase_realtime add table public.loans;
    end if;
  end if;
end;
$$;

-- Bookstore textbooks are individually coded loanable copies. KBMS has no point-of-sale,
-- product pricing, sales, receipts or payment ledger.
create table if not exists public.textbook_copies (
  id uuid primary key default gen_random_uuid(),
  copy_code text not null check (copy_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$'),
  title text not null check (length(trim(title)) between 1 and 240),
  subject text not null check (length(trim(subject)) between 1 and 100),
  publisher text not null default '',
  purchase_year smallint check (purchase_year between 1900 and 2100),
  condition text not null default 'Available' check (condition in ('Available', 'Damaged', 'Lost')),
  cover_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists textbook_copies_copy_code_casefold
  on public.textbook_copies (lower(copy_code));

create table if not exists public.textbook_allocations (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.textbook_copies (id) on delete restrict,
  copy_code_snapshot text not null,
  title_snapshot text not null,
  subject_snapshot text not null default '',
  student_id uuid not null references public.students (id) on delete restrict,
  student_admission_snapshot text not null,
  student_name_snapshot text not null,
  grade_snapshot text not null,
  class_number_snapshot smallint not null check (class_number_snapshot between 1 and 16),
  academic_year integer not null check (academic_year between 2020 and 2200),
  allocated_at date not null default (now() at time zone 'Africa/Nairobi')::date,
  due_date date not null,
  returned_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date >= allocated_at),
  check (returned_at is null or returned_at >= allocated_at)
);
create unique index if not exists textbook_allocations_one_active_per_copy
  on public.textbook_allocations (copy_id) where returned_at is null;
create index if not exists textbook_allocations_student_history
  on public.textbook_allocations (student_id, allocated_at desc);
create index if not exists textbook_allocations_open_by_due_date
  on public.textbook_allocations (due_date) where returned_at is null;

alter table public.textbook_copies enable row level security;
alter table public.textbook_allocations enable row level security;

drop policy if exists staff_read_textbook_copies on public.textbook_copies;
create policy staff_read_textbook_copies on public.textbook_copies for select to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists staff_write_textbook_copies on public.textbook_copies;
create policy staff_write_textbook_copies on public.textbook_copies for all to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')))
  with check (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')));

drop policy if exists staff_read_textbook_allocations on public.textbook_allocations;
create policy staff_read_textbook_allocations on public.textbook_allocations for select to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists staff_write_textbook_allocations on public.textbook_allocations;
create policy staff_write_textbook_allocations on public.textbook_allocations for all to authenticated
  using (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')))
  with check (exists (select 1 from public.staff_memberships m where m.user_id = (select auth.uid()) and m.active and m.role in ('admin', 'librarian')));

grant select, insert, update, delete on public.textbook_copies to authenticated;
grant select, insert, update, delete on public.textbook_allocations to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'textbook_copies') then
      alter publication supabase_realtime add table public.textbook_copies;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'textbook_allocations') then
      alter publication supabase_realtime add table public.textbook_allocations;
    end if;
  end if;
end $$;

-- KBMS institutional foundation (additive migration; preserves existing lending history).
-- No point-of-sale, pricing, sales, receipts or payment ledger are included.

alter table public.staff_memberships drop constraint if exists staff_memberships_role_check;
alter table public.staff_memberships add constraint staff_memberships_role_check check (role in (
  'admin','librarian','read_only','super_admin','library_admin','library_assistant',
  'bookstore_admin','bookstore_assistant','auditor','principal','deputy_principal',
  'teacher','class_teacher','subject_teacher'
));

-- Keep house identity separate from the school's operational section.
alter table public.students add column if not exists house text;
alter table public.students add column if not exists school_section text;
alter table public.students add column if not exists current_class text;
alter table public.students add column if not exists active boolean not null default true;
alter table public.students add column if not exists departed_at timestamptz;
alter table public.students add column if not exists departure_reason text not null default '';
alter table public.students add column if not exists admission_year integer;
update public.students set house = left(house_code,1), school_section = right(house_code,1)
 where house is null and house_code in ('TG','TB','AG','AB','NG','NB','MG','MB');
update public.students set current_class = grade || ' · Class ' || class_number where current_class is null;
alter table public.students alter column house set not null;
alter table public.students alter column school_section set not null;
alter table public.students drop constraint if exists students_house_check;
alter table public.students add constraint students_house_check check (house in ('T','A','N','M'));
alter table public.students drop constraint if exists students_school_section_check;
alter table public.students add constraint students_school_section_check check (school_section in ('G','B'));
alter table public.students drop constraint if exists students_grade_check;
alter table public.students drop constraint if exists students_class_number_check;
alter table public.students drop constraint if exists students_class_number_check1;
alter table public.students drop constraint if exists students_check;
alter table public.students alter column grade type text;
alter table public.students alter column class_number drop not null;
alter table public.students drop constraint if exists students_class_number_positive;
alter table public.students add constraint students_class_number_positive check (class_number is null or class_number > 0);

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  year_label text not null unique,
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  status text not null default 'planned' check (status in ('planned','active','closed')),
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create unique index if not exists academic_years_one_current on public.academic_years (is_current) where is_current;

create unique index if not exists academic_years_single_current
  on public.academic_years (is_current) where is_current = true;

create table if not exists public.school_classes (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid references public.academic_years(id) on delete restrict,
  grade_label text not null,
  class_label text not null,
  school_section text check (school_section in ('G','B')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (academic_year_id, grade_label, class_label, school_section)
);

create table if not exists public.school_subjects (
  id uuid primary key default gen_random_uuid(),
  subject_code text not null unique,
  subject_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  staff_number text unique,
  display_name text not null,
  username text unique,
  department text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_profiles_username_casefold
  on public.staff_profiles (lower(username)) where username is not null and username <> '';

create table if not exists public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  assignment_type text not null check (assignment_type in ('class_teacher','subject_teacher','substitute')),
  class_id uuid references public.school_classes(id) on delete restrict,
  subject_id uuid references public.school_subjects(id) on delete restrict,
  starts_on date not null,
  ends_on date,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check ((assignment_type = 'class_teacher' and class_id is not null and subject_id is null)
      or (assignment_type = 'subject_teacher' and class_id is not null and subject_id is not null)
      or (assignment_type = 'substitute' and class_id is not null))
);
create index if not exists staff_assignments_active on public.staff_assignments(staff_user_id, starts_on, ends_on);

create table if not exists public.clearance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  department text not null check (department in ('library','bookstore')),
  academic_year_id uuid references public.academic_years(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','cleared','blocked','reopened')),
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clearance_records_student on public.clearance_records(student_id, department, created_at desc);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null,
  target_table text not null,
  target_id uuid,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  request_reason text not null,
  decision_note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  check (decided_by is null or decided_by <> requested_by)
);
create index if not exists approval_requests_queue on public.approval_requests(status, requested_at desc);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  before_data jsonb,
  after_data jsonb,
  reason text not null default '',
  request_id uuid references public.approval_requests(id) on delete set null
);
create index if not exists audit_events_time on public.audit_events(occurred_at desc);
create index if not exists audit_events_actor on public.audit_events(actor_user_id, occurred_at desc);

create table if not exists public.system_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  description text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.system_settings(setting_key,setting_value,description) values
 ('library_late_fee_kes_per_calendar_day','5'::jsonb,'Configured library late fee in Kenyan shillings per calendar day; confirm policy before production.'),
 ('library_renewals_enabled','false'::jsonb,'Renewals remain disabled until approved by the school.'),
 ('library_due_day','null'::jsonb,'Weekly return day must be configured by the school.'),
 ('textbook_return_rule','"academic_year_end"'::jsonb,'Textbook copies are returned at the end of the academic year.'),
 ('school_house_codes','{"T":"Tana","A":"Athi","N":"Nzoia","M":"Mara"}'::jsonb,'Permanent student house codes.')
on conflict (setting_key) do nothing;

create or replace function public.kbms_is_active_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.staff_memberships m where m.user_id = auth.uid() and m.active) $$;

create or replace function public.kbms_has_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.staff_memberships m where m.user_id = auth.uid() and m.active and m.role = any(allowed_roles)) $$;

-- Approval decisions are made through a narrow server-side function. Direct table updates are revoked.
create or replace function public.decide_approval_request(
  p_request_id uuid,
  p_decision text,
  p_decision_note text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare request_row public.approval_requests%rowtype;
begin
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']) then
    raise exception 'Only an authorized school approver may decide this request';
  end if;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if p_decision_note is null or length(trim(p_decision_note)) < 3 or length(p_decision_note) > 1000 then
    raise exception 'Enter a decision reason between 3 and 1000 characters';
  end if;
  select * into request_row
    from public.approval_requests
    where id = p_request_id
    for update;
  if not found then raise exception 'Approval request was not found'; end if;
  if request_row.status <> 'pending' then raise exception 'This request has already been decided'; end if;
  if request_row.requested_by = auth.uid() then raise exception 'A person cannot approve their own request'; end if;

  update public.approval_requests
    set status = p_decision, decided_by = auth.uid(), decided_at = now(),
        decision_note = trim(p_decision_note)
    where id = p_request_id;
  return p_request_id;
end $$;
revoke all on function public.decide_approval_request(uuid,text,text) from public;
grant execute on function public.decide_approval_request(uuid,text,text) to authenticated;

create or replace function public.kbms_write_audit_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events(actor_user_id,action,table_name,record_id,before_data,after_data)
  values(auth.uid(),tg_op,tg_table_name,
    coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'user_id',to_jsonb(old)->>'user_id',to_jsonb(new)->>'setting_key',to_jsonb(old)->>'setting_key',to_jsonb(new)->>'staff_user_id',to_jsonb(old)->>'staff_user_id'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students','books','loans','textbook_copies','textbook_allocations','clearance_records','approval_requests','staff_assignments','staff_profiles','school_classes','school_subjects','system_settings'] loop
    execute format('drop trigger if exists kbms_audit_%I on public.%I',t,t);
    execute format('create trigger kbms_audit_%I after insert or update or delete on public.%I for each row execute function public.kbms_write_audit_event()',t,t);
  end loop;
end $$;

alter table public.academic_years enable row level security;
alter table public.school_classes enable row level security;
alter table public.school_subjects enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.clearance_records enable row level security;
alter table public.approval_requests enable row level security;
alter table public.audit_events enable row level security;
alter table public.system_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['academic_years','school_classes','school_subjects','staff_profiles','staff_assignments','clearance_records','approval_requests','audit_events','system_settings'] loop
    execute format('drop policy if exists kbms_staff_read on public.%I',t);
    execute format('create policy kbms_staff_read on public.%I for select to authenticated using (public.kbms_is_active_staff())',t);
  end loop;
end $$;

drop policy if exists kbms_staff_read on public.staff_profiles;
create policy kbms_staff_read on public.staff_profiles for select to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','auditor']) or user_id = auth.uid());
drop policy if exists kbms_staff_read on public.staff_assignments;
create policy kbms_staff_read on public.staff_assignments for select to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','auditor']) or staff_user_id = auth.uid());

drop policy if exists kbms_admin_manage_classes on public.school_classes;
drop policy if exists kbms_admin_manage_subjects on public.school_subjects;
drop policy if exists kbms_admin_manage_staff on public.staff_profiles;
drop policy if exists kbms_admin_manage_assignments on public.staff_assignments;
drop policy if exists kbms_request_approval on public.approval_requests;
drop policy if exists kbms_decide_approval on public.approval_requests;
drop policy if exists kbms_settings_manage on public.system_settings;
create policy kbms_admin_manage_classes on public.school_classes for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']))
 with check (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']));
create policy kbms_admin_manage_subjects on public.school_subjects for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']))
 with check (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']));
create policy kbms_admin_manage_staff on public.staff_profiles for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin']))
 with check (public.kbms_has_role(array['super_admin','admin']));
create policy kbms_admin_manage_assignments on public.staff_assignments for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']))
 with check (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']));
drop policy if exists kbms_department_clearance_update on public.clearance_records;
create policy kbms_department_clearance_update on public.clearance_records for all to authenticated
 using (public.kbms_is_active_staff()) with check (public.kbms_is_active_staff());
create policy kbms_request_approval on public.approval_requests for insert to authenticated
 with check (public.kbms_is_active_staff() and requested_by = auth.uid());
drop policy if exists kbms_audit_read on public.audit_events;
create policy kbms_audit_read on public.audit_events for select to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','auditor']));
create policy kbms_settings_manage on public.system_settings for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin']))
 with check (public.kbms_has_role(array['super_admin','admin']));

revoke update, delete on public.audit_events from authenticated;
grant select, insert, update, delete on public.academic_years, public.school_classes, public.school_subjects,
 public.staff_profiles, public.staff_assignments, public.clearance_records, public.system_settings to authenticated;
grant select, insert on public.approval_requests to authenticated;
revoke update, delete on public.approval_requests from authenticated;
grant select on public.audit_events to authenticated;

-- Replace legacy two-role write policies with department-aware staff permissions.
drop policy if exists staff_write_library on public.students;
create policy staff_write_library on public.students for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant','principal','deputy_principal']))
 with check (public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant','principal','deputy_principal']));
drop policy if exists staff_write_library on public.books;
create policy staff_write_library on public.books for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant']))
 with check (public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant']));
drop policy if exists staff_write_library on public.loans;
create policy staff_write_library on public.loans for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant']))
 with check (public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant']));
drop policy if exists staff_write_textbook_copies on public.textbook_copies;
create policy staff_write_textbook_copies on public.textbook_copies for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant']))
 with check (public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant']));
drop policy if exists staff_write_textbook_allocations on public.textbook_allocations;
create policy staff_write_textbook_allocations on public.textbook_allocations for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant','teacher','subject_teacher','class_teacher']))
 with check (public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant','teacher','subject_teacher','class_teacher']));

-- Flexible class labels: the school can change its grade/class structure without code changes.
alter table public.loans drop constraint if exists loans_class_number_snapshot_check;
alter table public.loans alter column class_number_snapshot drop not null;
alter table public.loans add column if not exists class_snapshot text not null default '';
alter table public.textbook_allocations drop constraint if exists textbook_allocations_class_number_check;
alter table public.textbook_allocations alter column class_number_snapshot drop not null;
alter table public.textbook_allocations add column if not exists class_snapshot text not null default '';

-- Clearance is separate for the two departments; audit visibility is restricted.
drop policy if exists kbms_department_clearance_update on public.clearance_records;
drop policy if exists kbms_library_clearance_write on public.clearance_records;
drop policy if exists kbms_bookstore_clearance_write on public.clearance_records;
create policy kbms_library_clearance_write on public.clearance_records for all to authenticated
 using (department = 'library' and public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant']))
 with check (department = 'library' and public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant']));
create policy kbms_bookstore_clearance_write on public.clearance_records for all to authenticated
 using (department = 'bookstore' and public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin','bookstore_assistant']))
 with check (department = 'bookstore' and public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin','bookstore_assistant']));
drop policy if exists kbms_staff_read on public.audit_events;
drop policy if exists kbms_audit_read on public.audit_events;
create policy kbms_audit_read on public.audit_events for select to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','auditor']));

-- Policies are safe to re-apply during development setup.
drop policy if exists kbms_admin_manage_classes on public.school_classes;
drop policy if exists kbms_admin_manage_subjects on public.school_subjects;
drop policy if exists kbms_admin_manage_staff on public.staff_profiles;
drop policy if exists kbms_admin_manage_assignments on public.staff_assignments;
drop policy if exists kbms_request_approval on public.approval_requests;
drop policy if exists kbms_decide_approval on public.approval_requests;
drop policy if exists kbms_settings_manage on public.system_settings;
create policy kbms_admin_manage_classes on public.school_classes for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']))
 with check (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']));
create policy kbms_admin_manage_subjects on public.school_subjects for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']))
 with check (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']));
create policy kbms_admin_manage_staff on public.staff_profiles for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin']))
 with check (public.kbms_has_role(array['super_admin','admin']));
create policy kbms_admin_manage_assignments on public.staff_assignments for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']))
 with check (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']));
create policy kbms_request_approval on public.approval_requests for insert to authenticated
 with check (public.kbms_is_active_staff() and requested_by = auth.uid());
create policy kbms_settings_manage on public.system_settings for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin']))
 with check (public.kbms_has_role(array['super_admin','admin']));

alter table public.textbook_allocations drop constraint if exists textbook_allocations_class_number_snapshot_check;

-- Atomic, server-checked clearance operation. The browser must not clear from a stale cache.
create or replace function public.record_student_clearance(
  p_student_id uuid,
  p_department text,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  latest_status text;
begin
  perform 1 from public.students where id = p_student_id and active for update;
  if not found then raise exception 'Student is not active'; end if;
  if p_department = 'library' then
    if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant']) then
      raise exception 'Not authorized to record library clearance';
    end if;
    if exists(select 1 from public.loans where student_id = p_student_id and returned_at is null) then
      raise exception 'Student has outstanding library loans';
    end if;
  elsif p_department = 'bookstore' then
    if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin','bookstore_assistant']) then
      raise exception 'Not authorized to record bookstore clearance';
    end if;
    if exists(select 1 from public.textbook_allocations where student_id = p_student_id and returned_at is null) then
      raise exception 'Student has outstanding textbook allocations';
    end if;
  else
    raise exception 'Unknown clearance department';
  end if;
  select status into latest_status from public.clearance_records
    where student_id = p_student_id and department = p_department
    order by created_at desc, id desc limit 1;
  if latest_status = 'cleared' then
    raise exception 'This department has already cleared the student; reopen it before recording another clearance';
  end if;
  insert into public.clearance_records(student_id,department,status,checked_by,checked_at,notes)
  values(p_student_id,p_department,'cleared',auth.uid(),now(),coalesce(p_notes,''))
  returning id into new_id;
  return new_id;
end $$;
grant execute on function public.record_student_clearance(uuid,text,text) to authenticated;

-- Direct table writes remain restricted to bookstore administrators; teaching staff use the checked batch RPC below.
drop policy if exists staff_write_textbook_allocations on public.textbook_allocations;
create policy staff_write_textbook_allocations on public.textbook_allocations for all to authenticated
 using (public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant']))
 with check (public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant']));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clearance_records') then
      alter publication supabase_realtime add table public.clearance_records;
    end if;
  end if;
end $$;

create or replace function public.depart_student(p_student_id uuid, p_reason text default '')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  library_status text;
  bookstore_status text;
begin
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']) then
    raise exception 'Not authorized to record a student departure';
  end if;
  perform 1 from public.students where id = p_student_id and active for update;
  if not found then raise exception 'Student is already inactive or does not exist'; end if;
  if exists(select 1 from public.loans where student_id = p_student_id and returned_at is null) then
    raise exception 'Student still has outstanding library books';
  end if;
  if exists(select 1 from public.textbook_allocations where student_id = p_student_id and returned_at is null) then
    raise exception 'Student still has outstanding bookstore textbooks';
  end if;
  select status into library_status from public.clearance_records
    where student_id = p_student_id and department = 'library' order by created_at desc, id desc limit 1;
  select status into bookstore_status from public.clearance_records
    where student_id = p_student_id and department = 'bookstore' order by created_at desc, id desc limit 1;
  if library_status is distinct from 'cleared' or bookstore_status is distinct from 'cleared' then
    raise exception 'Both library and bookstore clearances must be completed first';
  end if;
  update public.students set active = false, departed_at = now(), departure_reason = coalesce(p_reason,''),
    academic_status = 'departed', updated_at = now()
    where id = p_student_id and active = true;
  if not found then raise exception 'Student is already inactive or does not exist'; end if;
  return true;
end $$;
grant execute on function public.depart_student(uuid,text) to authenticated;

-- Subject teachers and approved substitutes can allocate only copies of their
-- assigned subject to students in their assigned class. The batch is atomic:
-- if any row fails validation, no allocation in the batch is committed.
create or replace function public.teacher_allocate_textbooks(
  p_allocations jsonb,
  p_academic_year integer,
  p_due_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  allocation_row record;
  created_ids jsonb := '[]'::jsonb;
  created_id uuid;
  row_count integer;
  staff_role text;
  current_year_start integer;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) is distinct from 'array' then raise exception 'Allocations must be supplied as a list'; end if;
  row_count := jsonb_array_length(p_allocations);
  if row_count < 1 or row_count > 500 then raise exception 'A batch must contain between 1 and 500 allocations'; end if;
  if p_academic_year is null or p_academic_year < 2020 or p_academic_year > 2200 then raise exception 'Invalid academic year'; end if;
  if p_due_date is null or p_due_date < (now() at time zone 'Africa/Nairobi')::date then raise exception 'Choose a valid future return date'; end if;
  select substring(ay.year_label from '^[0-9]{4}')::integer into current_year_start
    from public.academic_years ay where ay.is_current;
  if current_year_start is distinct from p_academic_year then
    raise exception 'The selected academic year is not the school''s current academic year';
  end if;

  select m.role into staff_role
    from public.staff_memberships m
    where m.user_id = auth.uid() and m.active;
  if staff_role is null or staff_role not in ('teacher','subject_teacher','class_teacher') then
    raise exception 'This operation is reserved for teaching staff';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    group by x.student_id having count(*) > 1
  ) then raise exception 'A student appears more than once in this allocation batch'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    group by x.copy_id having count(*) > 1
  ) then raise exception 'A textbook copy appears more than once in this allocation batch'; end if;

  for allocation_row in
    select x.id, x.student_id, x.copy_id
    from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    order by x.copy_id
  loop
    if allocation_row.id is null or allocation_row.student_id is null or allocation_row.copy_id is null then
      raise exception 'Every allocation needs a student and a textbook copy';
    end if;
    perform 1 from public.textbook_copies b
      where b.id = allocation_row.copy_id and b.condition = 'Available'
      for update;
    if not found then raise exception 'A selected textbook copy is missing or unavailable'; end if;
    perform 1 from public.students s
      where s.id = allocation_row.student_id and s.active
      for share;
    if not found then raise exception 'A selected student is inactive or no longer exists'; end if;
    if not exists (
      select 1
      from public.students s
      join public.school_classes c
        on c.active
       and c.class_label = coalesce(nullif(s.current_class,''), s.grade || ' · Class ' || coalesce(s.class_number::text,''))
       and c.school_section = s.school_section
      join public.academic_years ay on ay.id = c.academic_year_id and ay.is_current
      join public.staff_assignments a on a.class_id = c.id
      left join public.school_subjects sub on sub.id = a.subject_id and sub.active
      join public.textbook_copies b on (
        (staff_role = 'class_teacher' and a.assignment_type = 'class_teacher')
        or (staff_role in ('teacher','subject_teacher') and a.assignment_type in ('subject_teacher','substitute')
          and a.subject_id is not null and (lower(sub.subject_name) = lower(b.subject) or lower(sub.subject_code) = lower(b.subject)))
      )
      where s.id = allocation_row.student_id and s.active
        and b.id = allocation_row.copy_id and b.condition = 'Available'
        and a.staff_user_id = auth.uid()
        and ((staff_role = 'class_teacher' and a.assignment_type = 'class_teacher' and a.subject_id is null)
          or (staff_role in ('teacher','subject_teacher') and a.assignment_type in ('subject_teacher','substitute') and a.subject_id is not null))
        and a.starts_on <= (now() at time zone 'Africa/Nairobi')::date and (a.ends_on is null or a.ends_on >= (now() at time zone 'Africa/Nairobi')::date)
    ) then
      raise exception 'You are not assigned to this student''s class and this textbook subject, or the copy is unavailable';
    end if;
    if exists (select 1 from public.textbook_allocations ta where ta.copy_id = allocation_row.copy_id and ta.returned_at is null) then
      raise exception 'A selected textbook copy has already been allocated';
    end if;
    if exists (select 1 from public.textbook_allocations ta where ta.student_id = allocation_row.student_id and ta.copy_id = allocation_row.copy_id and ta.returned_at is null) then
      raise exception 'This student already has this textbook copy';
    end if;
  end loop;

  for allocation_row in
    select x.id, x.student_id, x.copy_id
    from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
  loop
    insert into public.textbook_allocations (
      id, copy_id, copy_code_snapshot, title_snapshot, subject_snapshot,
      student_id, student_admission_snapshot, student_name_snapshot,
      grade_snapshot, class_number_snapshot, class_snapshot,
      academic_year, allocated_at, due_date
    )
    select allocation_row.id, b.id, b.copy_code, b.title, b.subject,
      s.id, s.admission_number, s.full_name, s.grade, s.class_number,
      coalesce(nullif(s.current_class,''), s.grade || ' · Class ' || coalesce(s.class_number::text,'')),
      p_academic_year, (now() at time zone 'Africa/Nairobi')::date, p_due_date
    from public.students s cross join public.textbook_copies b
    where s.id = allocation_row.student_id and b.id = allocation_row.copy_id
    returning id into created_id;
    created_ids := created_ids || jsonb_build_array(created_id);
  end loop;
  return created_ids;
end;
$$;

revoke all on function public.teacher_allocate_textbooks(jsonb,integer,date) from public, anon;
revoke all on function public.return_textbook_copy(uuid) from public, anon;
grant execute on function public.teacher_allocate_textbooks(jsonb,integer,date) to authenticated;
grant execute on function public.return_textbook_copy(uuid) to authenticated;

-- Teacher visibility is restricted to their currently assigned classes.
create or replace function public.kbms_teacher_assigned_to_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    join public.school_classes c
      on c.active
     and c.class_label = coalesce(nullif(s.current_class,''), s.grade || ' · Class ' || coalesce(s.class_number::text,''))
     and c.school_section = s.school_section
    join public.academic_years ay on ay.id = c.academic_year_id and ay.is_current
    join public.staff_assignments a on a.class_id = c.id
    where s.id = p_student_id and s.active and a.staff_user_id = auth.uid()
      and a.starts_on <= (now() at time zone 'Africa/Nairobi')::date and (a.ends_on is null or a.ends_on >= (now() at time zone 'Africa/Nairobi')::date)
  )
$$;

create or replace function public.kbms_teacher_assigned_to_allocation(p_student_id uuid, p_subject text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    join public.school_classes c
      on c.active
     and c.class_label = coalesce(nullif(s.current_class,''), s.grade || ' · Class ' || coalesce(s.class_number::text,''))
     and c.school_section = s.school_section
    join public.academic_years ay on ay.id = c.academic_year_id and ay.is_current
    join public.staff_assignments a on a.class_id = c.id
    left join public.school_subjects sub on sub.id = a.subject_id and sub.active
    where s.id = p_student_id and s.active
      and a.staff_user_id = auth.uid()
      and a.starts_on <= (now() at time zone 'Africa/Nairobi')::date and (a.ends_on is null or a.ends_on >= (now() at time zone 'Africa/Nairobi')::date)
      and ((a.assignment_type = 'class_teacher' and a.subject_id is null)
        or (a.assignment_type in ('subject_teacher','substitute') and a.subject_id is not null
          and (lower(sub.subject_name) = lower(coalesce(p_subject,''))
            or lower(sub.subject_code) = lower(coalesce(p_subject,'')))))
  )
$$;

drop policy if exists staff_read_library on public.students;
create policy staff_read_library on public.students for select to authenticated
 using (
   public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant','bookstore_admin','bookstore_assistant','auditor','read_only'])
   or public.kbms_teacher_assigned_to_student(id)
 );
drop policy if exists staff_read_library on public.books;
create policy staff_read_library on public.books for select to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant','auditor','read_only']));
drop policy if exists staff_read_library on public.loans;
create policy staff_read_library on public.loans for select to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant','auditor','read_only']));
drop policy if exists staff_read_textbook_copies on public.textbook_copies;
create policy staff_read_textbook_copies on public.textbook_copies for select to authenticated
 using (
   public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin','bookstore_assistant','auditor','read_only'])
   or exists (
     select 1 from public.staff_assignments a
     join public.school_subjects sub on sub.id = a.subject_id and sub.active
     where a.staff_user_id = auth.uid()
       and a.assignment_type in ('subject_teacher','substitute')
       and a.starts_on <= (now() at time zone 'Africa/Nairobi')::date and (a.ends_on is null or a.ends_on >= (now() at time zone 'Africa/Nairobi')::date)
       and (lower(sub.subject_name) = lower(textbook_copies.subject)
         or lower(sub.subject_code) = lower(textbook_copies.subject))
   )
   or exists (
     select 1 from public.staff_assignments a
     where a.staff_user_id = auth.uid() and a.assignment_type = 'class_teacher' and a.subject_id is null
       and a.starts_on <= (now() at time zone 'Africa/Nairobi')::date
       and (a.ends_on is null or a.ends_on >= (now() at time zone 'Africa/Nairobi')::date)
   )
 );
drop policy if exists staff_read_textbook_allocations on public.textbook_allocations;
create policy staff_read_textbook_allocations on public.textbook_allocations for select to authenticated
 using (
   public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin','bookstore_assistant','auditor','read_only'])
   or public.kbms_teacher_assigned_to_allocation(student_id, subject_snapshot)
 );
drop policy if exists kbms_staff_read on public.clearance_records;
drop policy if exists kbms_clearance_read on public.clearance_records;
create policy kbms_clearance_read on public.clearance_records for select to authenticated
 using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant','bookstore_admin','bookstore_assistant','auditor']));
drop policy if exists kbms_staff_read on public.approval_requests;
drop policy if exists kbms_approval_read on public.approval_requests;
create policy kbms_approval_read on public.approval_requests for select to authenticated
 using (requested_by = auth.uid() or public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','auditor']));

-- Retire the old prototype sales API. Existing legacy tables, if any, are not used by KBMS.
drop function if exists public.record_shop_sale(uuid, uuid, integer, numeric, text);
do $$
begin
  if to_regclass('public.shop_items') is not null then
    execute 'revoke all on public.shop_items from anon, authenticated';
  end if;
  if to_regclass('public.shop_sales') is not null then
    execute 'revoke all on public.shop_sales from anon, authenticated';
  end if;
end $$;

-- The legacy fixed-grade rollover is disabled. Promotion needs the school's configured class map.
revoke all on function public.rollover_student_cohorts(integer) from public, authenticated;

alter table public.students drop constraint if exists students_academic_status_check;
alter table public.students add constraint students_academic_status_check
  check (academic_status in ('active','graduated','departed','transferred','inactive'));

-- Textbook returns are append-only in practice: clients cannot rewrite or
-- delete allocation history. A narrow server function closes an open allocation.
create or replace function public.return_textbook_copy(p_allocation_id uuid)
returns date
language plpgsql security definer set search_path = ''
as $$
declare returned_date date;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant']) then
    raise exception 'Not authorized to record textbook returns';
  end if;
  update public.textbook_allocations
     set returned_at = (now() at time zone 'Africa/Nairobi')::date, updated_at = now()
   where id = p_allocation_id and returned_at is null
   returning returned_at into returned_date;
  if returned_date is null then
    raise exception 'This allocation is already returned or does not exist';
  end if;
  return returned_date;
end;
$$;

-- Replace broad write access with insert-only access for bookstore staff.
-- Returns go through return_textbook_copy(); history cannot be edited/deleted.
drop policy if exists staff_write_textbook_allocations on public.textbook_allocations;
create policy staff_insert_textbook_allocations on public.textbook_allocations for insert to authenticated
  with check (public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant']));
grant select, insert on public.textbook_allocations to authenticated;
revoke update, delete on public.textbook_allocations from anon, authenticated;

-- Final privilege hardening: SECURITY DEFINER routines must never inherit
-- PostgreSQL's default EXECUTE privilege for PUBLIC (which includes anon).
revoke all on function public.kbms_is_active_staff() from public, anon;
revoke all on function public.kbms_has_role(text[]) from public, anon;
revoke all on function public.kbms_teacher_assigned_to_student(uuid) from public, anon;
revoke all on function public.kbms_teacher_assigned_to_allocation(uuid,text) from public, anon;
revoke all on function public.kbms_write_audit_event() from public, anon;
revoke all on function public.record_student_clearance(uuid,text,text) from public, anon;
revoke all on function public.depart_student(uuid,text) from public, anon;
revoke all on function public.decide_approval_request(uuid,text,text) from public, anon;
revoke all on function public.teacher_allocate_textbooks(jsonb,integer,date) from public, anon;

-- RLS policies call these helpers as the signed-in user.
grant execute on function public.kbms_is_active_staff() to authenticated;
grant execute on function public.kbms_has_role(text[]) to authenticated;
grant execute on function public.kbms_teacher_assigned_to_student(uuid) to authenticated;
grant execute on function public.kbms_teacher_assigned_to_allocation(uuid,text) to authenticated;

-- User-facing state changes are available only to authenticated staff;
-- the trigger function is callable by triggers, not directly by clients.
grant execute on function public.record_student_clearance(uuid,text,text) to authenticated;
grant execute on function public.depart_student(uuid,text) to authenticated;
grant execute on function public.decide_approval_request(uuid,text,text) to authenticated;
grant execute on function public.teacher_allocate_textbooks(jsonb,integer,date) to authenticated;

-- Final institutional controls: academic-year administration, configured return
-- deadlines, and auditable staff-role changes.

-- Administrators and school leaders can read and configure academic years.
drop policy if exists kbms_admin_manage_academic_years on public.academic_years;
create policy kbms_admin_manage_academic_years on public.academic_years for all to authenticated
  using (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']))
  with check (public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']));

-- Switch the active year in one transaction so there is never more than one
-- current year and the selected year has an approved date range.
create or replace function public.set_current_academic_year(p_academic_year_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare selected_year public.academic_years%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']) then
    raise exception 'Not authorized to change the current academic year';
  end if;
  select * into selected_year from public.academic_years
   where id = p_academic_year_id for update;
  if not found then raise exception 'Academic year was not found'; end if;
  if selected_year.starts_on is null or selected_year.ends_on is null
     or selected_year.starts_on > (now() at time zone 'Africa/Nairobi')::date or selected_year.ends_on < (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'The current academic year must have a valid date range containing today';
  end if;
  update public.academic_years set is_current = false, status = case when status = 'active' then 'closed' else status end
   where is_current and id <> p_academic_year_id;
  update public.academic_years set is_current = true, status = 'active' where id = p_academic_year_id;
  return p_academic_year_id;
end;
$$;
revoke all on function public.set_current_academic_year(uuid) from public, anon;
grant execute on function public.set_current_academic_year(uuid) to authenticated;

-- Every shared textbook allocation must use the school's configured end-of-year
-- date. The teacher RPC applies the same rule before it locks or writes copies.
create or replace function public.teacher_allocate_textbooks(
  p_allocations jsonb,
  p_academic_year integer,
  p_due_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  allocation_row record;
  created_ids jsonb := '[]'::jsonb;
  created_id uuid;
  row_count integer;
  staff_role text;
  current_year_start integer;
  current_year_end date;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) is distinct from 'array' then raise exception 'Allocations must be supplied as a list'; end if;
  row_count := jsonb_array_length(p_allocations);
  if row_count < 1 or row_count > 500 then raise exception 'A batch must contain between 1 and 500 allocations'; end if;
  if p_academic_year is null or p_academic_year < 2020 or p_academic_year > 2200 then raise exception 'Invalid academic year'; end if;
  select substring(ay.year_label from '^[0-9]{4}')::integer, ay.ends_on
    into current_year_start, current_year_end
    from public.academic_years ay where ay.is_current;
  if current_year_start is distinct from p_academic_year then
    raise exception 'The selected academic year is not the school''s current academic year';
  end if;
  if current_year_end is null or current_year_end < (now() at time zone 'Africa/Nairobi')::date or p_due_date is distinct from current_year_end then
    raise exception 'The textbook return deadline must match the configured end of the current academic year';
  end if;

  select m.role into staff_role
    from public.staff_memberships m
    where m.user_id = auth.uid() and m.active;
  if staff_role is null or staff_role not in ('teacher','subject_teacher','class_teacher') then
    raise exception 'This operation is reserved for teaching staff';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    group by x.student_id having count(*) > 1
  ) then raise exception 'A student appears more than once in this allocation batch'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    group by x.copy_id having count(*) > 1
  ) then raise exception 'A textbook copy appears more than once in this allocation batch'; end if;

  for allocation_row in
    select x.id, x.student_id, x.copy_id
    from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    order by x.copy_id
  loop
    if allocation_row.id is null or allocation_row.student_id is null or allocation_row.copy_id is null then
      raise exception 'Every allocation needs a student and a textbook copy';
    end if;
    perform 1 from public.textbook_copies b
      where b.id = allocation_row.copy_id and b.condition = 'Available'
      for update;
    if not found then raise exception 'A selected textbook copy is missing or unavailable'; end if;
    perform 1 from public.students s
      where s.id = allocation_row.student_id and s.active
      for share;
    if not found then raise exception 'A selected student is inactive or no longer exists'; end if;
    if not exists (
      select 1
      from public.students s
      join public.school_classes c
        on c.active
       and c.class_label = coalesce(nullif(s.current_class,''), s.grade || ' · Class ' || coalesce(s.class_number::text,''))
       and c.school_section = s.school_section
      join public.academic_years ay on ay.id = c.academic_year_id and ay.is_current
      join public.staff_assignments a on a.class_id = c.id
      left join public.school_subjects sub on sub.id = a.subject_id and sub.active
      join public.textbook_copies b on (
        (staff_role = 'class_teacher' and a.assignment_type = 'class_teacher')
        or (staff_role in ('teacher','subject_teacher') and a.assignment_type in ('subject_teacher','substitute')
          and a.subject_id is not null and (lower(sub.subject_name) = lower(b.subject) or lower(sub.subject_code) = lower(b.subject)))
      )
      where s.id = allocation_row.student_id and s.active
        and b.id = allocation_row.copy_id and b.condition = 'Available'
        and a.staff_user_id = auth.uid()
        and ((staff_role = 'class_teacher' and a.assignment_type = 'class_teacher' and a.subject_id is null)
          or (staff_role in ('teacher','subject_teacher') and a.assignment_type in ('subject_teacher','substitute') and a.subject_id is not null))
        and a.starts_on <= (now() at time zone 'Africa/Nairobi')::date and (a.ends_on is null or a.ends_on >= (now() at time zone 'Africa/Nairobi')::date)
    ) then
      raise exception 'You are not assigned to this student''s class and this textbook subject, or the copy is unavailable';
    end if;
    if exists (select 1 from public.textbook_allocations ta where ta.copy_id = allocation_row.copy_id and ta.returned_at is null) then
      raise exception 'A selected textbook copy has already been allocated';
    end if;
    if exists (select 1 from public.textbook_allocations ta where ta.student_id = allocation_row.student_id and ta.copy_id = allocation_row.copy_id and ta.returned_at is null) then
      raise exception 'This student already has this textbook copy';
    end if;
  end loop;

  for allocation_row in
    select x.id, x.student_id, x.copy_id
    from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
  loop
    insert into public.textbook_allocations (
      id, copy_id, copy_code_snapshot, title_snapshot, subject_snapshot,
      student_id, student_admission_snapshot, student_name_snapshot,
      grade_snapshot, class_number_snapshot, class_snapshot,
      academic_year, allocated_at, due_date
    )
    select allocation_row.id, b.id, b.copy_code, b.title, b.subject,
      s.id, s.admission_number, s.full_name, s.grade, s.class_number,
      coalesce(nullif(s.current_class,''), s.grade || ' · Class ' || coalesce(s.class_number::text,'')),
      p_academic_year, (now() at time zone 'Africa/Nairobi')::date, current_year_end
    from public.students s cross join public.textbook_copies b
    where s.id = allocation_row.student_id and b.id = allocation_row.copy_id
    returning id into created_id;
    created_ids := created_ids || jsonb_build_array(created_id);
  end loop;
  return created_ids;
end;
$$;
revoke all on function public.teacher_allocate_textbooks(jsonb,integer,date) from public, anon;
grant execute on function public.teacher_allocate_textbooks(jsonb,integer,date) to authenticated;

-- Bookstore staff may insert allocations directly, but only for the current
-- configured year and its exact return deadline. Updates/deletes remain revoked.
drop policy if exists staff_insert_textbook_allocations on public.textbook_allocations;
create policy staff_insert_textbook_allocations on public.textbook_allocations for insert to authenticated
  with check (
    public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant'])
    and exists (
      select 1 from public.academic_years ay
      where ay.is_current
        and substring(ay.year_label from '^[0-9]{4}')::integer = academic_year
        and ay.ends_on = due_date
        and ay.ends_on >= (now() at time zone 'Africa/Nairobi')::date
    )
    and exists (
      select 1 from public.students s
      where s.id = student_id and s.active
        and s.admission_number = student_admission_snapshot
        and s.full_name = student_name_snapshot
        and s.grade = grade_snapshot
        and coalesce(nullif(s.current_class,''), s.grade || ' · Class ' || coalesce(s.class_number::text,'')) = class_snapshot
    )
    and exists (
      select 1 from public.textbook_copies b
      where b.id = copy_id and b.condition = 'Available'
        and b.copy_code = copy_code_snapshot
        and b.title = title_snapshot
        and b.subject = subject_snapshot
    )
  );

-- Role assignments are visible to administrators but can only be changed via
-- the audited, narrowly scoped function below.
drop policy if exists staff_read_own_membership on public.staff_memberships;
create policy staff_read_own_membership on public.staff_memberships for select to authenticated
  using (user_id = auth.uid() or public.kbms_has_role(array['super_admin','admin']));

create or replace function public.admin_set_staff_membership(
  p_user_id uuid,
  p_role text,
  p_active boolean default true
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing_role text;
  actor_is_super boolean;
  active_super_count integer;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  actor_is_super := public.kbms_has_role(array['super_admin']);
  if not (actor_is_super or public.kbms_has_role(array['admin'])) then
    raise exception 'Only an authorized administrator may change staff access';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('kbms_staff_membership_changes')::bigint);
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Administrators cannot change their own staff membership';
  end if;
  if p_role not in ('admin','librarian','read_only','super_admin','library_admin','library_assistant',
    'bookstore_admin','bookstore_assistant','auditor','principal','deputy_principal','teacher','class_teacher','subject_teacher') then
    raise exception 'Unknown staff role';
  end if;
  if p_role = 'super_admin' and not actor_is_super then
    raise exception 'Only a super administrator may appoint another super administrator';
  end if;
  select role into existing_role from public.staff_memberships where user_id = p_user_id for update;
  if existing_role = 'super_admin' and not actor_is_super then
    raise exception 'Only a super administrator may change another super administrator';
  end if;
  if existing_role = 'super_admin' and (p_role <> 'super_admin' or not coalesce(p_active,true)) then
    select count(*) into active_super_count from public.staff_memberships
      where role = 'super_admin' and active and user_id <> p_user_id;
    if active_super_count = 0 then raise exception 'The last active super administrator cannot be removed'; end if;
  end if;
  insert into public.staff_memberships(user_id,role,active)
  values(p_user_id,p_role,coalesce(p_active,true))
  on conflict(user_id) do update set role = excluded.role, active = excluded.active;
  update public.staff_profiles set active = coalesce(p_active,true), updated_at = now()
    where user_id = p_user_id;
end;
$$;
revoke all on function public.admin_set_staff_membership(uuid,text,boolean) from public, anon;
grant execute on function public.admin_set_staff_membership(uuid,text,boolean) to authenticated;

-- Include role changes in the append-only audit trail.
drop trigger if exists kbms_audit_staff_memberships on public.staff_memberships;
create trigger kbms_audit_staff_memberships after insert or update or delete on public.staff_memberships
  for each row execute function public.kbms_write_audit_event();


-- Harden library circulation and clearance history. Client apps may create a
-- checked issue, but may not rewrite or delete historical circulation rows.
drop policy if exists staff_write_library on public.loans;
drop policy if exists staff_issue_library_loan on public.loans;
create policy staff_issue_library_loan on public.loans for insert to authenticated
  with check (
    public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant'])
    and returned_at is null
    and issued_at = (now() at time zone 'Africa/Nairobi')::date
    and exists (
      select 1 from public.students s
      where s.id = student_id and s.active
        and s.admission_number = student_admission_snapshot
        and s.full_name = student_name_snapshot
        and s.house_code = house_code_snapshot
        and s.grade = grade_snapshot
        and s.class_number is not distinct from class_number_snapshot
    )
    and exists (
      select 1 from public.books b
      where b.id = book_id and b.condition = 'Available'
        and b.accession_code = book_code_snapshot
        and b.title = book_title_snapshot
        and b.purchase_year is not distinct from purchase_year_snapshot
    )
    and due_date is not null and due_date > issued_at
  );

revoke update, delete on public.loans from anon, authenticated;

create or replace function public.return_library_loan(p_loan_id uuid)
returns date
language plpgsql security definer set search_path = ''
as $$
declare returned_on date;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant']) then
    raise exception 'Not authorized to return a library book';
  end if;
  update public.loans
    set returned_at = (now() at time zone 'Africa/Nairobi')::date, updated_at = now()
    where id = p_loan_id and returned_at is null
    returning returned_at into returned_on;
  if returned_on is null then
    raise exception 'This loan is already returned or no longer exists';
  end if;
  return returned_on;
end;
$$;
revoke all on function public.return_library_loan(uuid) from public, anon;
grant execute on function public.return_library_loan(uuid) to authenticated;

-- Clearance history is append-only. Both completion and reopening are
-- recorded as separate server-checked events and captured by the audit trigger.
drop policy if exists kbms_library_clearance_write on public.clearance_records;
drop policy if exists kbms_bookstore_clearance_write on public.clearance_records;
revoke insert, update, delete on public.clearance_records from anon, authenticated;
grant select on public.clearance_records to authenticated;

create or replace function public.reopen_student_clearance(
  p_student_id uuid,
  p_department text,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
  latest_status text;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if p_department = 'library' then
    if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','library_admin','librarian','library_assistant']) then
      raise exception 'Not authorized to reopen library clearance';
    end if;
  elsif p_department = 'bookstore' then
    if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin','bookstore_assistant']) then
      raise exception 'Not authorized to reopen bookstore clearance';
    end if;
  else
    raise exception 'Unknown clearance department';
  end if;
  if not exists(select 1 from public.students where id = p_student_id) then
    raise exception 'Student record does not exist';
  end if;
  select status into latest_status from public.clearance_records
    where student_id = p_student_id and department = p_department
    order by created_at desc, id desc limit 1;
  if latest_status is distinct from 'cleared' then
    raise exception 'The latest clearance is not in a completed state';
  end if;
  insert into public.clearance_records(student_id,department,status,checked_by,checked_at,notes)
  values(p_student_id,p_department,'reopened',auth.uid(),now(),coalesce(p_notes,''))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.reopen_student_clearance(uuid,text,text) from public, anon;
grant execute on function public.reopen_student_clearance(uuid,text,text) to authenticated;

-- Student records are deactivated through the audited departure workflow;
-- deletion is not a supported operation for authenticated clients.
revoke delete on public.students from anon, authenticated;

-- Store the permanent house and the school's operational section separately.
-- house_code remains as a derived compatibility/display value for old clients.
alter table public.students add column if not exists house text;
alter table public.students add column if not exists school_section text;
update public.students
  set house = coalesce(nullif(house,''), left(house_code,1)),
      school_section = coalesce(nullif(school_section,''), right(house_code,1));
alter table public.students alter column house set not null;
alter table public.students alter column school_section set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.students'::regclass and conname='students_house_code_matches_parts') then
    alter table public.students add constraint students_house_code_matches_parts check (house_code = house || school_section);
  end if;
end;
$$;
create index if not exists students_house_section on public.students(house,school_section);

create or replace function public.kbms_sync_student_house_fields()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.house is null or new.house = '' then new.house := left(new.house_code,1); end if;
    if new.school_section is null or new.school_section = '' then new.school_section := right(new.house_code,1); end if;
  else
    if (new.house is distinct from old.house or new.school_section is distinct from old.school_section)
       and not public.kbms_has_role(array['super_admin','admin']) then
      raise exception 'Only an authorized administrator may correct a student house or school section';
    end if;
  end if;
  if new.house not in ('T','A','N','M') or new.school_section not in ('G','B') then
    raise exception 'A valid house and school section are required';
  end if;
  new.house_code := new.house || new.school_section;
  return new;
end;
$$;
revoke all on function public.kbms_sync_student_house_fields() from public, anon, authenticated;
drop trigger if exists kbms_sync_student_house_fields on public.students;
create trigger kbms_sync_student_house_fields before insert or update of house,school_section,house_code on public.students
  for each row execute function public.kbms_sync_student_house_fields();

-- Grade and class labels are school-configurable; do not freeze future year
-- structures into a hard-coded CBC/Form list or a fixed class-number ceiling.
alter table public.students drop constraint if exists students_grade_check;
alter table public.students add constraint students_grade_check
  check (length(trim(grade)) between 1 and 60);
alter table public.students drop constraint if exists students_class_number_check;
alter table public.students alter column class_number type integer;
alter table public.students drop constraint if exists students_class_number_positive;
alter table public.students add constraint students_class_number_positive
  check (class_number is null or class_number > 0);


-- Library issues are committed only after locking both the student and copy.
-- This closes the race between issuing a book and recording student departure.
create or replace function public.issue_library_book(
  p_student_id uuid,
  p_book_id uuid,
  p_due_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  student_row public.students%rowtype;
  book_row public.books%rowtype;
  created_loan public.loans%rowtype;
  school_today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','library_admin','librarian','library_assistant']) then
    raise exception 'Not authorized to issue a library book';
  end if;
  if p_due_date is null or p_due_date <= school_today then
    raise exception 'Choose a valid weekly return date after today';
  end if;
  select * into student_row from public.students
    where id = p_student_id and active for share;
  if not found then raise exception 'Student is inactive or no longer exists'; end if;
  select * into book_row from public.books
    where id = p_book_id and condition = 'Available' for update;
  if not found then raise exception 'Library copy is missing or unavailable'; end if;
  insert into public.loans(
    student_id,book_id,student_admission_snapshot,student_name_snapshot,house_code_snapshot,
    grade_snapshot,class_number_snapshot,class_snapshot,book_code_snapshot,book_title_snapshot,
    purchase_year_snapshot,issued_at,due_date
  ) values (
    student_row.id,book_row.id,student_row.admission_number,student_row.full_name,student_row.house_code,
    student_row.grade,student_row.class_number,
    coalesce(nullif(student_row.current_class,''),student_row.grade || ' · Class ' || coalesce(student_row.class_number::text,'')),
    book_row.accession_code,book_row.title,book_row.purchase_year,school_today,p_due_date
  ) returning * into created_loan;
  return to_jsonb(created_loan);
end;
$$;
revoke all on function public.issue_library_book(uuid,uuid,date) from public, anon;
grant execute on function public.issue_library_book(uuid,uuid,date) to authenticated;
drop policy if exists staff_issue_library_loan on public.loans;
revoke insert, update, delete on public.loans from anon, authenticated;
grant select on public.loans to authenticated;

-- Bookstore staff use a server-side single-copy allocation operation too.
create or replace function public.bookstore_allocate_textbooks(
  p_allocations jsonb,
  p_academic_year integer,
  p_due_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  allocation_row record;
  student_row public.students%rowtype;
  copy_row public.textbook_copies%rowtype;
  created_allocation public.textbook_allocations%rowtype;
  created_ids jsonb := '[]'::jsonb;
  row_count integer;
  current_year_start integer;
  current_year_end date;
  school_today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','bookstore_admin','bookstore_assistant']) then
    raise exception 'Not authorized to allocate bookstore textbooks';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Allocations must be supplied as a list';
  end if;
  row_count := jsonb_array_length(p_allocations);
  if row_count < 1 or row_count > 500 then raise exception 'A batch must contain between 1 and 500 allocations'; end if;
  select substring(ay.year_label from '^[0-9]{4}')::integer, ay.ends_on
    into current_year_start,current_year_end from public.academic_years ay where ay.is_current;
  if current_year_start is distinct from p_academic_year or current_year_end is null
     or current_year_end < school_today or p_due_date is distinct from current_year_end then
    raise exception 'The textbook return deadline must match the configured end of the current academic year';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    group by x.student_id having count(*) > 1
  ) then raise exception 'A student appears more than once in this allocation batch'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as x(id uuid, student_id uuid, copy_id uuid)
    group by x.copy_id having count(*) > 1
  ) then raise exception 'A textbook copy appears more than once in this allocation batch'; end if;
  for allocation_row in
    select x.id,x.student_id,x.copy_id from jsonb_to_recordset(p_allocations) as x(id uuid,student_id uuid,copy_id uuid)
    order by x.copy_id
  loop
    if allocation_row.id is null or allocation_row.student_id is null or allocation_row.copy_id is null then
      raise exception 'Student, copy and allocation identifier are required';
    end if;
    select * into student_row from public.students where id=allocation_row.student_id and active for share;
    if not found then raise exception 'Student is inactive or no longer exists'; end if;
    select * into copy_row from public.textbook_copies where id=allocation_row.copy_id and condition='Available' for update;
    if not found then raise exception 'Textbook copy is missing or unavailable'; end if;
    if exists(select 1 from public.textbook_allocations where copy_id=copy_row.id and returned_at is null) then
      raise exception 'A selected textbook copy has already been allocated';
    end if;
    if exists(select 1 from public.textbook_allocations where student_id=student_row.id and copy_id=copy_row.id and returned_at is null) then
      raise exception 'This student already has this textbook copy';
    end if;
    insert into public.textbook_allocations(
      id,copy_id,copy_code_snapshot,title_snapshot,subject_snapshot,student_id,
      student_admission_snapshot,student_name_snapshot,grade_snapshot,class_number_snapshot,
      class_snapshot,academic_year,allocated_at,due_date
    ) values (
      allocation_row.id,copy_row.id,copy_row.copy_code,copy_row.title,copy_row.subject,student_row.id,
      student_row.admission_number,student_row.full_name,student_row.grade,student_row.class_number,
      coalesce(nullif(student_row.current_class,''),student_row.grade || ' · Class ' || coalesce(student_row.class_number::text,'')),
      p_academic_year,school_today,current_year_end
    ) returning * into created_allocation;
    created_ids := created_ids || jsonb_build_array(created_allocation.id);
  end loop;
  return created_ids;
end;
$$;
revoke all on function public.bookstore_allocate_textbooks(jsonb,integer,date) from public, anon;
grant execute on function public.bookstore_allocate_textbooks(jsonb,integer,date) to authenticated;
drop policy if exists staff_insert_textbook_allocations on public.textbook_allocations;
revoke insert on public.textbook_allocations from anon, authenticated;
grant select on public.textbook_allocations to authenticated;

-- Preserve staff identity and assignment history. Accounts are deactivated;
-- assignments are closed by setting an end date, never deleted or rewritten.
revoke delete on public.staff_profiles from anon, authenticated;
revoke delete on public.staff_assignments from anon, authenticated;

create or replace function public.kbms_protect_staff_assignment_history()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Staff assignment history cannot be deleted';
  end if;
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']) then
    raise exception 'Not authorized to change staff assignments';
  end if;
  if new.staff_user_id is distinct from old.staff_user_id
     or new.assignment_type is distinct from old.assignment_type
     or new.class_id is distinct from old.class_id
     or new.subject_id is distinct from old.subject_id
     or new.starts_on is distinct from old.starts_on then
    raise exception 'An existing staff assignment cannot be rewritten; close it and create a new assignment';
  end if;
  if old.ends_on is not null and new.ends_on is distinct from old.ends_on then
    raise exception 'A closed staff assignment cannot be reopened or rewritten';
  end if;
  if new.ends_on is not null and new.ends_on < old.starts_on then
    raise exception 'Assignment end date cannot precede its start date';
  end if;
  return new;
end;
$$;
revoke all on function public.kbms_protect_staff_assignment_history() from public, anon, authenticated;
drop trigger if exists kbms_protect_staff_assignment_history on public.staff_assignments;
create trigger kbms_protect_staff_assignment_history before update or delete on public.staff_assignments
  for each row execute function public.kbms_protect_staff_assignment_history();

create or replace function public.kbms_validate_staff_assignment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  class_year public.academic_years%rowtype;
begin
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']) then
    raise exception 'Only authorized school administrators may assign teachers';
  end if;
  if not exists (
    select 1 from public.staff_memberships m
    join public.staff_profiles p on p.user_id=m.user_id and p.active
    where m.user_id=new.staff_user_id and m.active
  ) then raise exception 'The selected teacher does not have an active staff profile'; end if;
  if not exists (
    select 1 from public.school_classes c
    where c.id=new.class_id and c.active
  ) then raise exception 'The selected class is not active'; end if;
  if new.subject_id is not null and not exists (
    select 1 from public.school_subjects s where s.id=new.subject_id and s.active
  ) then raise exception 'The selected subject is not active'; end if;
  if new.assigned_by is null then new.assigned_by := auth.uid(); end if;
  return new;
end;
$$;
revoke all on function public.kbms_validate_staff_assignment() from public, anon, authenticated;
drop trigger if exists kbms_validate_staff_assignment on public.staff_assignments;
create trigger kbms_validate_staff_assignment before insert on public.staff_assignments
  for each row execute function public.kbms_validate_staff_assignment();


-- Academic-year release / archive support. Archives preserve every student,
-- allocation, return, clearance and audit record; only the year/class active
-- flags change. Bookstore administrators may create classes for an existing
-- open academic year, but cannot change school-wide settings or delete history.
alter table public.academic_years
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete restrict,
  add column if not exists archive_reason text;
alter table public.school_classes
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete restrict;

create index if not exists academic_years_archived_idx
  on public.academic_years (archived_at, year_label desc);
create index if not exists school_classes_year_active_idx
  on public.school_classes (academic_year_id, active, class_label);
create unique index if not exists school_classes_named_stream_unique
  on public.school_classes (academic_year_id, lower(grade_label), lower(class_label), coalesce(school_section, ''));

drop policy if exists kbms_bookstore_create_classes on public.school_classes;
create policy kbms_bookstore_create_classes on public.school_classes
  for insert to authenticated
  with check (
    public.kbms_has_role(array['bookstore_admin'])
    and exists (
      select 1 from public.academic_years ay
      where ay.id = academic_year_id
        and ay.status <> 'closed'
        and ay.archived_at is null
    )
  );

grant select, insert on public.school_classes to authenticated;

create or replace function public.archive_academic_year(p_academic_year_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare selected_year public.academic_years%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin']) then
    raise exception 'Not authorized to release or archive an academic year';
  end if;
  select * into selected_year from public.academic_years
    where id = p_academic_year_id for update;
  if not found then raise exception 'Academic year was not found'; end if;
  if selected_year.is_current then raise exception 'The current academic year cannot be archived'; end if;
  if selected_year.archived_at is not null then raise exception 'This academic year is already archived'; end if;

  update public.academic_years
    set status = 'closed', archived_at = now(), archived_by = auth.uid(),
        archive_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
    where id = p_academic_year_id;
  update public.school_classes
    set active = false, archived_at = now(), archived_by = auth.uid()
    where academic_year_id = p_academic_year_id and archived_at is null;
  return p_academic_year_id;
end;
$$;
revoke all on function public.archive_academic_year(uuid,text) from public, anon;
grant execute on function public.archive_academic_year(uuid,text) to authenticated;

-- Archived years cannot be reactivated accidentally by the normal year switch.
create or replace function public.set_current_academic_year(p_academic_year_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare selected_year public.academic_years%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal']) then
    raise exception 'Not authorized to change the current academic year';
  end if;
  select * into selected_year from public.academic_years where id = p_academic_year_id for update;
  if not found then raise exception 'Academic year was not found'; end if;
  if selected_year.archived_at is not null or selected_year.status = 'closed' then
    raise exception 'An archived academic year cannot be made current';
  end if;
  if selected_year.starts_on is null or selected_year.ends_on is null
     or selected_year.starts_on > (now() at time zone 'Africa/Nairobi')::date
     or selected_year.ends_on < (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'The current academic year must have a valid date range containing today';
  end if;
  update public.academic_years set is_current = false,
    status = case when status = 'active' then 'closed' else status end
    where is_current and id <> p_academic_year_id;
  update public.academic_years set is_current = true, status = 'active'
    where id = p_academic_year_id;
  return p_academic_year_id;
end;
$$;
revoke all on function public.set_current_academic_year(uuid) from public, anon;
grant execute on function public.set_current_academic_year(uuid) to authenticated;


-- Immutable class-list snapshots captured at the moment an academic year is archived.
create table if not exists public.class_archive_students (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  class_id uuid not null references public.school_classes(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  admission_number_snapshot text not null,
  full_name_snapshot text not null,
  grade_label text not null default '',
  class_label text not null default '',
  house_code text not null default '',
  school_section text not null default '',
  snapshot_at timestamptz not null default now(),
  unique (academic_year_id, class_id, student_id)
);
alter table public.class_archive_students enable row level security;
drop policy if exists kbms_read_class_archive_students on public.class_archive_students;
create policy kbms_read_class_archive_students on public.class_archive_students
  for select to authenticated using (public.kbms_is_active_staff());
revoke insert, update, delete on public.class_archive_students from anon, authenticated;
grant select on public.class_archive_students to authenticated;

-- Replace the archive RPC so it snapshots the class list before deactivating
-- the classes. Matching is exact against students.current_class; no class is
-- guessed from grade alone.
create or replace function public.archive_academic_year(p_academic_year_id uuid, p_reason text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare selected_year public.academic_years%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['super_admin','admin','principal','deputy_principal','bookstore_admin']) then
    raise exception 'Not authorized to release or archive an academic year';
  end if;
  select * into selected_year from public.academic_years where id = p_academic_year_id for update;
  if not found then raise exception 'Academic year was not found'; end if;
  if selected_year.is_current then raise exception 'The current academic year cannot be archived'; end if;
  if selected_year.archived_at is not null then raise exception 'This academic year is already archived'; end if;

  insert into public.class_archive_students (
    academic_year_id, class_id, student_id, admission_number_snapshot,
    full_name_snapshot, grade_label, class_label, house_code, school_section
  )
  select selected_year.id, c.id, s.id, s.admission_number, s.full_name,
         c.grade_label, c.class_label, s.house_code, s.school_section
    from public.school_classes c
    join public.students s on lower(trim(s.current_class)) = lower(trim(c.class_label))
   where c.academic_year_id = selected_year.id and c.active and c.archived_at is null
  on conflict (academic_year_id, class_id, student_id) do nothing;

  update public.academic_years
    set status = 'closed', archived_at = now(), archived_by = auth.uid(),
        archive_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
    where id = p_academic_year_id;
  update public.school_classes
    set active = false, archived_at = now(), archived_by = auth.uid()
    where academic_year_id = p_academic_year_id and archived_at is null;
  return p_academic_year_id;
end;
$$;
revoke all on function public.archive_academic_year(uuid,text) from public, anon;
grant execute on function public.archive_academic_year(uuid,text) to authenticated;

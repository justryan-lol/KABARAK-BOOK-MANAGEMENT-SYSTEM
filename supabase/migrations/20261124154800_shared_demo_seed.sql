create table if not exists public.demo_seed_runs (
  seed_key text primary key,
  seeded_at timestamptz not null default now(),
  seeded_by uuid not null references auth.users(id),
  record_counts jsonb not null
);

alter table public.demo_seed_runs enable row level security;
drop policy if exists demo_seed_runs_admin_read on public.demo_seed_runs;
create policy demo_seed_runs_admin_read on public.demo_seed_runs
  for select to authenticated
  using (public.kbms_has_role(array['admin','super_admin']));
revoke all on public.demo_seed_runs from anon, authenticated;
grant select on public.demo_seed_runs to authenticated;

create or replace function public.seed_fictional_demo_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  school_today date := (now() at time zone 'Africa/Nairobi')::date;
  demo_year integer := extract(year from (now() at time zone 'Africa/Nairobi'))::integer;
  demo_year_id uuid := gen_random_uuid();
  demo_year_label text;
  first_names text[] := array[
    'Amina','Brian','Wanjiku','Kevin','Faith','Daniel','Mary','Samuel','Grace','Peter',
    'Lydia','James','Anne','David','Mercy','Joseph','Esther','Michael','Joy','Collins',
    'Njeri','Patrick','Naomi','Ethan','Sharon','Victor','Miriam','Ian','Purity','Dennis',
    'Cynthia','Mark','Beatrice','Allan','Caroline','George','Diana','Martin','Sheila','Felix'
  ];
  surnames text[] := array[
    'Njoroge','Kiptoo','Muthoni','Otieno','Chebet','Mwangi','Atieno','Maina','Wanjiru','Mutua',
    'Achieng','Kamau','Wambui','Omondi','Kariuki','Cheruiyot','Nyambura','Kimani','Jepkosgei','Ochieng',
    'Mbugua','Kilonzo','Adhiambo','Githinji','Jepchumba'
  ];
  houses text[] := array['T','A','N','M'];
  class_names text[] := array[
    'Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta',
    'Iota','Kappa','Lambda','Mu','Nu','Xi','Omicron','Pi'
  ];
  subject_names text[] := array[
    'Mathematics','English','Kiswahili','Biology','Chemistry','Physics','Geography',
    'History & Government','CRE','Agriculture','Computer Studies','Business Studies','Integrated Science'
  ];
  book_titles text[] := array[
    'Foundations of Mathematics','English Language and Literature','Kiswahili Sanifu',
    'Essentials of Biology','Introductory Chemistry','Principles of Physics','Practical Geography',
    'Kenya and the Modern World','Christian Religious Education','Agriculture for Secondary Schools',
    'Digital Literacy and Computing','Foundations of Business Studies','Integrated Science Coursebook'
  ];
  seed_counts jsonb := jsonb_build_object(
    'students', 1000, 'library_books', 20, 'textbook_copies', 1040,
    'library_loans', 20, 'textbook_allocations', 940, 'clearance_records', 2,
    'academic_years', 1, 'classes', 16, 'subjects', 13
  );
  i integer;
begin
  if actor_id is null then raise exception 'Sign-in is required'; end if;
  if not public.kbms_has_role(array['admin','super_admin']) then
    raise exception 'Only an active administrator can seed shared demo records';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('kbms:fictional-demo-v1')::bigint);

  if exists (select 1 from public.demo_seed_runs where seed_key = 'fictional-demo-v1') then
    return jsonb_build_object('already_seeded', true, 'counts', seed_counts);
  end if;

  if exists (select 1 from public.academic_years where lower(year_label) = lower(demo_year::text || ' DEMO'))
    or exists (select 1 from public.students where admission_number like 'DEMO-%')
    or exists (select 1 from public.books where accession_code like 'DEMO-LIB-%')
    or exists (select 1 from public.textbook_copies where copy_code like 'DEMO-COPY-%')
    or exists (select 1 from public.school_classes where lower(class_label) like 'grade 10 demo %')
    or exists (select 1 from public.school_subjects where subject_code like 'DEMO-%') then
    raise exception 'Demo-like records already exist. No records were changed; ask an administrator to review them first.';
  end if;

  demo_year_label := demo_year::text || ' DEMO';
  insert into public.academic_years (id, year_label, starts_on, ends_on, is_current, status)
  values (demo_year_id, demo_year_label, make_date(demo_year, 1, 1), make_date(demo_year, 12, 31), false, 'planned');

  insert into public.school_classes (academic_year_id, grade_label, class_label, school_section, active)
  select demo_year_id, 'Grade 10', 'Grade 10 Demo ' || class_name,
         case when ordinal % 2 = 1 then 'G' else 'B' end, true
    from unnest(class_names) with ordinality as classes(class_name, ordinal);

  insert into public.school_subjects (subject_code, subject_name, active)
  select 'DEMO-' || upper(regexp_replace(subject_name, '[^A-Za-z0-9]+', '_', 'g')), subject_name, true
    from unnest(subject_names) as subjects(subject_name);

  insert into public.students (
    admission_number, full_name, house_code, house, school_section, grade, class_number,
    current_class, active, academic_status, created_at, updated_at
  )
  select 'DEMO-' || (1001 + i)::text,
         first_names[(i % array_length(first_names, 1)) + 1] || ' ' || surnames[(i / array_length(first_names, 1)) + 1],
         houses[(i % array_length(houses, 1)) + 1] || case when (i / 4) % 2 = 0 then 'G' else 'B' end,
         houses[(i % array_length(houses, 1)) + 1],
         case when (i / 4) % 2 = 0 then 'G' else 'B' end,
         'Grade 10',
         ((i / 4) % array_length(class_names, 1)) + 1,
         'Grade 10 Demo ' || class_names[((i / 4) % array_length(class_names, 1)) + 1],
         true, 'active', now(), now()
    from generate_series(0, 999) as rows(i);

  insert into public.books (
    accession_code, prefix, accession_number, purchase_year, title, subject, publisher,
    condition, description, created_at, updated_at
  )
  select 'DEMO-LIB-' || lpad(i::text, 3, '0'), 'DEMO', lpad(i::text, 3, '0'),
         2020 + (i % 5), book_titles[((i - 1) % array_length(book_titles, 1)) + 1] || ' · Grade 10',
         subject_names[((i - 1) % array_length(subject_names, 1)) + 1],
         'KBMS Demo Press', 'Available', 'Fictional demonstration library copy', now(), now()
    from generate_series(1, 20) as rows(i);

  insert into public.textbook_copies (
    copy_code, title, subject, publisher, purchase_year, condition, created_at, updated_at
  )
  select 'DEMO-COPY-' || lpad(i::text, 4, '0'),
         book_titles[((i - 1) / 80) + 1] || ' · Grade 10',
         subject_names[((i - 1) / 80) + 1], 'KBMS Demo Press',
         2020 + (((i - 1) / 80) % 5), 'Available', now(), now()
    from generate_series(1, 1040) as rows(i);

  insert into public.loans (
    student_id, book_id, student_admission_snapshot, student_name_snapshot,
    house_code_snapshot, grade_snapshot, class_number_snapshot, class_snapshot,
    book_code_snapshot, book_title_snapshot, purchase_year_snapshot, issued_at,
    due_date, returned_at, created_at, updated_at
  )
  select s.id, b.id, s.admission_number, s.full_name, s.house_code, s.grade,
         s.class_number, s.current_class, b.accession_code, b.title, b.purchase_year,
         case when i <= 4 then school_today - 14 when i <= 12 then school_today - 3 else school_today - 20 end,
         case when i <= 4 then school_today - 7 when i <= 12 then school_today + 5 else school_today - 12 end,
         case when i <= 12 then null else school_today - 5 end,
         now(), now()
    from generate_series(1, 20) as rows(i)
    join public.students s on s.admission_number = 'DEMO-' || (1000 + i)::text
    join public.books b on b.accession_code = 'DEMO-LIB-' || lpad(i::text, 3, '0');

  insert into public.textbook_allocations (
    copy_id, copy_code_snapshot, title_snapshot, subject_snapshot, student_id,
    student_admission_snapshot, student_name_snapshot, grade_snapshot,
    class_number_snapshot, class_snapshot, academic_year, allocated_at,
    due_date, returned_at, created_at, updated_at
  )
  select c.id, c.copy_code, c.title, c.subject, s.id, s.admission_number, s.full_name,
         s.grade, s.class_number, s.current_class, demo_year,
         case when i <= 900 then greatest(make_date(demo_year, 1, 1), school_today - (20 + ((i - 1) % 120))) else school_today - 65 end,
         case when i <= 900 then make_date(demo_year, 12, 31) else school_today - 25 end,
         case when i <= 900 then null else school_today - 20 - ((i - 1) % 8) end,
         now(), now()
    from generate_series(1, 940) as rows(i)
    join public.students s on s.admission_number = 'DEMO-' || (1000 + i)::text
    join public.textbook_copies c on c.copy_code = 'DEMO-COPY-' || lpad(i::text, 4, '0');

  insert into public.clearance_records (
    student_id, department, academic_year_id, status, checked_by, checked_at, notes, created_at, updated_at
  )
  select s.id, department, demo_year_id, 'cleared', actor_id, now(),
         'Fictional demonstration history', now(), now()
    from public.students s
    cross join unnest(array['library', 'bookstore']) as departments(department)
   where s.admission_number = 'DEMO-1003';

  insert into public.demo_seed_runs (seed_key, seeded_by, record_counts)
  values ('fictional-demo-v1', actor_id, seed_counts);

  return jsonb_build_object('already_seeded', false, 'counts', seed_counts);
end;
$$;

revoke all on function public.seed_fictional_demo_v1() from public, anon;
grant execute on function public.seed_fictional_demo_v1() to authenticated;

-- ONE-TIME BOOTSTRAP TEMPLATE.
-- Run only in the school's approved development project, by its project owner.
-- First create the intended Auth user in Supabase Auth, then copy that user's UUID.
-- Replace BOTH placeholders below before executing. Never commit real UUIDs here.

insert into public.staff_profiles (user_id, display_name, username, department, active)
values (
  'REPLACE-WITH-AUTH-USER-UUID'::uuid,
  'REPLACE-WITH-APPROVED-ADMIN-NAME',
  'REPLACE-WITH-APPROVED-USERNAME',
  'School Administration',
  true
);

insert into public.staff_memberships (user_id, role, active)
values ('REPLACE-WITH-AUTH-USER-UUID'::uuid, 'super_admin', true);

-- Verify exactly one active super administrator exists and that the profile matches.
select p.user_id, p.display_name, p.username, m.role, m.active
from public.staff_profiles p
join public.staff_memberships m using (user_id)
where m.role = 'super_admin' and m.active = true;

-- 045: Seed the Associate/Assistant Director FYI recipients alongside the
-- primary National Directors added in sql/044 — NextGen has 2 Associate
-- Directors, SLCP has 1 Assistant Director. Same EC 2026-28 Airtable
-- roster source (https://airtable.com/appd4nPG2mPMWoV9Q/tbllqwAfyEsBGH7Up)
-- as sql/044; emails cross-checked against `members` where unambiguous.
insert into public.academic_event_role_assignments (role, name, email, phone, active_from) values
  ('director_nextgen_associate_1', 'Dr. Kedar Patil', 'drkedarpatil09@gmail.com', '9823017515', '2026-08-30'),
  ('director_nextgen_associate_2', 'Dr. Kadasiddeshwara G. Byakodi', 'kgbyakodi@gmail.com', '9449864824', '2026-08-30'),
  ('director_slcp_assistant', 'Dr. Sanjay Gupta', 'sandiv99@gmail.com', '9646121615', '2026-08-30')
on conflict do nothing;

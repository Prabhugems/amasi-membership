-- 044: Seed National Director role assignments for the 3 MOU application
-- types that have a matching director on the EC 2026-28 roster
-- (https://airtable.com/appd4nPG2mPMWoV9Q/tbllqwAfyEsBGH7Up) — FMAS
-- Academics, NextGen, and SLCP. Every other co-opted portfolio (HPB,
-- Hernia, Endoscopy, Colorectal, Newsletter, Membership Drive, Proctology,
-- AMASAS Journal, Armed Forces) has no corresponding `academic_event_types`
-- row, so there's nothing for those directors to be an FYI recipient on.
--
-- Names/emails cross-checked against `members` (drjayantakr@yahoo.com,
-- drkedarpatil09@gmail.com etc. all resolve to a single member row) except
-- "Roy Patankar" and "Sanjay Gupta", which are ambiguous in `members`
-- (multiple same-name rows) — those two came from the EC roster directly,
-- which is the authoritative source for who actually holds the seat.
--
-- Only the primary National Director per type is seeded as an FYI
-- recipient, not the Associate/Assistant Directors (Kedar Patil,
-- Kadasiddeshwara Byakodi for NextGen; Sanjay Gupta for SLCP) — same
-- one-recipient-per-role shape as zone_chair_*/president already use.
insert into public.academic_event_role_assignments (role, name, email, phone, active_from) values
  ('director_fmas', 'Dr. Roy Patankar', 'roypatankar@gmail.com', '9820075254', '2026-08-30'),
  ('director_nextgen', 'Dr. Jayanta Kumar Das', 'drjayantakr@yahoo.com', '9862569203', '2026-08-30'),
  ('director_slcp', 'Dr. Himanshu Yadav', 'drhimanshuyadav@gmail.com', '9897794208', '2026-08-30')
on conflict do nothing;

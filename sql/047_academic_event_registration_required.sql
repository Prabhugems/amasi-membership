-- 047: Admin-only decision — does this approved event need AMASI to open
-- registration in the shared events system, or not?
--
-- Some MOU event types never need it (rural surgery camps, blood donation
-- camps — AMASI's role is purely the endorsement/MOU), others do
-- (workshops, courses). It isn't a fixed per-type rule — an admin makes
-- the call per application, independent of the Hon. Secretary's
-- approve/reject decision. NULL = not yet decided.
alter table public.academic_event_applications
  add column if not exists registration_required boolean;

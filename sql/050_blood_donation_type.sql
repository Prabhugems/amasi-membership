-- 050: New "Blood Donation Drive" MOU application type (2026-09-23
-- follow-up fixes — see AGENTS.md changelog / mou-fixes-prompt.md #1).
-- Root cause of the "blood donation camp opened as a ticketed AMASI event"
-- incident: there was no dedicated type, so a submitter organizing a blood
-- drive had nowhere better to click than "Zonal Event" (the only generic
-- catch-all). This gives blood donation drives their own type, defaulted
-- to no auto-created event (endorsement-only, like rural_program).
insert into public.academic_event_types
  (id, label, owning_entity, requires_zone, approver_role, notify_roles, mou_template_key, active, default_event_routing)
values
  ('blood_donation', 'Blood Donation Drive', 'amasi', false, 'hon_secretary', array['president'], 'blood_donation', true, 'none');

-- 050 also settles issue #5 (AMASICON default routing) from the same
-- follow-up doc: zero applications have ever been submitted through the
-- amasicon MOU type, and every "AMASICON ..." row in the shared events
-- table was created directly/manually, predating this type. A real bid
-- approved with the old 'amasi' default would auto-create a duplicate
-- calendar entry alongside the hand-curated one. Decided with Prabhu
-- 2026-09-23: default to 'none' — admin can still manually route a
-- specific bid to 'amasi' via the existing routing selector once ready.
update public.academic_event_types
set default_event_routing = 'none'
where id = 'amasicon';

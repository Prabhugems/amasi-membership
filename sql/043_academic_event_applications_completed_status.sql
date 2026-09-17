-- 043: Add "completed" as a valid academic_event_applications status.
--
-- An approved application currently has no way to reflect that its event
-- actually took place — status stays "approved" forever, even well after
-- finalized_date has passed. "completed" is a step past "approved" (not a
-- rejection path): the MOU download and other approved-state UI stay
-- available for it, see src/app/admin/mou-applications/page.tsx.

ALTER TABLE academic_event_applications
  DROP CONSTRAINT academic_event_applications_status_check;

ALTER TABLE academic_event_applications
  ADD CONSTRAINT academic_event_applications_status_check
  CHECK (status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'changes_requested'::text, 'approved'::text, 'completed'::text, 'rejected'::text]));

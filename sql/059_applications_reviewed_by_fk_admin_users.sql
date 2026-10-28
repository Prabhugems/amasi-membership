-- sql/059_applications_reviewed_by_fk_admin_users.sql
--
-- membership_applications.reviewed_by referenced auth.users(id), but the value
-- written by /api/applications/approve (and siblings) is the admin session's
-- sub, which is admin_users.id -- never an auth.users id. Every approve by a
-- DB-backed admin therefore failed at the final application update with
-- "Failed to update application status". It went unnoticed because the old
-- env-var admin signs a non-UUID sub, which adminReviewerId() maps to null.
--
-- Applied to production 2026-10-28 via Supabase migration
-- membership_applications_reviewed_by_fk_admin_users. Pre-check: 0 rows had a
-- non-null reviewed_by, so the new constraint validated trivially.
-- Only this one constraint was changed; the other public.* FKs to auth.users
-- belong to the shared event apps and are untouched.

alter table public.membership_applications
  drop constraint if exists membership_applications_reviewed_by_fkey;
alter table public.membership_applications
  add constraint membership_applications_reviewed_by_fkey
  foreign key (reviewed_by) references public.admin_users(id) on delete set null;

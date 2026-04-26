-- 024: Lock down `uploads` storage bucket with service-role-only RLS policies.
--
-- Status today: bucket `uploads` is public-read (`storage.buckets.public = true`),
-- which makes object paths like `mci_certificate/<file>.jpg` fetchable by anyone
-- who guesses or scrapes the path. The IDOR check in
-- /api/members/signed-url/route.ts is bypassed because no signed URL is needed.
--
-- This migration adds the access-control policies first. They are additive —
-- while `uploads.public` remains `true`, the public flag wins and these
-- policies have no observable effect. They become enforcing the moment we
-- run `UPDATE storage.buckets SET public=false WHERE id='uploads'` (Phase B,
-- separate change with code prep).
--
-- We DO NOT touch `form-uploads` (owned by other AMASI apps),
-- `event-assets` (already has its own policies), or `downloads` (empty).

-- Service role gets full access to uploads bucket (used by createAdminClient).
CREATE POLICY "Service role full access to uploads"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'uploads')
  WITH CHECK (bucket_id = 'uploads');

-- Authenticated users can upload to uploads (used by direct client uploads
-- if any future code path does so; current routes use service role).
-- This keeps doors open for future supabase-auth-based clients without
-- granting them read access.
CREATE POLICY "Authenticated can insert to uploads"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'uploads');

-- Note: NO public/anon SELECT policy. Reads must go through
-- /api/members/signed-url (which uses service role and enforces ownership),
-- /api/members/upload, /api/tickets/upload, /api/applications/resubmit,
-- or /api/ocr — all of which already authenticate the caller.

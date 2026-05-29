-- 036_member_notifications.sql
-- Per-member notification inbox surfaced in the Flutter app's notification
-- list screen (read via mobile-shim /api/mobile_notification_list).
--
-- Distinct from the `announcements` table (sql/034) which holds *broadcast*
-- content with no per-member read state. A row here is targeted to ONE
-- member, with delivery + read tracking, and can carry a deep-link URL +
-- image for richer push notifications when FCM delivery is wired in.
--
-- Admin writes via /api/admin/notifications/send-push (to be added);
-- system writes from automation hooks (e.g. application_approved). The
-- Flutter binary reads via /api/mobile_notification_list and toggles
-- read_at via /api/mobile_notification_status_update.
--
-- `broadcast_id` groups multiple rows that were created in a single admin
-- send action — useful for displaying "sent to N members" and for bulk
-- delete/audit. Nullable for system-emitted single-member notifications.

CREATE TABLE IF NOT EXISTS public.member_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     TEXT NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  image_url     TEXT,
  action_url    TEXT,
  broadcast_id  UUID,
  created_by    UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  read_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot query: latest unread-or-all per member.
CREATE INDEX IF NOT EXISTS idx_member_notifications_member_recent
  ON public.member_notifications (member_id, created_at DESC);
-- For admin "show me everyone who got broadcast X".
CREATE INDEX IF NOT EXISTS idx_member_notifications_broadcast
  ON public.member_notifications (broadcast_id) WHERE broadcast_id IS NOT NULL;

ALTER TABLE public.member_notifications ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only access via createAdminClient. Same
-- pattern as 030/032/035.

COMMENT ON TABLE public.member_notifications IS
  'Per-member notification inbox for the Flutter app. See sql/036 header.';

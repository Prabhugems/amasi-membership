-- Schema drift fixes from 2026-05-18 audit.
--
-- Run these in Supabase Studio → SQL Editor → New query → paste → Run.
-- Each statement is idempotent.
--
-- Why we need this:
--
-- 1. notification_logs — referenced by /api/notifications/send and
--    /api/notifications/history, but the table doesn't exist. Every admin
--    bulk notification (email + WhatsApp) has been silently failing to log.
--    The admin "Notification History" page returns 500 because of the same.
--
-- 2. whatsapp_templates.template_id — POST/PATCH on /api/whatsapp-templates
--    writes this column but it doesn't exist. Admin "WhatsApp Templates"
--    page has been read-only with a phantom fallback that returns 4
--    hardcoded seed templates with fake `id: "seed-N"` values.
--

-- ----------------------------------------------------------------------------
-- 1. Create notification_logs
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL,          -- "email" | "whatsapp"
  subject     text,
  message     text,
  filters     jsonb DEFAULT '{}'::jsonb,
  sent_count  integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  sent_by     text,                    -- admin email
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_logs_created_at_idx
  ON public.notification_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS notification_logs_type_idx
  ON public.notification_logs (type);

-- RLS: only service role writes; deny direct anon access.
-- All access to this table goes through API routes that already gate on
-- getAdminSession().
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. Add template_id to whatsapp_templates
-- ----------------------------------------------------------------------------

ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS template_id text;

-- Optional: backfill the 4 seed templates that the GET handler falls back to
-- (only useful if you want them to land as real rows on first GET — the
-- existing auto-seed logic in the route handler will pick them up).

-- Rollback for 022_email_campaigns.sql. Safe because no production consumers
-- depend on these tables yet and no historical campaign rows exist.

DROP TABLE IF EXISTS email_campaign_recipients;
DROP TABLE IF EXISTS email_campaigns;
ALTER TABLE members DROP COLUMN IF EXISTS marketing_opt_out_at;

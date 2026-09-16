-- 041: Per-template vertical position for the category/course-name overlay
-- on credential certificates, and registration of the MMAS 2025 (Jaipur)
-- template + its 4 skill courses.
--
-- The MMAS certificate overlay hardcoded the courseName position at a fixed
-- top:52.5% for every year. The 2025 template's baked-in title sits lower
-- than 2026's, so 52.5% crowded it against the title text. Making it
-- per-template (mirrors name_top_pct/name_font_size_px) lets each year's
-- artwork be positioned independently without touching other years.
--
-- Applied directly to production via Supabase MCP on 2026-09-16; this file
-- documents that change for schema history / fresh environments.

ALTER TABLE credential_templates
  ADD COLUMN IF NOT EXISTS course_name_top_pct numeric;

INSERT INTO credential_templates
  (credential_type, year, template_path, president_name, convocation_date, convocation_place, name_top_pct, name_font_size_px, course_name_top_pct)
VALUES
  ('MMAS', 2025, '/certificates/mmas/2025.jpg', 'Dr. Kalpesh Jani', '28th day of August, 2025', 'Jaipur', 42, 26, 53.8)
ON CONFLICT (credential_type, year) DO NOTHING;

INSERT INTO skill_courses (id, credential_type, name, place, year, convenor, venue)
VALUES
  (128, 'MMAS', '( Hernia )', 'Jaipur', 2025, 'Rajendra Mandia', NULL),
  (129, 'MMAS', '( Hepato-Pancreato-Biliary )', 'Jaipur', 2025, 'Kalaiarasan / Anil Agarwal', NULL),
  (130, 'MMAS', '( Colorectal )', 'Jaipur', 2025, 'Prakash K', NULL),
  (131, 'MMAS', '( Upper GI & Bariatric Surgery )', 'Jaipur', 2025, 'Rajendra Prasad', NULL)
ON CONFLICT (id, credential_type) DO NOTHING;

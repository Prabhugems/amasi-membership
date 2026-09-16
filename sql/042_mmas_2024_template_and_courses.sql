-- 042: Register the MMAS 2024 (Hyderabad) certificate template + its 3
-- skill courses. Mirrors the MMAS 2025 setup in
-- sql/041_mmas_course_name_top_pct.sql.
--
-- Applied directly to production via Supabase MCP on 2026-09-16; this file
-- documents that change for schema history / fresh environments.

INSERT INTO credential_templates
  (credential_type, year, template_path, president_name, convocation_date, convocation_place, name_top_pct, name_font_size_px, course_name_top_pct)
VALUES
  ('MMAS', 2024, '/certificates/mmas/2024.png', 'Dr.C.J.Varghese', '15th day of August, 2024', 'Hyderabad', 41.2, 26, 52.8)
ON CONFLICT (credential_type, year) DO NOTHING;

INSERT INTO skill_courses (id, credential_type, name, place, year, convenor, venue)
VALUES
  (132, 'MMAS', '( Hernia )', 'Hyderabad', 2024, 'P Senthilnathan', NULL),
  (133, 'MMAS', '( Esophageal Cancer Surgery )', 'Hyderabad', 2024, 'Parthasarathi', NULL),
  (134, 'MMAS', '( Upper GI )', 'Hyderabad', 2024, 'R Parthasarathi', NULL)
ON CONFLICT (id, credential_type) DO NOTHING;

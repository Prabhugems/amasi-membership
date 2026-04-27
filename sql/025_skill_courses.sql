-- 025: skill_courses lookup for FMAS / MMAS / DipMAS course details.
--
-- Background: member_credentials.skill_course_id is just an integer (e.g. 114
-- for "114 FMAS Course Nagpur"). Without a lookup, the admin UI could only
-- show the bare number and the human-meaningful course name + place was lost.
--
-- The composite primary key namespaces course numbers by credential type —
-- FMAS 114 is not the same course as MMAS 114, so they must coexist.

CREATE TABLE IF NOT EXISTS skill_courses (
  id              integer NOT NULL,
  credential_type text    NOT NULL,
  name            text    NOT NULL,
  place           text,
  year            integer,
  convenor        text,
  venue           text,
  PRIMARY KEY (id, credential_type)
);

CREATE INDEX IF NOT EXISTS idx_skill_courses_year
  ON skill_courses (year);

CREATE INDEX IF NOT EXISTS idx_skill_courses_place
  ON skill_courses (place);

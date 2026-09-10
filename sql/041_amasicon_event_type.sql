-- 041_amasicon_event_type.sql
-- Register AMASICON (the annual conference) as an online-application event
-- type in the config-driven MOU framework (sql/040). Until now AMASICON bids
-- stayed on the downloadable .docx letter; from 2026-09 every event type is
-- applied for online.
--
-- DML only (one seed row) — no schema change. academic_event_applications
-- .application_type_id references academic_event_types(id), so this row
-- must exist before the first AMASICON submission. Applied to production
-- 2026-09-10 via the Supabase MCP (DML is allowed there; see sql/040 header).
--
-- Config lives in src/lib/mou/event-type-config.ts (amasicon entry) and the
-- MOU text in src/lib/mou/mou-pdf.tsx (AMASICON_CLAUSES + AMASICON_PROCEDURES).
-- type_specific_data keys for amasicon: organizing_chairman, organizing_treasurer,
-- host_city, proposed_month, local_support, previous_conferences,
-- supporting_city_chapter, supporting_state_chapter, supporting_others,
-- government_teaching_hospital, facilities{halls, seating_capacity,
-- trade_exhibition_area, live_surgery_relay, av_equipment, hotel_rooms_nearby}.

insert into public.academic_event_types (id, label, owning_entity, requires_zone, mou_template_key)
values ('amasicon', 'AMASICON — Annual Conference', 'amasi', false, 'amasicon')
on conflict (id) do nothing;

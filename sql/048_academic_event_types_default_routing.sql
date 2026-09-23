-- 048: Default event-routing per MOU application type — does an approval
-- create an event at all, and if so under which tenant?
--
-- Deliberately NOT a reuse of owning_entity: that column answers "who signs
-- as First Party in the MOU" (drives the PDF's college-vs-AMASI text via
-- COLLEGE_OF_MAS_TYPES in src/lib/mou/mou-pdf.tsx). This answers a
-- different question — rural_program's owning_entity is 'amasi', but per
-- this routing it should create NO event at all, proving the two concepts
-- diverge.
alter table public.academic_event_types
  add column if not exists default_event_routing text
    check (default_event_routing in ('amasi', 'college', 'none'));

update public.academic_event_types set default_event_routing = case id
  when 'fmas' then 'college'
  when 'mmas' then 'college'
  when 'dmas' then 'college'
  when 'rural_program' then 'none'
  else 'amasi'  -- slcp, nextgen, workshop, meet_the_master, zonal_event, amasicon
end;

alter table public.academic_event_types
  alter column default_event_routing set not null;

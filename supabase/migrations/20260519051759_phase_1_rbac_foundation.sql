-- Phase 1 RBAC foundation: position-based access control.
--
-- See ../../docs/phase-1-rbac-schema.md (amasi-mobile repo) for the design.
-- Tables: positions, position_holders, position_permissions, position_audit_log.
-- Auth model: positions are permanent, people rotate. All grants/revokes are
-- performed by Super Admin (Prabhu) and traced via position_audit_log.
--
-- NOTE ON CONVENTIONS:
-- - The existing migration history in this repo lives in /sql/ as
--   NNN_<name>.sql (latest is 033). This file lands in /supabase/migrations/
--   per AGENTS.md's stated convention. The repo currently has both directories.
--   Reconcile before applying further migrations so we don't track schema
--   changes in two places.
--
-- DEVIATIONS FROM docs/phase-1-rbac-schema.md:
-- - `members.id` is `text` in production (verified 2026-05-19), not `uuid` as
--   the schema doc shows. So `position_holders.member_id` and
--   `position_audit_log.member_id` are `text` here, not `uuid`. The values
--   stored will still be UUID-shaped strings (e.g. Prabhu's
--   `a394c4fc-3f27-4efd-b32d-87438a827103`), so this is type-faithful to the
--   data, just not to the doc.

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------

-- btree_gist is required by the EXCLUDE constraint on position_holders that
-- prevents the same member from holding the same position twice at once.
create extension if not exists btree_gist;

-- ----------------------------------------------------------------------------
-- Table 1: positions
-- ----------------------------------------------------------------------------

create table public.positions (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  display_name    text not null,
  category        text not null,
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  -- created_by FK to position_holders.id is added after position_holders
  -- exists (circular dependency: positions.created_by → holders → positions).
  created_by      uuid
);

create index positions_active_idx on public.positions(is_active) where is_active = true;

-- ----------------------------------------------------------------------------
-- Table 2: position_holders
-- ----------------------------------------------------------------------------

create table public.position_holders (
  id              uuid primary key default gen_random_uuid(),
  position_id     uuid not null references public.positions(id),
  -- text to match production members.id (see header note).
  member_id       text not null references public.members(id),
  granted_at      timestamptz not null default now(),
  granted_by      uuid references public.position_holders(id),
  revoked_at      timestamptz,
  revoked_by      uuid references public.position_holders(id),
  revoke_reason   text,

  -- A person can hold the same position multiple times (e.g. re-elected),
  -- but never twice actively at the same instant.
  constraint one_active_grant_per_position_person
    exclude using gist (
      position_id with =,
      member_id with =,
      tstzrange(granted_at, coalesce(revoked_at, 'infinity'::timestamptz)) with &&
    )
);

create index holders_active_idx        on public.position_holders(position_id) where revoked_at is null;
create index holders_member_active_idx on public.position_holders(member_id)   where revoked_at is null;

-- Now safe to add positions.created_by FK.
alter table public.positions
  add constraint positions_created_by_fkey
  foreign key (created_by) references public.position_holders(id);

-- ----------------------------------------------------------------------------
-- Table 3: position_permissions
-- ----------------------------------------------------------------------------

create table public.position_permissions (
  id              uuid primary key default gen_random_uuid(),
  position_id     uuid not null references public.positions(id),
  permission      text not null,
  scope           text,
  granted_at      timestamptz not null default now(),
  granted_by      uuid references public.position_holders(id),

  unique (position_id, permission, scope)
);

create index permissions_position_idx on public.position_permissions(position_id);

-- ----------------------------------------------------------------------------
-- Table 4: position_audit_log
-- ----------------------------------------------------------------------------

create table public.position_audit_log (
  id                 uuid primary key default gen_random_uuid(),
  occurred_at        timestamptz not null default now(),
  event_type         text not null,
  position_id        uuid references public.positions(id),
  position_holder_id uuid references public.position_holders(id),
  member_id          text references public.members(id),  -- text per header note
  action             text,
  target_type        text,
  target_id          uuid,
  metadata           jsonb,
  notes              text
);

create index audit_occurred_idx on public.position_audit_log(occurred_at desc);
create index audit_member_idx   on public.position_audit_log(member_id);
create index audit_target_idx   on public.position_audit_log(target_type, target_id);

-- ----------------------------------------------------------------------------
-- Helper: is the calling auth.uid() a Super Admin holder?
-- Used by RLS policies and by client checks if they prefer SQL over the
-- permissions.ts helper.
-- ----------------------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.position_holders ph
      on ph.member_id = u.member_id
     and ph.revoked_at is null
    join public.positions p
      on p.id = ph.position_id
     and p.code = 'super_admin'
     and p.is_active
    where u.id = auth.uid()
  );
$$;

grant execute on function public.is_super_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- Row Level Security
--   positions / position_holders / position_permissions:
--     - SELECT for any authenticated user (app needs to read these to check perms)
--     - INSERT/UPDATE only for Super Admin
--     - No DELETE (intentional — history is preserved via revoked_at)
--   position_audit_log:
--     - SELECT for any authenticated user
--     - INSERT only via log_position_audit() function (security definer)
--     - No UPDATE/DELETE (audit logs are immutable)
-- ----------------------------------------------------------------------------

alter table public.positions             enable row level security;
alter table public.position_holders      enable row level security;
alter table public.position_permissions  enable row level security;
alter table public.position_audit_log    enable row level security;

-- positions
create policy positions_select_authenticated
  on public.positions for select to authenticated using (true);
create policy positions_insert_super_admin
  on public.positions for insert to authenticated with check (public.is_super_admin());
create policy positions_update_super_admin
  on public.positions for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- position_holders
create policy position_holders_select_authenticated
  on public.position_holders for select to authenticated using (true);
create policy position_holders_insert_super_admin
  on public.position_holders for insert to authenticated with check (public.is_super_admin());
create policy position_holders_update_super_admin
  on public.position_holders for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- position_permissions
create policy position_permissions_select_authenticated
  on public.position_permissions for select to authenticated using (true);
create policy position_permissions_insert_super_admin
  on public.position_permissions for insert to authenticated with check (public.is_super_admin());
create policy position_permissions_update_super_admin
  on public.position_permissions for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- position_audit_log: SELECT only via RLS. INSERT goes through the function below.
create policy position_audit_log_select_authenticated
  on public.position_audit_log for select to authenticated using (true);

create or replace function public.log_position_audit(
  p_event_type         text,
  p_position_id        uuid,
  p_position_holder_id uuid,
  p_member_id          text,
  p_action             text,
  p_target_type        text,
  p_target_id          uuid,
  p_metadata           jsonb,
  p_notes              text
) returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.position_audit_log
    (event_type, position_id, position_holder_id, member_id,
     action, target_type, target_id, metadata, notes)
  values
    (p_event_type, p_position_id, p_position_holder_id, p_member_id,
     p_action, p_target_type, p_target_id, p_metadata, p_notes)
  returning id;
$$;

grant execute on function public.log_position_audit(text, uuid, uuid, text, text, text, uuid, jsonb, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- Seed: positions
-- Day-1 catalog per docs/phase-1-rbac-schema.md "What gets seeded on Day 1".
-- ----------------------------------------------------------------------------

insert into public.positions (code, display_name, category, description) values
  ('super_admin',       'Super Admin',                'super_admin', 'Grants and revokes all positions. Held by Coordinator at head office.'),
  ('president',         'President',                  'executive',   'Elected office; reads-only access to operational data by default.'),
  ('president_elect',   'President-Elect',            'executive',   'President-in-waiting; same read access as President.'),
  ('senior_vp',         'Senior Vice President',     'executive',   'Senior executive; reads-only access to operational data.'),
  ('hon_secretary',     'Honorary Secretary',         'executive',   'Approves applications; manages events.'),
  ('joint_secretary',   'Joint Secretary',            'executive',   'Backup for Hon. Secretary actions.'),
  ('treasurer',         'Treasurer',                  'executive',   'Reads payments and financial records.'),
  ('zonal_vp_west',     'Zonal VP — West',            'zonal',       'Manages events and members within the West zone.'),
  ('zonal_vp_east',     'Zonal VP — East',            'zonal',       'Manages events and members within the East zone.'),
  ('zonal_vp_south',    'Zonal VP — South',           'zonal',       'Manages events and members within the South zone.'),
  ('zonal_vp_north',    'Zonal VP — North',           'zonal',       'Manages events and members within the North zone.'),
  ('zonal_vp_central',  'Zonal VP — Central',         'zonal',       'Manages events and members within the Central zone.'),
  ('coordinator',       'Coordinator (Head Office)',  'operational', 'Day-to-day office operations; read access to applications and members.'),
  ('amasicon_convener', 'AMASICON 2026 Convener',     'event',       'Scoped to the AMASICON 2026 event lifecycle.')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Seed: position_permissions
-- Starter set per the schema doc's example table, with sensible defaults
-- inferred for positions the doc doesn't enumerate.
-- ----------------------------------------------------------------------------

do $$
declare
  v_super_admin     uuid;
  v_president       uuid;
  v_president_elect uuid;
  v_senior_vp       uuid;
  v_hon_sec         uuid;
  v_joint_sec       uuid;
  v_treasurer       uuid;
  v_vp_west         uuid;
  v_vp_east         uuid;
  v_vp_south        uuid;
  v_vp_north        uuid;
  v_vp_central      uuid;
  v_coordinator     uuid;
  v_convener        uuid;
begin
  select id into v_super_admin     from public.positions where code = 'super_admin';
  select id into v_president       from public.positions where code = 'president';
  select id into v_president_elect from public.positions where code = 'president_elect';
  select id into v_senior_vp       from public.positions where code = 'senior_vp';
  select id into v_hon_sec         from public.positions where code = 'hon_secretary';
  select id into v_joint_sec       from public.positions where code = 'joint_secretary';
  select id into v_treasurer       from public.positions where code = 'treasurer';
  select id into v_vp_west         from public.positions where code = 'zonal_vp_west';
  select id into v_vp_east         from public.positions where code = 'zonal_vp_east';
  select id into v_vp_south        from public.positions where code = 'zonal_vp_south';
  select id into v_vp_north        from public.positions where code = 'zonal_vp_north';
  select id into v_vp_central      from public.positions where code = 'zonal_vp_central';
  select id into v_coordinator     from public.positions where code = 'coordinator';
  select id into v_convener        from public.positions where code = 'amasicon_convener';

  -- Super Admin: wildcard
  insert into public.position_permissions (position_id, permission, scope) values
    (v_super_admin, '*', null)
  on conflict do nothing;

  -- From the schema doc's example rows
  insert into public.position_permissions (position_id, permission, scope) values
    (v_president, 'applications:read',  null),
    (v_president, 'events:read',        null),
    (v_president, 'members:read',       null),
    (v_hon_sec,   'applications:approve', null),
    (v_hon_sec,   'events:create',      null),
    (v_treasurer, 'payments:read',      null),
    (v_vp_south,  'events:create',      'zone:south'),
    (v_vp_south,  'members:read',       'zone:south'),
    (v_convener,  'event:edit',         'event:amasicon_2026')
  on conflict do nothing;

  -- Sensible defaults for the remaining seeded positions
  insert into public.position_permissions (position_id, permission, scope) values
    (v_president_elect, 'applications:read', null),
    (v_president_elect, 'events:read',       null),
    (v_president_elect, 'members:read',      null),
    (v_senior_vp,       'applications:read', null),
    (v_senior_vp,       'events:read',       null),
    (v_senior_vp,       'members:read',      null),
    (v_joint_sec,       'applications:approve', null),
    (v_joint_sec,       'events:create',     null),
    (v_vp_west,         'events:create',     'zone:west'),
    (v_vp_west,         'members:read',      'zone:west'),
    (v_vp_east,         'events:create',     'zone:east'),
    (v_vp_east,         'members:read',      'zone:east'),
    (v_vp_north,        'events:create',     'zone:north'),
    (v_vp_north,        'members:read',      'zone:north'),
    (v_vp_central,      'events:create',     'zone:central'),
    (v_vp_central,      'members:read',      'zone:central'),
    (v_coordinator,     'members:read',      null),
    (v_coordinator,     'applications:read', null)
  on conflict do nothing;
end $$;

-- ----------------------------------------------------------------------------
-- Seed: Super Admin holder (Prabhu only)
-- Bootstrap row — granted_by is null because no prior holder existed.
-- Backfills positions.created_by to point at this holder row for accountability.
-- ----------------------------------------------------------------------------

do $$
declare
  v_super_admin_pos uuid;
  v_prabhu_member   text;
  v_holder_id       uuid;
begin
  select id into v_super_admin_pos from public.positions where code = 'super_admin';
  select id into v_prabhu_member   from public.members   where email = 'prabhu3693gems@gmail.com';

  if v_prabhu_member is null then
    raise warning '[phase-1 seed] Prabhu member row not found by email; Super Admin holder NOT seeded. Insert manually after fixing.';
    return;
  end if;

  -- Idempotent: skip if Prabhu already holds super_admin actively.
  if not exists (
    select 1 from public.position_holders
    where position_id = v_super_admin_pos
      and member_id   = v_prabhu_member
      and revoked_at is null
  ) then
    insert into public.position_holders (position_id, member_id, granted_at, granted_by)
    values (v_super_admin_pos, v_prabhu_member, now(), null)
    returning id into v_holder_id;

    -- Backfill: positions.created_by for any rows still null.
    update public.positions set created_by = v_holder_id where created_by is null;
  end if;
end $$;

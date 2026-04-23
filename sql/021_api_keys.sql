-- External API keys for member lookup integrations (Events360, partner orgs).
-- Raw key is returned exactly once at creation time; only the SHA-256 hash is stored.

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text unique not null,
  key_prefix text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  created_by text,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_api_keys_active_hash
  on api_keys (key_hash)
  where status = 'active';

create index if not exists idx_api_keys_created_at
  on api_keys (created_at desc);

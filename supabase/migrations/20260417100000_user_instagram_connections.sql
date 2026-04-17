create table if not exists public.user_provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_family text not null check (source_family in ('instagram')),
  provider text not null check (provider in ('meta_instagram')),
  status text not null default 'connected' check (
    status in ('connected', 'needs_reconnect', 'disconnected')
  ),
  access_token text,
  refresh_token text,
  token_type text,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  last_refreshed_at timestamptz,
  next_refresh_at timestamptz,
  refresh_attempted_at timestamptz,
  refresh_error text,
  refresh_metadata jsonb not null default '{}'::jsonb,
  instagram_business_account_id text,
  connected_username text,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  constraint user_provider_connections_user_provider_key unique (user_id, provider),
  constraint user_provider_connections_connected_has_token check (
    status <> 'connected'
    or (
      access_token is not null
      and instagram_business_account_id is not null
    )
  )
);

create index if not exists user_provider_connections_owner_provider_idx
on public.user_provider_connections (user_id, provider, status);

create index if not exists user_provider_connections_refresh_idx
on public.user_provider_connections (provider, status, next_refresh_at)
where status = 'connected';

drop trigger if exists user_provider_connections_touch_updated_at
on public.user_provider_connections;

create trigger user_provider_connections_touch_updated_at
before update on public.user_provider_connections
for each row execute function public.touch_updated_at();

alter table public.user_provider_connections enable row level security;

revoke all on public.user_provider_connections from anon, authenticated;

drop policy if exists "user_provider_connections select own" on public.user_provider_connections;
create policy "user_provider_connections select own"
on public.user_provider_connections
for select
to authenticated
using (user_id = auth.uid());

drop view if exists public.current_user_instagram_connections;

create view public.current_user_instagram_connections as
select
  id,
  source_family,
  provider,
  status,
  token_expires_at,
  next_refresh_at,
  refresh_attempted_at,
  refresh_error,
  instagram_business_account_id,
  connected_username,
  display_name,
  metadata - 'access_token' - 'page_access_token' as metadata,
  created_at,
  updated_at,
  disconnected_at
from public.user_provider_connections
where user_id = auth.uid()
  and provider = 'meta_instagram';

grant select on public.current_user_instagram_connections to authenticated;

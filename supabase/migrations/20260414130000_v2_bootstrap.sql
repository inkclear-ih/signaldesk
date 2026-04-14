create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('rss', 'atom')),
  name text not null,
  url text not null,
  site_url text,
  feed_url text not null,
  status text not null default 'active' check (
    status in ('validating', 'active', 'paused', 'archived', 'invalid')
  ),
  last_validated_at timestamptz,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint sources_feed_url_key unique (feed_url)
);

create table public.user_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  display_name text,
  tags text[] not null default '{}',
  sort_order integer,
  created_at timestamptz not null default now(),
  paused_at timestamptz,
  archived_at timestamptz,
  constraint user_sources_user_source_key unique (user_id, source_id)
);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('ok', 'error', 'partial')),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  known_count integer not null default 0 check (known_count >= 0),
  error_message text,
  http_status integer,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  item_key text not null,
  title text,
  link text,
  summary text,
  author text,
  published_at timestamptz,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  seen_count integer not null default 1 check (seen_count >= 1),
  first_seen_run_id uuid not null references public.ingestion_runs(id) on delete restrict,
  last_seen_run_id uuid not null references public.ingestion_runs(id) on delete restrict,
  raw_guid text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  constraint items_source_item_key unique (source_id, item_key)
);

create table public.user_item_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  review_state text check (
    review_state is null or review_state = 'reviewed'
  ),
  disposition_state text not null default 'none' check (
    disposition_state in ('none', 'saved', 'archived', 'hidden')
  ),
  reviewed_at timestamptz,
  saved_at timestamptz,
  archived_at timestamptz,
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint user_item_states_has_state check (
    review_state is not null or disposition_state <> 'none'
  ),
  constraint user_item_states_user_item_key unique (user_id, item_id)
);

create index sources_status_idx on public.sources(status);
create index user_sources_user_status_idx on public.user_sources(user_id, status);
create index user_sources_source_idx on public.user_sources(source_id);
create index ingestion_runs_source_started_idx on public.ingestion_runs(source_id, started_at desc);
create index items_source_published_idx on public.items(source_id, published_at desc);
create index items_first_seen_run_idx on public.items(first_seen_run_id);
create index items_last_seen_run_idx on public.items(last_seen_run_id);
create index user_item_states_user_review_idx on public.user_item_states(
  user_id,
  review_state,
  disposition_state
);
create index user_item_states_item_idx on public.user_item_states(item_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_item_states_touch_updated_at
before update on public.user_item_states
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, created_at)
  values (new.id, new.email, now())
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.user_sources enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.items enable row level security;
alter table public.user_item_states enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select on public.sources to authenticated;
grant select on public.user_sources to authenticated;
grant select on public.ingestion_runs to authenticated;
grant select on public.items to authenticated;
grant select, insert, update, delete on public.user_item_states to authenticated;

create policy "profiles select own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles insert own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles update own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "user_sources select own"
on public.user_sources
for select
to authenticated
using (user_id = auth.uid());

create policy "sources select subscribed"
on public.sources
for select
to authenticated
using (
  exists (
    select 1
    from public.user_sources us
    where us.source_id = sources.id
      and us.user_id = auth.uid()
      and us.status <> 'archived'
  )
);

create policy "ingestion_runs select subscribed"
on public.ingestion_runs
for select
to authenticated
using (
  exists (
    select 1
    from public.user_sources us
    where us.source_id = ingestion_runs.source_id
      and us.user_id = auth.uid()
      and us.status <> 'archived'
  )
);

create policy "items select active subscriptions"
on public.items
for select
to authenticated
using (
  exists (
    select 1
    from public.user_sources us
    where us.source_id = items.source_id
      and us.user_id = auth.uid()
      and us.status = 'active'
  )
);

create policy "user_item_states select own"
on public.user_item_states
for select
to authenticated
using (user_id = auth.uid());

create policy "user_item_states insert own visible item"
on public.user_item_states
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.items i
    join public.user_sources us on us.source_id = i.source_id
    where i.id = user_item_states.item_id
      and us.user_id = auth.uid()
      and us.status = 'active'
  )
);

create policy "user_item_states update own visible item"
on public.user_item_states
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.items i
    join public.user_sources us on us.source_id = i.source_id
    where i.id = user_item_states.item_id
      and us.user_id = auth.uid()
      and us.status = 'active'
  )
);

create policy "user_item_states delete own"
on public.user_item_states
for delete
to authenticated
using (user_id = auth.uid());

create or replace view public.current_user_sources
with (security_invoker = true)
as
select
  us.id as user_source_id,
  us.status as user_source_status,
  us.display_name,
  us.tags,
  us.sort_order,
  us.created_at as subscribed_at,
  s.id as source_id,
  s.name as source_name,
  s.feed_url,
  s.site_url,
  s.status as source_status,
  s.last_fetched_at,
  s.last_error
from public.user_sources us
join public.sources s on s.id = us.source_id
where us.user_id = auth.uid();

create or replace view public.current_user_items
with (security_invoker = true)
as
select
  i.id,
  i.source_id,
  s.name as source_name,
  i.item_key,
  i.title,
  i.link,
  i.summary,
  i.author,
  i.published_at,
  i.first_seen_at,
  i.last_seen_at,
  i.seen_count,
  i.first_seen_run_id,
  i.last_seen_run_id,
  case
    when latest_run.id is not null and i.first_seen_run_id = latest_run.id then 'new'
    else 'known'
  end as system_state,
  case
    when latest_run.id is not null and i.first_seen_run_id = latest_run.id then 0
    else 1
  end as system_state_rank,
  coalesce(uis.review_state, 'unreviewed') as review_state,
  coalesce(uis.disposition_state, 'none') as disposition_state,
  uis.reviewed_at
from public.items i
join public.sources s on s.id = i.source_id
join public.user_sources us on us.source_id = i.source_id
left join public.user_item_states uis
  on uis.item_id = i.id
  and uis.user_id = auth.uid()
left join lateral (
  select r.id
  from public.ingestion_runs r
  where r.source_id = i.source_id
    and r.status in ('ok', 'partial')
  order by r.started_at desc
  limit 1
) latest_run on true
where us.user_id = auth.uid()
  and us.status = 'active'
  and s.status = 'active'
  and coalesce(uis.disposition_state, 'none') = 'none'
order by
  case
    when latest_run.id is not null and i.first_seen_run_id = latest_run.id then 0
    else 1
  end,
  i.published_at desc nulls last,
  i.first_seen_at desc;

grant select on public.current_user_sources to authenticated;
grant select on public.current_user_items to authenticated;

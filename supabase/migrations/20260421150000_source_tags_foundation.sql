create table if not exists public.source_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  color text not null check (
    color in ('slate', 'blue', 'green', 'amber', 'rose', 'purple', 'teal', 'orange')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_tags_name_length check (char_length(btrim(name)) between 1 and 48),
  constraint source_tags_user_name_key unique (user_id, normalized_name)
);

create unique index if not exists user_sources_id_user_id_key
on public.user_sources (id, user_id);

create unique index if not exists source_tags_id_user_id_key
on public.source_tags (id, user_id);

create table if not exists public.user_source_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  user_source_id uuid not null,
  source_tag_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_source_tags_pkey primary key (user_source_id, source_tag_id),
  constraint user_source_tags_user_source_key foreign key (user_source_id, user_id)
    references public.user_sources(id, user_id) on delete cascade,
  constraint user_source_tags_source_tag_key foreign key (source_tag_id, user_id)
    references public.source_tags(id, user_id) on delete cascade
);

create index if not exists user_source_tags_user_source_idx
on public.user_source_tags (user_id, user_source_id);

create index if not exists user_source_tags_source_tag_idx
on public.user_source_tags (user_id, source_tag_id);

drop trigger if exists source_tags_touch_updated_at on public.source_tags;

create trigger source_tags_touch_updated_at
before update on public.source_tags
for each row execute function public.touch_updated_at();

alter table public.source_tags enable row level security;
alter table public.user_source_tags enable row level security;

grant select, insert, update, delete on public.source_tags to authenticated;
grant select, insert, delete on public.user_source_tags to authenticated;

drop policy if exists "source_tags select own" on public.source_tags;
create policy "source_tags select own"
on public.source_tags
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "source_tags insert own" on public.source_tags;
create policy "source_tags insert own"
on public.source_tags
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "source_tags update own" on public.source_tags;
create policy "source_tags update own"
on public.source_tags
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "source_tags delete own" on public.source_tags;
create policy "source_tags delete own"
on public.source_tags
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_source_tags select own" on public.user_source_tags;
create policy "user_source_tags select own"
on public.user_source_tags
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_source_tags insert own" on public.user_source_tags;
create policy "user_source_tags insert own"
on public.user_source_tags
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_source_tags delete own" on public.user_source_tags;
create policy "user_source_tags delete own"
on public.user_source_tags
for delete
to authenticated
using (user_id = auth.uid());

with cleaned_tags as (
  select
    us.user_id,
    us.id as user_source_id,
    nullif(regexp_replace(btrim(tag), '\s+', ' ', 'g'), '') as tag_name
  from public.user_sources us
  cross join lateral unnest(coalesce(us.tags, '{}'::text[])) as tag
)
insert into public.source_tags (user_id, name, color)
select distinct
  cleaned_tags.user_id,
  cleaned_tags.tag_name,
  'slate'
from cleaned_tags
where cleaned_tags.tag_name is not null
on conflict on constraint source_tags_user_name_key do nothing;

with cleaned_tags as (
  select
    us.user_id,
    us.id as user_source_id,
    nullif(regexp_replace(btrim(tag), '\s+', ' ', 'g'), '') as tag_name
  from public.user_sources us
  cross join lateral unnest(coalesce(us.tags, '{}'::text[])) as tag
)
insert into public.user_source_tags (user_id, user_source_id, source_tag_id)
select
  cleaned_tags.user_id,
  cleaned_tags.user_source_id,
  st.id
from cleaned_tags
join public.source_tags st
  on st.user_id = cleaned_tags.user_id
 and st.normalized_name = lower(cleaned_tags.tag_name)
where cleaned_tags.tag_name is not null
on conflict do nothing;

create or replace function public.subscribe_to_instagram_source(
  p_handle text,
  p_profile_url text,
  p_display_name text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  user_source_id uuid,
  source_id uuid,
  user_source_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscriber_user_id uuid := auth.uid();
  v_canonical_source_id uuid;
  v_user_source_subscription_id uuid;
  v_handle text := lower(nullif(btrim(p_handle), ''));
  v_profile_url text := nullif(btrim(p_profile_url), '');
  v_display_name text := nullif(btrim(p_display_name), '');
  v_source_key text;
  v_metadata jsonb;
begin
  if v_subscriber_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_handle is null then
    raise exception 'Instagram handle is required';
  end if;

  if v_profile_url is null then
    raise exception 'Instagram profile URL is required';
  end if;

  if v_handle !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'Invalid Instagram handle';
  end if;

  v_source_key := 'instagram:' || v_handle;
  v_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'platform', 'instagram',
    'handle', v_handle,
    'profile_url', v_profile_url,
    'account_kind', 'professional_or_creator',
    'monitoring_scope', 'account_posts',
    'ingestion_adapter', 'instagram_professional_account',
    'api_status', 'pending_connection'
  );

  insert into public.sources as s (
    type,
    source_key,
    name,
    url,
    site_url,
    feed_url,
    status,
    last_validated_at,
    last_error,
    metadata
  )
  values (
    'instagram',
    v_source_key,
    coalesce(v_display_name, '@' || v_handle),
    v_profile_url,
    v_profile_url,
    null,
    'validating',
    now(),
    null,
    v_metadata
  )
  on conflict (source_key) where source_key is not null do update
    set
      name = coalesce(v_display_name, s.name),
      url = excluded.url,
      site_url = excluded.site_url,
      status = case
        when s.status in ('invalid', 'archived') then 'validating'
        else s.status
      end,
      last_validated_at = now(),
      last_error = null,
      metadata = coalesce(s.metadata, '{}'::jsonb) || excluded.metadata
  returning s.id into v_canonical_source_id;

  insert into public.user_sources as us (
    user_id,
    source_id,
    status,
    display_name,
    tags,
    paused_at,
    archived_at
  )
  values (
    v_subscriber_user_id,
    v_canonical_source_id,
    'active',
    coalesce(v_display_name, '@' || v_handle),
    '{}',
    null,
    null
  )
  on conflict on constraint user_sources_user_source_key do update
    set
      status = 'active',
      display_name = coalesce(us.display_name, excluded.display_name),
      paused_at = null,
      archived_at = null
  returning us.id into v_user_source_subscription_id;

  return query
  select
    v_user_source_subscription_id as user_source_id,
    v_canonical_source_id as source_id,
    'active'::text as user_source_status;
end;
$$;

revoke all on function public.subscribe_to_instagram_source(text, text, text, jsonb) from public;
grant execute on function public.subscribe_to_instagram_source(text, text, text, jsonb) to authenticated;

create or replace view public.current_user_sources
with (security_invoker = true)
as
select
  us.id as user_source_id,
  us.status as user_source_status,
  us.display_name,
  coalesce(
    array_agg(st.name order by st.name) filter (where st.id is not null),
    '{}'::text[]
  ) as tags,
  us.sort_order,
  us.created_at as subscribed_at,
  s.id as source_id,
  s.type as source_type,
  s.source_key,
  s.name as source_name,
  s.url as source_url,
  s.site_url,
  s.feed_url,
  s.metadata,
  s.status as source_status,
  s.last_fetched_at,
  s.last_error,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', st.id,
        'name', st.name,
        'color', st.color
      )
      order by st.name
    ) filter (where st.id is not null),
    '[]'::jsonb
  ) as source_tags
from public.user_sources us
join public.sources s on s.id = us.source_id
left join public.user_source_tags ust
  on ust.user_source_id = us.id
 and ust.user_id = us.user_id
left join public.source_tags st
  on st.id = ust.source_tag_id
 and st.user_id = us.user_id
where us.user_id = auth.uid()
group by
  us.id,
  us.status,
  us.display_name,
  us.sort_order,
  us.created_at,
  s.id,
  s.type,
  s.source_key,
  s.name,
  s.url,
  s.site_url,
  s.feed_url,
  s.metadata,
  s.status,
  s.last_fetched_at,
  s.last_error;

grant select on public.current_user_sources to authenticated;
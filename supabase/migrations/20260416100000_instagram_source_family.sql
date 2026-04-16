alter table public.sources
  add column if not exists source_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.sources
set
  source_key = coalesce(source_key, type || ':' || lower(feed_url)),
  metadata = coalesce(metadata, '{}'::jsonb)
where feed_url is not null;

alter table public.sources
  alter column feed_url drop not null;

alter table public.sources
  drop constraint if exists sources_type_check;

alter table public.sources
  add constraint sources_type_check
  check (type in ('rss', 'atom', 'instagram'));

alter table public.sources
  drop constraint if exists sources_feed_or_instagram_check;

alter table public.sources
  add constraint sources_feed_or_instagram_check
  check (
    (
      type in ('rss', 'atom')
      and feed_url is not null
    )
    or (
      type = 'instagram'
      and feed_url is null
      and metadata ? 'handle'
      and metadata ? 'profile_url'
    )
  );

create unique index if not exists sources_source_key_key
on public.sources (source_key)
where source_key is not null;

create index if not exists sources_type_status_idx
on public.sources (type, status);

create or replace function public.subscribe_to_feed_source(
  p_feed_url text,
  p_name text,
  p_type text,
  p_site_url text default null
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
  v_source_name text := nullif(btrim(p_name), '');
  v_feed_url text := nullif(btrim(p_feed_url), '');
  v_site_url text := nullif(btrim(p_site_url), '');
begin
  if v_subscriber_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_feed_url is null then
    raise exception 'Feed URL is required';
  end if;

  if p_type not in ('rss', 'atom') then
    raise exception 'Unsupported feed type';
  end if;

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
    p_type,
    p_type || ':' || lower(v_feed_url),
    coalesce(v_source_name, v_feed_url),
    v_feed_url,
    v_site_url,
    v_feed_url,
    'active',
    now(),
    null,
    jsonb_build_object('source_family', 'web_feed')
  )
  on conflict on constraint sources_feed_url_key do update
    set
      type = excluded.type,
      source_key = coalesce(s.source_key, excluded.source_key),
      name = coalesce(v_source_name, s.name),
      url = excluded.url,
      site_url = coalesce(excluded.site_url, s.site_url),
      status = case
        when s.status in ('validating', 'invalid') then 'active'
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
    v_source_name,
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
    array['instagram'],
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

revoke all on function public.subscribe_to_feed_source(text, text, text, text) from public;
grant execute on function public.subscribe_to_feed_source(text, text, text, text) to authenticated;

revoke all on function public.subscribe_to_instagram_source(text, text, text, jsonb) from public;
grant execute on function public.subscribe_to_instagram_source(text, text, text, jsonb) to authenticated;

drop view if exists public.current_user_sources;

create view public.current_user_sources
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
  s.type as source_type,
  s.source_key,
  s.name as source_name,
  s.url as source_url,
  s.site_url,
  s.feed_url,
  s.metadata,
  s.status as source_status,
  s.last_fetched_at,
  s.last_error
from public.user_sources us
join public.sources s on s.id = us.source_id
where us.user_id = auth.uid();

grant select on public.current_user_sources to authenticated;

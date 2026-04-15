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
    name,
    url,
    site_url,
    feed_url,
    status,
    last_validated_at,
    last_error
  )
  values (
    p_type,
    coalesce(v_source_name, v_feed_url),
    v_feed_url,
    v_site_url,
    v_feed_url,
    'active',
    now(),
    null
  )
  on conflict on constraint sources_feed_url_key do update
    set
      type = excluded.type,
      name = coalesce(v_source_name, s.name),
      url = excluded.url,
      site_url = coalesce(excluded.site_url, s.site_url),
      status = case
        when s.status in ('validating', 'invalid') then 'active'
        else s.status
      end,
      last_validated_at = now(),
      last_error = null
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

revoke all on function public.subscribe_to_feed_source(text, text, text, text) from public;
grant execute on function public.subscribe_to_feed_source(text, text, text, text) to authenticated;

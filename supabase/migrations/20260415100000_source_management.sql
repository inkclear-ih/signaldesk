drop policy if exists "sources select subscribed" on public.sources;

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
  )
);

grant update (status, paused_at, archived_at) on public.user_sources to authenticated;

create policy "user_sources update own"
on public.user_sources
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

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
  v_user_id uuid := auth.uid();
  v_source_id uuid;
  v_user_source_id uuid;
  v_name text := nullif(btrim(p_name), '');
  v_feed_url text := nullif(btrim(p_feed_url), '');
  v_site_url text := nullif(btrim(p_site_url), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_feed_url is null then
    raise exception 'Feed URL is required';
  end if;

  if p_type not in ('rss', 'atom') then
    raise exception 'Unsupported feed type';
  end if;

  insert into public.sources (
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
    coalesce(v_name, v_feed_url),
    v_feed_url,
    v_site_url,
    v_feed_url,
    'active',
    now(),
    null
  )
  on conflict (feed_url) do update
    set
      type = excluded.type,
      name = coalesce(v_name, public.sources.name),
      url = excluded.url,
      site_url = coalesce(excluded.site_url, public.sources.site_url),
      status = case
        when public.sources.status in ('validating', 'invalid') then 'active'
        else public.sources.status
      end,
      last_validated_at = now(),
      last_error = null
  returning id into v_source_id;

  insert into public.user_sources (
    user_id,
    source_id,
    status,
    display_name,
    tags,
    paused_at,
    archived_at
  )
  values (
    v_user_id,
    v_source_id,
    'active',
    v_name,
    '{}',
    null,
    null
  )
  on conflict (user_id, source_id) do update
    set
      status = 'active',
      display_name = coalesce(public.user_sources.display_name, excluded.display_name),
      paused_at = null,
      archived_at = null
  returning id into v_user_source_id;

  return query
  select v_user_source_id, v_source_id, 'active'::text;
end;
$$;

revoke all on function public.subscribe_to_feed_source(text, text, text, text) from public;
grant execute on function public.subscribe_to_feed_source(text, text, text, text) to authenticated;

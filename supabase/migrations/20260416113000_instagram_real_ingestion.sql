update public.sources
set
  status = 'active',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'api_status', 'pending_scan',
    'ingestion_adapter', 'instagram_professional_account'
  )
where type = 'instagram'
  and status = 'validating';

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
    'api_status', 'pending_scan'
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
    'active',
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
        when s.status in ('validating', 'invalid', 'archived') then 'active'
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

revoke all on function public.subscribe_to_instagram_source(text, text, text, jsonb) from public;
grant execute on function public.subscribe_to_instagram_source(text, text, text, jsonb) to authenticated;

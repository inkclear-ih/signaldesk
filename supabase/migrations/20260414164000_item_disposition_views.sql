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
  uis.reviewed_at,
  uis.saved_at,
  uis.archived_at,
  uis.hidden_at
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
order by
  case
    when latest_run.id is not null and i.first_seen_run_id = latest_run.id then 0
    else 1
  end,
  i.published_at desc nulls last,
  i.first_seen_at desc;

grant select on public.current_user_items to authenticated;

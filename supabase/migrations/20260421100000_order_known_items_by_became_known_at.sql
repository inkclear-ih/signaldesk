create or replace view public.current_user_items as
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
    next_run.started_at as became_known_at,
    i.seen_count,
    i.first_seen_run_id,
    i.last_seen_run_id,
    case
        when latest_run.id is not null and i.first_seen_run_id = latest_run.id then 'new'::text
        else 'known'::text
    end as system_state,
    case
        when latest_run.id is not null and i.first_seen_run_id = latest_run.id then 0
        else 1
    end as system_state_rank,
    coalesce(uis.review_state, 'unreviewed'::text) as review_state,
    coalesce(uis.disposition_state, 'none'::text) as disposition_state,
    uis.reviewed_at,
    uis.saved_at,
    uis.archived_at,
    uis.hidden_at,
    s.type as source_type,
    i.raw_payload
from items i
join sources s on s.id = i.source_id
join user_sources us on us.source_id = i.source_id
join ingestion_runs first_seen_run on first_seen_run.id = i.first_seen_run_id
left join user_item_states uis
    on uis.item_id = i.id
   and uis.user_id = auth.uid()
left join lateral (
    select r.id
    from ingestion_runs r
    where r.source_id = i.source_id
      and (r.status = any (array['ok'::text, 'partial'::text]))
    order by r.started_at desc
    limit 1
) latest_run on true
left join lateral (
    select r.started_at
    from ingestion_runs r
    where r.source_id = i.source_id
      and (r.status = any (array['ok'::text, 'partial'::text]))
      and r.started_at > first_seen_run.started_at
    order by r.started_at asc
    limit 1
) next_run on true
where us.user_id = auth.uid()
  and us.status <> 'archived'::text
  and s.status = 'active'::text
order by
    (
        case
            when latest_run.id is not null and i.first_seen_run_id = latest_run.id then 0
            else 1
        end
    ),
    (
        case
            when latest_run.id is not null and i.first_seen_run_id = latest_run.id then i.published_at
            else next_run.started_at
        end
    ) desc nulls last,
    i.published_at desc nulls last,
    i.first_seen_at desc;

grant select on public.current_user_items to authenticated;

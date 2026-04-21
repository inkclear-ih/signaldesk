create table if not exists public.item_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  color text not null check (
    color in ('slate', 'blue', 'green', 'amber', 'rose', 'purple', 'teal', 'orange')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_tags_name_length check (char_length(btrim(name)) between 1 and 48),
  constraint item_tags_user_name_key unique (user_id, normalized_name)
);

create unique index if not exists item_tags_id_user_id_key
on public.item_tags (id, user_id);

create table if not exists public.user_item_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  item_tag_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_item_tags_pkey primary key (item_id, item_tag_id),
  constraint user_item_tags_item_tag_key foreign key (item_tag_id, user_id)
    references public.item_tags(id, user_id) on delete cascade
);

create index if not exists user_item_tags_user_item_idx
on public.user_item_tags (user_id, item_id);

create index if not exists user_item_tags_item_tag_idx
on public.user_item_tags (user_id, item_tag_id);

drop trigger if exists item_tags_touch_updated_at on public.item_tags;

create trigger item_tags_touch_updated_at
before update on public.item_tags
for each row execute function public.touch_updated_at();

alter table public.item_tags enable row level security;
alter table public.user_item_tags enable row level security;

grant select, insert, update, delete on public.item_tags to authenticated;
grant select, insert, delete on public.user_item_tags to authenticated;

drop policy if exists "item_tags select own" on public.item_tags;
create policy "item_tags select own"
on public.item_tags
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "item_tags insert own" on public.item_tags;
create policy "item_tags insert own"
on public.item_tags
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "item_tags update own" on public.item_tags;
create policy "item_tags update own"
on public.item_tags
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "item_tags delete own" on public.item_tags;
create policy "item_tags delete own"
on public.item_tags
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_item_tags select own visible item" on public.user_item_tags;
create policy "user_item_tags select own visible item"
on public.user_item_tags
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.items i
    join public.user_sources us on us.source_id = i.source_id
    where i.id = user_item_tags.item_id
      and us.user_id = auth.uid()
      and us.status <> 'archived'
  )
);

drop policy if exists "user_item_tags insert own visible item" on public.user_item_tags;
create policy "user_item_tags insert own visible item"
on public.user_item_tags
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.items i
    join public.user_sources us on us.source_id = i.source_id
    where i.id = user_item_tags.item_id
      and us.user_id = auth.uid()
      and us.status <> 'archived'
  )
);

drop policy if exists "user_item_tags delete own visible item" on public.user_item_tags;
create policy "user_item_tags delete own visible item"
on public.user_item_tags
for delete
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.items i
    join public.user_sources us on us.source_id = i.source_id
    where i.id = user_item_tags.item_id
      and us.user_id = auth.uid()
      and us.status <> 'archived'
  )
);

drop view if exists public.current_user_items;
create view public.current_user_items as
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
    i.raw_payload,
    coalesce(
      jsonb_agg(
        distinct jsonb_build_object(
          'id', it.id,
          'name', it.name,
          'color', it.color
        )
      ) filter (where it.id is not null),
      '[]'::jsonb
    ) as item_tags
from items i
join sources s on s.id = i.source_id
join user_sources us on us.source_id = i.source_id
join ingestion_runs first_seen_run on first_seen_run.id = i.first_seen_run_id
left join user_item_states uis
    on uis.item_id = i.id
   and uis.user_id = auth.uid()
left join user_item_tags uit
    on uit.item_id = i.id
   and uit.user_id = auth.uid()
left join item_tags it
    on it.id = uit.item_tag_id
   and it.user_id = auth.uid()
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
group by
    i.id,
    i.source_id,
    s.name,
    i.item_key,
    i.title,
    i.link,
    i.summary,
    i.author,
    i.published_at,
    i.first_seen_at,
    i.last_seen_at,
    next_run.started_at,
    i.seen_count,
    i.first_seen_run_id,
    i.last_seen_run_id,
    latest_run.id,
    uis.review_state,
    uis.disposition_state,
    uis.reviewed_at,
    uis.saved_at,
    uis.archived_at,
    uis.hidden_at,
    s.type,
    i.raw_payload
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

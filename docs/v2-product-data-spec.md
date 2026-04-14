# Signaldesk v2 Product and Data Spec

Signaldesk v2 turns the current static RSS report prototype into a personal, multi-device monitoring and review app. The prototype has already proven the core loop: fetch RSS/Atom sources, normalize items, dedupe them exactly, separate system freshness from user review state, and render a readable report. v2 keeps that foundation and adds synced identity, persistent source subscriptions, durable item review state, and later item dispositions such as saved, archived, and hidden.

## Product Definition

Signaldesk is a personal monitoring, triage, and review tool for people who follow a focused set of sources and need a dependable place to see what changed, decide what matters, and return to saved material later. It is for an individual operator, researcher, founder, builder, or analyst who wants a calm inbox for feeds they chose themselves, not a generic analytics dashboard or social feed. Signaldesk solves the problem of scattered update streams by turning RSS/Atom source monitoring into a persistent review workflow that follows the user across devices.

## Core Entities

### `users`

Authenticated people using Signaldesk. A user owns source subscriptions, review state, item dispositions, and preferences.

Minimum fields:

- `id`
- `email`
- `created_at`
- `last_seen_at`

### `sources`

Feed endpoints known to the system. A source represents one monitored RSS/Atom feed, not a user's relationship to it.

Minimum fields:

- `id`
- `type`: initially `rss` or `atom`
- `name`
- `url`
- `site_url`
- `feed_url`
- `status`: `validating`, `active`, `paused`, `archived`, `invalid`
- `last_validated_at`
- `last_fetched_at`
- `last_error`
- `created_at`
- `archived_at`

Relationship:

- One `source` can be subscribed to by many users.

### `user_sources`

The user's subscription to a source. This is where personal labels, tags, ordering, and lifecycle controls belong.

Minimum fields:

- `id`
- `user_id`
- `source_id`
- `status`: `active`, `paused`, `archived`
- `display_name`
- `tags`
- `sort_order`
- `created_at`
- `paused_at`
- `archived_at`

Relationship:

- A user has many `user_sources`.
- A source has many `user_sources`.

Constraint:

- Unique on `user_id` plus `source_id`.

### `items`

Source-scoped feed entries seen by the system. For early v2, an item belongs to exactly one source and is deduped only within that source using a stable item key derived from normalized link first, then a title fallback when no link exists.

Minimum fields:

- `id`
- `source_id`
- `item_key`
- `title`
- `link`
- `summary`
- `author`
- `published_at`
- `first_seen_at`
- `last_seen_at`
- `first_seen_run_id`
- `last_seen_run_id`
- `seen_count`
- `raw_guid`
- `raw_payload`

Relationship:

- A source has many items.
- A user sees items through their active `user_sources`.
- `first_seen_run_id` and `last_seen_run_id` reference `ingestion_runs`.

Constraint:

- Unique on `source_id` plus `item_key`.

Why source-scoped items for early v2:

- It matches the current prototype, where items arrive from a known source and item keys are computed from feed entry data.
- It avoids unsafe cross-source assumptions, such as two feeds linking to the same URL for different editorial reasons or mirroring each other with different metadata.
- It preserves provenance cleanly: every item has one source, one ingestion history, and one source-specific identity.
- True cross-source canonicalization can be added later with a separate canonical entity or merge table if duplicated links across sources become a real product problem.

### `ingestion_runs`

Records each source fetch attempt and its outcome. This preserves operational traceability without making source status carry all history.

Minimum fields:

- `id`
- `source_id`
- `started_at`
- `finished_at`
- `status`: `ok`, `error`, `partial`
- `fetched_count`
- `new_count`
- `known_count`
- `error_message`
- `http_status`

Relationship:

- A source has many ingestion runs.
- Items reference the run where they were first seen and the run where they were most recently seen.

### `user_item_states`

The user's durable state for an item. This replaces browser-local reviewed state from the static prototype and keeps review state separate from disposition state.

Minimum fields:

- `id`
- `user_id`
- `item_id`
- `reviewed_at`
- `disposition`: nullable enum, one of `saved`, `archived`, `hidden`, or `null`
- `disposition_updated_at`
- `created_at`
- `updated_at`

Relationship:

- A user can have one `user_item_state` per item.
- Missing row means review state is implied `unreviewed` and disposition is implied `null`.

Constraint:

- Unique on `user_id` plus `item_id`.

Rules:

- Review state is not stored as a mixed enum.
- A persisted row means the item has been reviewed by that user; `reviewed_at` should be non-null.
- Disposition is a separate nullable field.
- In early v2, setting `saved`, `archived`, or `hidden` should also ensure `reviewed_at` is set if it was not already set.
- Marking an item unreviewed in the first implementation slice deletes the row when `disposition` is `null`.

### Optional Later Entities

Do not add separate `saved_items` or `archived_items` tables in early v2. `user_item_states.disposition` is enough because saved, archived, and hidden are user-level dispositions on the same item.

Consider a later `item_notes` table only when personal notes or annotations become part of the product.

## State Model

Signaldesk has three separate state concepts.

### System-Level Freshness

System freshness describes whether an item is new to a source's ingestion history.

- `new`: The item's `first_seen_run_id` equals the latest successful ingestion run for its source in the current inbox context.
- `known`: The item was first seen before the latest successful ingestion run for its source.

Persistence:

- Persist `items.first_seen_at`, `items.last_seen_at`, `items.first_seen_run_id`, `items.last_seen_run_id`, and `items.seen_count`.
- Persist each run in `ingestion_runs`.
- Do not persist `new` or `known` as permanent user-facing item states.
- Derive `new` and `known` at query/render time relative to the latest successful ingestion run for each source.

Implementation rule:

- Create the `ingestion_runs` row before processing entries.
- On insert, set `first_seen_run_id` and `last_seen_run_id` to the current run.
- On repeat sighting, keep `first_seen_run_id`, update `last_seen_run_id`, update `last_seen_at`, and increment `seen_count`.
- Count `new_count` and `known_count` from whether each processed entry inserted a new `(source_id, item_key)` or matched an existing one.

### User Review State

Review state describes whether a user has triaged an item.

- `unreviewed`: Implied by a missing `user_item_states` row.
- `reviewed`: Persisted by a `user_item_states` row with `reviewed_at`.

Persistence:

- Persist only reviewed state.
- Do not store `unreviewed` as a row value.
- To mark reviewed, create or update `user_item_states` and set `reviewed_at`.
- To mark unreviewed in the first implementation slice, delete the row if `disposition` is `null`.

### User Disposition

Disposition describes what the user wants to do with an item after or during review.

- `null`: No saved/archive/hidden disposition.
- `saved`: The user wants to keep the item accessible.
- `archived`: The user removed the item from the active inbox but wants traceability.
- `hidden`: The user does not want to see the item again in normal views.

Persistence:

- Persist disposition as `user_item_states.disposition`.
- Missing row implies disposition `null`.
- `saved`, `archived`, and `hidden` are mutually exclusive in early v2.
- Dispositions are not part of review state.

## Source Lifecycle

### Add

The user adds a feed URL or website URL. Signaldesk should normalize it into an existing source if the feed already exists, or create a new source if it does not.

### Validate

Signaldesk fetches and parses the feed before making it active.

Validation should capture:

- Whether the URL is reachable.
- Whether the content parses as RSS/Atom.
- Feed title and site URL if available.
- First validation error if invalid.

### Active

An active source is eligible for scheduled ingestion. A user sees items from active `user_sources`.

### Paused

Paused sources are not fetched for that user. If another user still has the same source active, the source may still be fetched system-wide.

### Archived / Deleted

Prefer archive over hard delete for early v2.

Traceability rules:

- Archive `user_sources` when a user removes a source from their active set.
- Keep `sources`, `items`, and `ingestion_runs` unless there is a privacy or retention requirement to delete.
- Do not orphan review history. A user should still be able to understand why an archived item exists.
- Hard delete should be reserved for invalid test data, compliance/privacy deletion, or explicit account deletion.

## Item Lifecycle

### First Seen

During ingestion, Signaldesk computes an exact `item_key` for each entry within the source being fetched.

- If no existing item has the same `(source_id, item_key)`, create an `items` row.
- Set `first_seen_at`, `last_seen_at`, `first_seen_run_id`, `last_seen_run_id`, and `seen_count = 1`.
- The item is derived `new` relative to that source's latest successful run.
- For each subscribed user, the default user review state is implied `unreviewed` without inserting a row.

### Known

If the same `(source_id, item_key)` already exists:

- Keep the original `first_seen_at` and `first_seen_run_id`.
- Update `last_seen_at` and `last_seen_run_id`.
- Increment `seen_count`.
- Treat it as derived `known` relative to that source's latest successful run.
- Do not reset user review state or disposition.

### Reviewed

When the user reviews or dismisses an item:

- Create or update `user_item_states`.
- Set `reviewed_at`.
- Leave `disposition` as `null` unless the user also saves, archives, or hides.
- Remove it from the active inbox by default.

### Unreviewed

When the user marks an item unreviewed:

- If `disposition` is `null`, delete the `user_item_states` row.
- If a future UI allows unreviewing a saved, archived, or hidden item, clear or handle the disposition explicitly first.

### Saved

Next slice, not first slice.

- Set `disposition = saved`.
- Set `disposition_updated_at`.
- Ensure `reviewed_at` is set.
- Show it in Saved.
- Remove it from the active inbox unless the product later supports pinned inbox items.

### Archived

Next slice, not first slice.

- Set `disposition = archived`.
- Set `disposition_updated_at`.
- Ensure `reviewed_at` is set.
- Remove it from the active inbox.
- Keep it queryable in an archive/history view.

### Hidden

Next slice, not first slice.

- Set `disposition = hidden`.
- Set `disposition_updated_at`.
- Ensure `reviewed_at` is set.
- Suppress it from normal inbox, saved, and archive views unless the user explicitly opens hidden items.

### Inbox Recommendation

Known items should not stay in the main active inbox once they are no longer new to the current run unless they remain unreviewed for that user. The main inbox should optimize for "things I still need to triage."

Recommended views:

- Active Inbox: unreviewed items from active sources, with a visible `New` badge when derived new.
- Known / Previously Seen: collapsed or secondary view for unreviewed items that are known to the system.
- Saved: next slice.
- Archive: next slice.
- Hidden: not shown by default.

## Cross-Device Persistence

### Must Sync

- User identity.
- Seeded and user-added sources.
- Source subscriptions.
- Source status per user: active, paused, archived.
- User tags/display names on sources.
- Reviewed state.
- Item dispositions once save/archive/hide ship.
- Item state timestamps.

### Should Sync If Cheap

- Last selected inbox filters.
- Source ordering.
- Compact/comfortable density.
- Theme preference.

### Should Remain Local-Only

- Ephemeral UI state such as open panels, temporary sort direction, scroll position, and unsaved filter text.
- Per-device cache of rendered feeds or static report output.
- Debug logs unless explicitly uploaded.

## MVP v2 User Flows

### First Implementation Slice

The first slice should prove the smallest end-to-end backend loop:

- Authenticated user.
- Seeded RSS/Atom sources.
- User subscription rows for seeded sources.
- Ingestion into the database.
- Authenticated inbox of unreviewed items from active sources.
- Mark item reviewed.
- Mark item unreviewed.
- List user sources and their latest fetch status.

Do not include save, archive, hide, source adding, source editing, or custom source validation in the first backend slice unless the core loop is already stable.

### Sign In

- User signs in with email-based auth or OAuth.
- Signaldesk loads their active seeded sources and item states.
- Active inbox is immediately available across devices.

### Seed Sources

- Early v2 starts with a known set of seeded RSS/Atom sources.
- Each signed-in user can receive default `user_sources` rows for those sources.
- Custom source adding comes after the first slice.

### Fetch / Ingest Source Items

- System fetches active seeded RSS/Atom sources.
- Normalize entries.
- Compute exact source-scoped item keys.
- Insert new items or update known items using `(source_id, item_key)`.
- Record `ingestion_runs`.
- Preserve errors per source without failing the whole run.

### Review Item

- User marks an unreviewed item reviewed, or opening the item marks it reviewed if that behavior is enabled.
- Persist reviewed state in `user_item_states.reviewed_at`.
- Remove item from Active Inbox.

### Mark Item Unreviewed

- User marks a reviewed item unreviewed.
- Delete the `user_item_states` row when `disposition` is `null`.
- Item returns to Active Inbox if it belongs to an active user source.

### View Active Inbox

- Show items from active user sources where no reviewed state exists.
- Prioritize derived-new items.
- Provide basic filtering by source.
- Keep known/unreviewed items visible but secondary or collapsed.

### Manage Sources

- First slice: list user sources with status, last fetch result, last item date, and error state.
- Later slice: allow add, pause, resume, rename/display-name override, retag, and archive.
- Avoid hard delete in normal UI.

### Next Slice

After the first backend loop is stable:

- Add custom source flow.
- Add save item.
- Add archive item.
- Add hide item.
- Add Saved view.
- Add Archive view.

## Backend Recommendation

Use Supabase for early v2.

Why it fits:

- Signaldesk needs authenticated personal data, not complex enterprise infrastructure.
- Postgres maps cleanly to the entity model: sources, source-scoped items, ingestion runs, user subscriptions, and user item states.
- Supabase Auth handles multi-device identity quickly.
- Row Level Security can protect per-user state such as `user_sources` and `user_item_states`.
- Scheduled jobs or an external worker can run RSS ingestion while the app stays simple.
- Realtime is optional; the core product works with normal queries and refresh.

Supabase should handle:

- Authentication.
- Postgres persistence.
- Row-level access rules.
- Source subscriptions.
- User item states.
- Basic operational tables for ingestion runs.

Keep ingestion logic as a small server-side worker or scheduled function that mirrors the current Python prototype's behavior: fetch, normalize, exact source-scoped dedupe, record results.

Do not overbuild:

- No event bus needed.
- No vector database needed.
- No recommendation engine needed.
- No complex crawler layer needed.

## Explicit Out of Scope for Early v2

- Social media ingestion such as Instagram, TikTok, X, LinkedIn, or Threads.
- Browser automation scraping.
- Fuzzy duplicate detection.
- Fuzzy relevance scoring.
- Semantic freshness scoring.
- AI ranking or advanced recommendations.
- Team collaboration.
- Shared workspaces.
- Notifications beyond basic future hooks.
- Complex source discovery.
- Full-text search beyond basic Postgres search if it slows the core build.
- Notes, annotations, and highlights unless saved-item review becomes blocked without them.

## Implementation Direction

The next backend step is to define the first Supabase/Postgres schema for:

- `users`
- `sources`
- `user_sources`
- `items`
- `ingestion_runs`
- `user_item_states`

The first migration should preserve the prototype's proven behavior while narrowing the product surface:

- seeded RSS/Atom sources;
- stable source-scoped item keys;
- unique `(source_id, item_key)`;
- `first_seen_at`, `last_seen_at`, `first_seen_run_id`, `last_seen_run_id`, and `seen_count`;
- derived system `new`/`known` relative to latest successful source run;
- persisted per-user reviewed state only;
- authenticated inbox of unreviewed items;
- traceable source and ingestion history.

Save, archive, hide, custom source adding, and richer source management should wait until the first backend loop is working end to end.

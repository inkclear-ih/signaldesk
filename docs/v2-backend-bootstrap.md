# Signaldesk v2 Backend Bootstrap

This is the first real v2 implementation slice. It proves the backend/app architecture without building the full product.

## Included

- Minimal Next.js + TypeScript app.
- Supabase Auth sign in/sign out with email magic links.
- Supabase Postgres schema for `profiles`, `sources`, `user_sources`, `ingestion_runs`, `items`, and `user_item_states`.
- Source-scoped item uniqueness with `unique(source_id, item_key)`.
- `first_seen_run_id` and `last_seen_run_id` links from items to ingestion runs.
- Separate user review and disposition state:
  - missing `user_item_states` row: derived `unreviewed`
  - `review_state`: persisted only when `reviewed`
  - `disposition_state`: `none`, `saved`, `archived`, or `hidden`
- Seed script for `config/sources.yaml`.
- Minimal Supabase-backed RSS ingestion script.
- Authenticated inbox that lists subscribed-source items and marks items reviewed/unreviewed.
- Read-only list of the current user's sources.

## Not Included Yet

- Save/archive/hide UI.
- Source add/remove UI.
- Social ingestion.
- Browser automation.
- Fuzzy dedupe or scoring.
- Advanced search or filters.
- Team features.
- Dashboard polish.

## Environment

Copy `.env.example` to `.env.local` and fill in:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SIGNALDESK_BOOTSTRAP_USER_ID=
```

`SUPABASE_SERVICE_ROLE_KEY` is only for local admin scripts. Never expose it to browser code.

## Apply Schema

Apply `supabase/migrations/20260414130000_v2_bootstrap.sql` to your Supabase project.

With the Supabase CLI, that is typically:

```powershell
supabase db push
```

You can also paste the migration into the Supabase SQL editor for the first bootstrap pass.

## Seed Sources

Create or sign in as a user first, then copy that user's `auth.users.id` into `SIGNALDESK_BOOTSTRAP_USER_ID`.

The seed and ingest paths are Python scripts. In this repo, run them with a working Python interpreter that has the project dependencies installed. The checked-in `.venv` may be machine-specific; if it fails, recreate it first:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
```

Then seed sources with:

```powershell
.\.venv\Scripts\python.exe scripts\seed_supabase_sources.py --config config\sources.yaml
```

`npm run seed:sources` is only a convenience alias when `python` is already available on `PATH`.

This upserts canonical rows in `sources` from `config/sources.yaml`. When `SIGNALDESK_BOOTSTRAP_USER_ID` is set, it also creates matching `user_sources` rows.

## Run Ingestion

After sources are seeded:

```powershell
.\.venv\Scripts\python.exe scripts\ingest_supabase.py
```

`npm run ingest` is only a convenience alias when `python` is already available on `PATH`.

The script fetches active sources, records one `ingestion_runs` row per source, inserts new `items`, updates known `items`, and links `first_seen_run_id` / `last_seen_run_id`.

## Run The App

Install Node dependencies once:

```powershell
npm install
```

Then start the app:

```powershell
npm run dev
```

Open `http://localhost:3000`, sign in, and confirm:

- sources appear in the side list,
- ingested items appear in the inbox,
- system state shows `New` or `Known`,
- reviewed state persists through Supabase,
- marking an item unreviewed removes the user's item-state row and returns to the missing-row default.

# signaldesk

`signaldesk` is a small local research agent MVP. This first slice loads a YAML source list, fetches enabled RSS feeds, normalizes entries, and writes one JSON file with per-source stats.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
```

## Run

```powershell
python -m signaldesk.cli fetch --config config/sources.yaml --out runs/latest/raw_items.json --limit-per-source 5
python -m signaldesk.cli digest --input runs/latest/raw_items.json --out runs/latest/digest.md --days 7 --max-items 25
```

You can also use the installed console script:

```powershell
signaldesk fetch --config config/sources.yaml --out runs/latest/raw_items.json --limit-per-source 5
signaldesk digest --input runs/latest/raw_items.json --out runs/latest/digest.md --days 7 --max-items 25
```

The output JSON contains:

- `run_started_at`
- `run_finished_at`
- `source_stats`
- `items`

The command continues when an individual source fails and prints a readable error for that source. It exits non-zero only when every enabled source fails.

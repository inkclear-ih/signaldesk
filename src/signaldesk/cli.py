from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from signaldesk.config import SourceConfigError, load_sources
from signaldesk.rss import run_fetch
from signaldesk.time import utc_now_iso


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="signaldesk",
        description="Small local research agent utilities.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch_parser = subparsers.add_parser(
        "fetch",
        help="Fetch enabled RSS sources and write normalized JSON items.",
    )
    fetch_parser.add_argument(
        "--config",
        required=True,
        type=Path,
        help="Path to YAML source config.",
    )
    fetch_parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Path to write JSON output.",
    )
    fetch_parser.add_argument(
        "--limit-per-source",
        type=int,
        default=5,
        help="Maximum entries to keep from each source.",
    )
    fetch_parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="HTTP timeout in seconds.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "fetch":
        return fetch_command(args)

    parser.error(f"unknown command: {args.command}")
    return 2


def fetch_command(args: argparse.Namespace) -> int:
    if args.limit_per_source < 1:
        print("--limit-per-source must be at least 1", file=sys.stderr)
        return 2

    run_started_at = utc_now_iso()

    try:
        sources = load_sources(args.config)
    except SourceConfigError as exc:
        print(f"Config error: {exc}", file=sys.stderr)
        return 2

    enabled_sources = [source for source in sources if source.enabled]
    if not enabled_sources:
        print("No enabled sources found.", file=sys.stderr)
        return 2

    result = run_fetch(
        enabled_sources,
        limit_per_source=args.limit_per_source,
        timeout=args.timeout,
    )
    run_finished_at = utc_now_iso()

    payload = {
        "run_started_at": run_started_at,
        "run_finished_at": run_finished_at,
        "source_stats": [stat.as_dict() for stat in result.source_stats],
        "items": result.items,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    for stat in result.source_stats:
        if stat.status == "error":
            print(f"Source error [{stat.source_id}]: {stat.error}", file=sys.stderr)

    error_count = len(enabled_sources) - result.ok_count
    print(
        "Fetch summary: "
        f"enabled_sources={len(enabled_sources)} "
        f"ok_sources={result.ok_count} "
        f"error_sources={error_count} "
        f"item_count={len(result.items)} "
        f"output={args.out}"
    )

    if result.ok_count == 0:
        print("Every enabled source failed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

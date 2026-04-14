from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signaldesk.config import load_sources
from signaldesk.supabase_api import SupabaseApi


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed v2 Supabase sources from config/sources.yaml."
    )
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "sources.yaml")
    parser.add_argument(
        "--user-id",
        default=os.environ.get("SIGNALDESK_BOOTSTRAP_USER_ID"),
        help="Optional auth.users id to subscribe to the seeded sources.",
    )
    args = parser.parse_args()

    sources = load_sources(args.config)
    client = SupabaseApi.from_env()

    source_rows: list[dict[str, Any]] = [
        {
            "type": source.type,
            "name": source.name,
            "url": source.url,
            "feed_url": source.url,
            "status": "active" if source.enabled else "paused",
            "last_error": None,
        }
        for source in sources
    ]
    seeded_sources = client.upsert(
        "sources",
        source_rows,
        on_conflict="feed_url",
    )

    if args.user_id:
        source_by_url = {source["feed_url"]: source for source in seeded_sources}
        config_by_url = {source.url: source for source in sources}
        user_source_rows = []
        for feed_url, seeded_source in source_by_url.items():
            config_source = config_by_url[feed_url]
            user_source_rows.append(
                {
                    "user_id": args.user_id,
                    "source_id": seeded_source["id"],
                    "status": "active" if config_source.enabled else "paused",
                    "display_name": config_source.name,
                    "tags": config_source.tags,
                }
            )
        client.upsert(
            "user_sources",
            user_source_rows,
            on_conflict="user_id,source_id",
        )

    print(f"Seeded {len(seeded_sources)} sources.")
    if args.user_id:
        print(f"Subscribed user {args.user_id} to {len(seeded_sources)} sources.")
    else:
        print("No user_sources created; pass --user-id or SIGNALDESK_BOOTSTRAP_USER_ID.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

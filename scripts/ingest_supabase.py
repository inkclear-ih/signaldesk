from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import feedparser
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signaldesk.state import compute_item_key
from signaldesk.supabase_api import SupabaseApi, SupabaseApiError

USER_AGENT = "signaldesk/0.2 (+v2 supabase bootstrap)"


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest active v2 sources into Supabase.")
    parser.add_argument("--limit-per-source", type=int, default=25)
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args()

    client = SupabaseApi.from_env()
    sources = client.select(
        "sources",
        {
            "select": "id,type,name,feed_url,url,status",
            "status": "eq.active",
            "order": "name.asc",
        },
    )

    if not sources:
        print("No active sources found. Run the seed script first.")
        return 0

    ok_count = 0
    for source in sources:
        try:
            result = ingest_source(
                client,
                source,
                limit_per_source=args.limit_per_source,
                timeout=args.timeout,
            )
        except Exception as exc:
            print(f"{source.get('name', source['id'])}: error: {exc}", file=sys.stderr)
            continue

        ok_count += 1
        print(
            f"{source['name']}: fetched={result['fetched_count']} "
            f"new={result['new_count']} known={result['known_count']}"
        )

    return 0 if ok_count else 1


def ingest_source(
    client: SupabaseApi,
    source: dict[str, Any],
    *,
    limit_per_source: int,
    timeout: float,
) -> dict[str, int]:
    started_at = utc_now()
    run = client.insert(
        "ingestion_runs",
        {
            "source_id": source["id"],
            "started_at": started_at,
            "status": "partial",
        },
    )

    try:
        response = requests.get(
            source["feed_url"],
            headers={"User-Agent": USER_AGENT},
            timeout=timeout,
        )
        response.raise_for_status()
        parsed = feedparser.parse(response.content)
        if not parsed.entries and parsed.bozo and parsed.get("bozo_exception"):
            raise ValueError(f"feed parse error: {parsed.bozo_exception}")

        fetched_count = 0
        new_count = 0
        known_count = 0
        seen_keys: set[str] = set()

        for entry in parsed.entries[:limit_per_source]:
            fetched_count += 1
            normalized = normalize_entry(source, entry)
            item_key = compute_item_key(normalized)
            if item_key in seen_keys:
                continue
            seen_keys.add(item_key)

            existing = client.select(
                "items",
                {
                    "select": "id,seen_count",
                    "source_id": f"eq.{source['id']}",
                    "item_key": f"eq.{item_key}",
                    "limit": "1",
                },
            )

            seen_at = utc_now()
            if existing:
                update_existing_item(
                    client,
                    item_id=existing[0]["id"],
                    seen_count=int(existing[0]["seen_count"]) + 1,
                    run_id=run["id"],
                    seen_at=seen_at,
                    normalized=normalized,
                )
                known_count += 1
            else:
                insert_new_item(
                    client,
                    source_id=source["id"],
                    item_key=item_key,
                    run_id=run["id"],
                    seen_at=seen_at,
                    normalized=normalized,
                )
                new_count += 1

        finished_at = utc_now()
        client.update(
            "ingestion_runs",
            filters={"id": f"eq.{run['id']}"},
            values={
                "finished_at": finished_at,
                "status": "ok",
                "fetched_count": fetched_count,
                "new_count": new_count,
                "known_count": known_count,
            },
        )
        client.update(
            "sources",
            filters={"id": f"eq.{source['id']}"},
            values={
                "last_fetched_at": finished_at,
                "last_error": None,
            },
        )
        return {
            "fetched_count": fetched_count,
            "new_count": new_count,
            "known_count": known_count,
        }
    except Exception as exc:
        http_status = None
        if isinstance(exc, requests.HTTPError) and exc.response is not None:
            http_status = exc.response.status_code
        finish_failed_run(
            client,
            source_id=source["id"],
            run_id=run["id"],
            exc=exc,
            http_status=http_status,
        )
        raise


def insert_new_item(
    client: SupabaseApi,
    *,
    source_id: str,
    item_key: str,
    run_id: str,
    seen_at: str,
    normalized: dict[str, Any],
) -> None:
    client.insert(
        "items",
        {
            "source_id": source_id,
            "item_key": item_key,
            "title": normalized.get("title"),
            "link": normalized.get("link"),
            "summary": normalized.get("summary"),
            "author": normalized.get("author"),
            "published_at": normalized.get("published_at"),
            "first_seen_at": seen_at,
            "last_seen_at": seen_at,
            "seen_count": 1,
            "first_seen_run_id": run_id,
            "last_seen_run_id": run_id,
            "raw_guid": normalized.get("raw_guid"),
            "raw_payload": normalized.get("raw_payload"),
        },
    )


def update_existing_item(
    client: SupabaseApi,
    *,
    item_id: str,
    seen_count: int,
    run_id: str,
    seen_at: str,
    normalized: dict[str, Any],
) -> None:
    client.update(
        "items",
        filters={"id": f"eq.{item_id}"},
        values={
            "title": normalized.get("title"),
            "link": normalized.get("link"),
            "summary": normalized.get("summary"),
            "author": normalized.get("author"),
            "published_at": normalized.get("published_at"),
            "last_seen_at": seen_at,
            "seen_count": seen_count,
            "last_seen_run_id": run_id,
            "raw_guid": normalized.get("raw_guid"),
            "raw_payload": normalized.get("raw_payload"),
        },
    )


def finish_failed_run(
    client: SupabaseApi,
    *,
    source_id: str,
    run_id: str,
    exc: Exception,
    http_status: int | None,
) -> None:
    finished_at = utc_now()
    try:
        client.update(
            "ingestion_runs",
            filters={"id": f"eq.{run_id}"},
            values={
                "finished_at": finished_at,
                "status": "error",
                "error_message": str(exc),
                "http_status": http_status,
            },
        )
        client.update(
            "sources",
            filters={"id": f"eq.{source_id}"},
            values={
                "last_fetched_at": finished_at,
                "last_error": str(exc),
            },
        )
    except SupabaseApiError as update_exc:
        print(f"Failed to record ingestion error: {update_exc}", file=sys.stderr)


def normalize_entry(source: dict[str, Any], entry: Any) -> dict[str, Any]:
    raw_guid = text_or_none(entry.get("id") or entry.get("guid"))
    title = text_or_none(entry.get("title"))
    link = text_or_none(entry.get("link") or raw_guid)
    summary = text_or_none(entry.get("summary"))
    author = text_or_none(entry.get("author"))
    published_at = entry_published_at(entry)

    return {
        "source_id": source["id"],
        "source_name": source["name"],
        "source_url": source["feed_url"],
        "title": title,
        "link": link,
        "summary": summary,
        "author": author,
        "published_at": published_at,
        "raw_guid": raw_guid,
        "raw_payload": {
            "id": raw_guid,
            "title": title,
            "link": link,
            "summary": summary,
            "author": author,
            "published": text_or_none(entry.get("published")),
            "updated": text_or_none(entry.get("updated")),
        },
    }


def entry_published_at(entry: Any) -> str | None:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        value = entry.get(key)
        if value:
            return datetime(*value[:6], tzinfo=UTC).isoformat()

    for key in ("published", "updated", "created"):
        value = entry.get(key)
        if value:
            parsed = parse_date_string(str(value))
            if parsed:
                return parsed

    return None


def parse_date_string(value: str) -> str | None:
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC).isoformat()
    return parsed.astimezone(UTC).isoformat()


def text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())

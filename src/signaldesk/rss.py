from __future__ import annotations

from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from datetime import UTC
from typing import Any

import feedparser
import requests

from signaldesk.config import Source
from signaldesk.time import struct_time_to_iso, utc_now_iso

USER_AGENT = "signaldesk/0.1 (+local research agent)"


@dataclass(frozen=True)
class SourceStat:
    source_id: str
    source_name: str
    status: str
    fetched_count: int
    error: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_name": self.source_name,
            "status": self.status,
            "fetched_count": self.fetched_count,
            "error": self.error,
        }


@dataclass(frozen=True)
class FetchResult:
    source_stats: list[SourceStat]
    items: list[dict[str, Any]]

    @property
    def ok_count(self) -> int:
        return sum(1 for stat in self.source_stats if stat.status == "ok")


def run_fetch(
    sources: list[Source],
    *,
    limit_per_source: int,
    timeout: float,
) -> FetchResult:
    source_stats: list[SourceStat] = []
    items: list[dict[str, Any]] = []

    for source in sources:
        fetched_at = utc_now_iso()
        try:
            source_items = fetch_source(
                source,
                limit=limit_per_source,
                timeout=timeout,
                fetched_at=fetched_at,
            )
        except Exception as exc:
            source_stats.append(
                SourceStat(
                    source_id=source.id,
                    source_name=source.name,
                    status="error",
                    fetched_count=0,
                    error=str(exc),
                )
            )
            continue

        items.extend(source_items)
        source_stats.append(
            SourceStat(
                source_id=source.id,
                source_name=source.name,
                status="ok",
                fetched_count=len(source_items),
                error=None,
            )
        )

    return FetchResult(source_stats=source_stats, items=items)


def fetch_source(
    source: Source,
    *,
    limit: int,
    timeout: float,
    fetched_at: str,
) -> list[dict[str, Any]]:
    response = requests.get(
        source.url,
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
    )
    response.raise_for_status()

    parsed = feedparser.parse(response.content)
    entries = parsed.entries[:limit]
    if not entries and parsed.bozo and parsed.get("bozo_exception"):
        raise ValueError(f"feed parse error: {parsed.bozo_exception}")

    return [normalize_entry(source, entry, fetched_at=fetched_at) for entry in entries]


def normalize_entry(source: Source, entry: Any, *, fetched_at: str) -> dict[str, Any]:
    return {
        "source_id": source.id,
        "source_name": source.name,
        "source_url": source.url,
        "title": _entry_text(entry, "title"),
        "link": _entry_link(entry),
        "published_at": _entry_published_at(entry),
        "summary": _entry_text(entry, "summary"),
        "tags": source.tags,
        "fetched_at": fetched_at,
    }


def _entry_text(entry: Any, field: str) -> str | None:
    value = entry.get(field)
    if value is None:
        return None
    return str(value).strip() or None


def _entry_link(entry: Any) -> str | None:
    link = entry.get("link") or entry.get("id") or entry.get("guid")
    if link is None:
        return None
    return str(link).strip() or None


def _entry_published_at(entry: Any) -> str | None:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        value = entry.get(key)
        if value:
            return struct_time_to_iso(value)

    for key in ("published", "updated", "created"):
        value = entry.get(key)
        if value:
            parsed = _parse_date_string(str(value))
            if parsed:
                return parsed

    return None


def _parse_date_string(value: str) -> str | None:
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None

    if parsed.tzinfo is None:
        return parsed.isoformat()
    return parsed.astimezone(UTC).isoformat()

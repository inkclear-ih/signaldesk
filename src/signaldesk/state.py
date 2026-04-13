from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit


WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class SeenItem:
    item_key: str
    is_new: bool
    first_seen_at: str
    last_seen_at: str
    seen_count: int


class ItemState:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(path)
        self._connection.row_factory = sqlite3.Row
        self._setup()

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> ItemState:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()

    def mark_seen(self, item: dict[str, Any], *, seen_at: str) -> SeenItem:
        item_key = compute_item_key(item)
        existing = self._connection.execute(
            "SELECT first_seen_at, seen_count FROM seen_items WHERE item_key = ?",
            (item_key,),
        ).fetchone()

        source_id = _text_or_none(item.get("source_id"))
        title = _text_or_none(item.get("title"))
        link = _text_or_none(item.get("link"))

        if existing is None:
            seen_count = 1
            self._connection.execute(
                """
                INSERT INTO seen_items (
                    item_key, first_seen_at, last_seen_at, seen_count,
                    source_id, title, link
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (item_key, seen_at, seen_at, seen_count, source_id, title, link),
            )
            self._connection.commit()
            return SeenItem(
                item_key=item_key,
                is_new=True,
                first_seen_at=seen_at,
                last_seen_at=seen_at,
                seen_count=seen_count,
            )

        first_seen_at = str(existing["first_seen_at"])
        seen_count = int(existing["seen_count"]) + 1
        self._connection.execute(
            """
            UPDATE seen_items
            SET last_seen_at = ?,
                seen_count = ?,
                source_id = ?,
                title = ?,
                link = ?
            WHERE item_key = ?
            """,
            (seen_at, seen_count, source_id, title, link, item_key),
        )
        self._connection.commit()
        return SeenItem(
            item_key=item_key,
            is_new=False,
            first_seen_at=first_seen_at,
            last_seen_at=seen_at,
            seen_count=seen_count,
        )

    def _setup(self) -> None:
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS seen_items (
                item_key TEXT PRIMARY KEY,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                seen_count INTEGER NOT NULL,
                source_id TEXT,
                title TEXT,
                link TEXT
            )
            """
        )
        self._connection.commit()


def compute_item_key(item: dict[str, Any]) -> str:
    link = _normalize_link(item.get("link"))
    if link:
        return f"link:{link}"

    source_id = _normalize_title(item.get("source_id")) or "unknown-source"
    title = _normalize_title(item.get("title")) or "untitled"
    return f"title:{source_id}:{title}"


def _normalize_link(value: Any) -> str | None:
    text = _text_or_none(value)
    if text is None:
        return None

    parts = urlsplit(text)
    if not parts.scheme and not parts.netloc:
        return text

    scheme = parts.scheme.lower()
    netloc = parts.netloc.lower()
    return urlunsplit((scheme, netloc, parts.path, parts.query, ""))


def _normalize_title(value: Any) -> str | None:
    text = _text_or_none(value)
    if text is None:
        return None
    return WHITESPACE_RE.sub(" ", text).casefold()


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

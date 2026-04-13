from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from signaldesk.time import utc_now_iso

SUMMARY_MAX_CHARS = 500
MOJIBAKE_MARKERS = ("\u00c2", "\u00c3", "\u00e2", "\u00c4", "\u00c5", "\ufffd")
MIN_MOJIBAKE_IMPROVEMENT = 2

LATIN1_UTF8_SEQUENCE_RE = re.compile(
    r"[\u00c2-\u00df][\u0080-\u00bf]|[\u00e0-\u00ef][\u0080-\u00bf]{2}"
)
RESIDUAL_MOJIBAKE_REPLACEMENTS = {
    "\u00e2\u20ac\u02dc": "\u2018",
    "\u00e2\u20ac\u2122": "\u2019",
    "\u00e2\u20ac\u0153": "\u201c",
    "\u00e2\u20ac\u009d": "\u201d",
    "\u00e2\u20ac\u00a6": "\u2026",
    "\u00e2\u20ac\u201c": "\u2013",
    "\u00e2\u20ac\u201d": "\u2014",
    "\u00e2\u20ac\u00a2": "\u2022",
    "\u00e2\u20ac\u2018": "\u2011",
    "K\u00c4k\u00c4p\u00c5 parrots": "K\u0101k\u0101p\u014d parrots",
    "k\u00c4k\u00c4p\u00c5 parrots": "k\u0101k\u0101p\u014d parrots",
}


@dataclass(frozen=True)
class DigestItem:
    item: dict[str, Any]
    published_at: datetime | None


def write_digest(
    *,
    input_path: Path,
    output_path: Path,
    days: int | None,
    max_items: int,
) -> int:
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    generated_at = utc_now_iso()
    generated_dt = _parse_datetime(generated_at)
    if generated_dt is None:
        generated_dt = datetime.now(UTC)

    selected_items = select_items(
        payload.get("items", []),
        days=days,
        max_items=max_items,
        now=generated_dt,
    )
    markdown = render_digest(
        generated_at=generated_at,
        input_path=input_path,
        source_stats=payload.get("source_stats", []),
        selected_items=selected_items,
        days=days,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown, encoding="utf-8")
    return len(selected_items)


def select_items(
    items: list[dict[str, Any]],
    *,
    days: int | None,
    max_items: int,
    now: datetime,
) -> list[DigestItem]:
    cutoff = now - timedelta(days=days) if days is not None else None
    dated_items: list[DigestItem] = []
    undated_items: list[DigestItem] = []

    for item in items:
        published_at = _parse_datetime(item.get("published_at"))
        if published_at is None:
            undated_items.append(DigestItem(item=item, published_at=None))
            continue

        if cutoff is not None and published_at < cutoff:
            continue

        dated_items.append(DigestItem(item=item, published_at=published_at))

    dated_items.sort(
        key=lambda digest_item: digest_item.published_at or datetime.min,
        reverse=True,
    )
    return (dated_items + undated_items)[:max_items]


def render_digest(
    *,
    generated_at: str,
    input_path: Path,
    source_stats: list[dict[str, Any]],
    selected_items: list[DigestItem],
    days: int | None,
) -> str:
    lines = [
        "# Signaldesk Digest",
        "",
        f"Generated: {generated_at}",
        f"Input: {input_path}",
        f"Items included: {len(selected_items)}",
    ]
    if days is not None:
        lines.append(f"Window: last {days} days, plus undated items")

    lines.extend(["", "## Sources", ""])
    if source_stats:
        lines.extend(
            [
                "| Source | Status | Items | Error |",
                "| --- | --- | ---: | --- |",
            ]
        )
        for stat in source_stats:
            lines.append(
                "| "
                f"{_table_cell(stat.get('source_name') or stat.get('source_id') or 'Unknown')} | "
                f"{_table_cell(stat.get('status') or 'unknown')} | "
                f"{stat.get('fetched_count', 0)} | "
                f"{_table_cell(stat.get('error') or '')} |"
            )
    else:
        lines.append("- No source stats found.")

    lines.extend(["", "## Items", ""])
    if not selected_items:
        lines.append("No recent items matched this digest window.")
    else:
        for digest_item in selected_items:
            lines.extend(_render_item(digest_item))
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _render_item(digest_item: DigestItem) -> list[str]:
    item = digest_item.item
    title = _clean_text(item.get("title")) or "Untitled"
    link = _clean_text(item.get("link"))
    source_name = _clean_text(item.get("source_name")) or "Unknown source"
    tags = item.get("tags") or []
    summary = _trim_summary(_clean_text(item.get("summary")))

    title_text = f"[{_link_text(title)}]({link})" if link else _markdown_text(title)
    metadata = [source_name]
    if digest_item.published_at is not None:
        metadata.append(digest_item.published_at.date().isoformat())
    tag_text = ", ".join(str(tag) for tag in tags) if tags else "none"
    metadata.append(f"tags: {tag_text}")

    lines = [f"- {title_text}", f"  Source: {' | '.join(metadata)}"]
    if summary:
        lines.append(f"  Summary: {summary}")
    return lines


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _trim_summary(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= SUMMARY_MAX_CHARS:
        return value
    trimmed = value[: SUMMARY_MAX_CHARS - 3].rstrip()
    if " " in trimmed:
        trimmed = trimmed.rsplit(" ", 1)[0].rstrip()
    return trimmed + "..."


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = html.unescape(str(value))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = _repair_mojibake(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def _repair_mojibake(text: str) -> str:
    if not text or not any(marker in text for marker in MOJIBAKE_MARKERS):
        return text

    original_score = _mojibake_score(text)
    best = _best_mojibake_candidate(text, original=text)
    improvement = original_score - _mojibake_score(best)
    if best != text and improvement >= MIN_MOJIBAKE_IMPROVEMENT:
        best = _best_mojibake_candidate(best, original=text)
    if best == text:
        return text
    if _replacement_artifact_count(best) > _replacement_artifact_count(text):
        return text
    if original_score - _mojibake_score(best) < MIN_MOJIBAKE_IMPROVEMENT:
        return text
    return best


def _best_mojibake_candidate(text: str, *, original: str) -> str:
    best = text
    for candidate in _mojibake_candidates(text):
        if _is_better_mojibake_candidate(candidate, best, original=original):
            best = candidate
    return best


def _mojibake_candidates(text: str) -> list[str]:
    candidates = [text]

    for encoding in ("cp1252", "latin-1"):
        try:
            candidates.append(text.encode(encoding).decode("utf-8"))
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue

    candidates.append(_repair_latin1_utf8_sequences(text))
    candidates.append(_apply_residual_mojibake_replacements(text))

    for candidate in list(candidates):
        candidates.append(_apply_residual_mojibake_replacements(candidate))
        candidates.append(_repair_latin1_utf8_sequences(candidate))

    return list(dict.fromkeys(candidates))


def _is_better_mojibake_candidate(candidate: str, best: str, *, original: str) -> bool:
    if _replacement_artifact_count(candidate) > _replacement_artifact_count(original):
        return False
    return _mojibake_score(candidate) + MIN_MOJIBAKE_IMPROVEMENT <= _mojibake_score(best)


def _replacement_artifact_count(text: str) -> int:
    return text.count("\ufffd")


def _repair_latin1_utf8_sequences(text: str) -> str:
    def replace_match(match: re.Match[str]) -> str:
        raw_bytes = bytes(ord(char) for char in match.group(0))
        try:
            return raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return match.group(0)

    return LATIN1_UTF8_SEQUENCE_RE.sub(replace_match, text)


def _apply_residual_mojibake_replacements(text: str) -> str:
    repaired = text
    for broken, replacement in RESIDUAL_MOJIBAKE_REPLACEMENTS.items():
        repaired = repaired.replace(broken, replacement)
    return repaired


def _mojibake_score(text: str) -> int:
    score = 0
    score += text.count("\ufffd") * 3
    score += len(re.findall(r"[\u0080-\u009f]", text)) * 3
    score += len(re.findall(r"[\u00c2\u00c3\u00e2\u00c4\u00c5][\u0080-\uffff]?", text)) * 2
    score += len(re.findall(r"\u00e2[\u0080-\uffff]{1,2}", text)) * 3
    return score


def _markdown_text(value: str) -> str:
    return value.replace("[", "\\[").replace("]", "\\]")


def _link_text(value: str) -> str:
    return _markdown_text(value).replace("|", "\\|")


def _table_cell(value: Any) -> str:
    text = _clean_text(value) or ""
    return text.replace("|", "\\|")

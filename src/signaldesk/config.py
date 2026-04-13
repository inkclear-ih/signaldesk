from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


class SourceConfigError(ValueError):
    """Raised when the source configuration cannot be loaded."""


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    type: str
    url: str
    enabled: bool
    tags: list[str]


def load_sources(path: Path) -> list[Source]:
    if not path.exists():
        raise SourceConfigError(f"config file does not exist: {path}")

    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise SourceConfigError(f"invalid YAML in {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise SourceConfigError("config root must be a mapping")

    raw_sources = raw.get("sources")
    if not isinstance(raw_sources, list):
        raise SourceConfigError("config must contain a 'sources' list")

    sources: list[Source] = []
    seen_ids: set[str] = set()
    for index, raw_source in enumerate(raw_sources, start=1):
        source = _parse_source(raw_source, index)
        if source.id in seen_ids:
            raise SourceConfigError(f"duplicate source id: {source.id}")
        seen_ids.add(source.id)
        sources.append(source)

    return sources


def _parse_source(raw_source: Any, index: int) -> Source:
    if not isinstance(raw_source, dict):
        raise SourceConfigError(f"source #{index} must be a mapping")

    source_id = _required_str(raw_source, "id", index)
    source_name = _required_str(raw_source, "name", index)
    source_type = _required_str(raw_source, "type", index)
    source_url = _required_str(raw_source, "url", index)

    if source_type != "rss":
        raise SourceConfigError(f"source '{source_id}' has unsupported type '{source_type}'")

    enabled = raw_source.get("enabled")
    if not isinstance(enabled, bool):
        raise SourceConfigError(f"source '{source_id}' field 'enabled' must be a boolean")

    tags = raw_source.get("tags")
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        raise SourceConfigError(f"source '{source_id}' field 'tags' must be a list of strings")

    return Source(
        id=source_id,
        name=source_name,
        type=source_type,
        url=source_url,
        enabled=enabled,
        tags=tags,
    )


def _required_str(raw_source: dict[str, Any], key: str, index: int) -> str:
    value = raw_source.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SourceConfigError(f"source #{index} field '{key}' must be a non-empty string")
    return value.strip()

from __future__ import annotations

import calendar
import time
from datetime import UTC, datetime


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def struct_time_to_iso(value: time.struct_time) -> str:
    timestamp = calendar.timegm(value)
    return datetime.fromtimestamp(timestamp, UTC).isoformat()

from __future__ import annotations

import os
from typing import Any

import requests


class SupabaseApiError(RuntimeError):
    """Raised when a Supabase REST request fails."""


class SupabaseApi:
    def __init__(self, *, url: str, service_role_key: str) -> None:
        self._rest_url = f"{url.rstrip('/')}/rest/v1"
        self._headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

    @classmethod
    def from_env(cls) -> SupabaseApi:
        url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not service_role_key:
            raise SupabaseApiError(
                "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first."
            )
        return cls(url=url, service_role_key=service_role_key)

    def select(self, table: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
        return self._request("GET", table, params=params)

    def insert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        rows = self._request(
            "POST",
            table,
            json=row,
            prefer="return=representation",
        )
        if not rows:
            raise SupabaseApiError(f"Insert into {table} returned no rows.")
        return rows[0]

    def upsert(
        self,
        table: str,
        rows: list[dict[str, Any]],
        *,
        on_conflict: str,
    ) -> list[dict[str, Any]]:
        if not rows:
            return []
        return self._request(
            "POST",
            table,
            params={"on_conflict": on_conflict},
            json=rows,
            prefer="resolution=merge-duplicates,return=representation",
        )

    def update(
        self,
        table: str,
        *,
        filters: dict[str, str],
        values: dict[str, Any],
    ) -> list[dict[str, Any]]:
        return self._request(
            "PATCH",
            table,
            params=filters,
            json=values,
            prefer="return=representation",
        )

    def _request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        json: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer

        response = requests.request(
            method,
            f"{self._rest_url}/{table}",
            headers=headers,
            params=params,
            json=json,
            timeout=30,
        )
        if response.status_code >= 400:
            raise SupabaseApiError(
                f"{method} {table} failed with {response.status_code}: {response.text}"
            )
        if not response.content:
            return []
        return response.json()

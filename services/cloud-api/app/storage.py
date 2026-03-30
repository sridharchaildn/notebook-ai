from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx

from .config import Settings
from .models import LegalAcceptanceRecord, ProviderStatus, StoragePreference


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _parse_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed
    except ValueError:
        return None


@dataclass
class CredentialRecord:
    user_id: str
    provider: str
    encrypted_value: str
    connection_type: str
    updated_at: str


class CloudStore:
    async def upsert_credential(
        self,
        user_id: str,
        provider: str,
        encrypted_value: str,
        connection_type: str,
    ) -> None:
        raise NotImplementedError

    async def delete_credential(self, user_id: str, provider: str) -> None:
        raise NotImplementedError

    async def list_statuses(self, user_id: str) -> list[ProviderStatus]:
        raise NotImplementedError

    async def get_credential(self, user_id: str, provider: str) -> CredentialRecord | None:
        raise NotImplementedError

    async def save_oauth_state(self, state: str, user_id: str) -> None:
        raise NotImplementedError

    async def consume_oauth_state(self, state: str) -> str | None:
        raise NotImplementedError

    async def upsert_storage_preference(
        self,
        user_id: str,
        mode: str,
        local_root: str | None,
    ) -> StoragePreference:
        raise NotImplementedError

    async def get_storage_preference(self, user_id: str) -> StoragePreference:
        raise NotImplementedError

    async def save_legal_acceptances(
        self,
        user_id: str,
        acceptances: list[tuple[str, str]],
    ) -> list[LegalAcceptanceRecord]:
        raise NotImplementedError

    async def list_legal_acceptances(self, user_id: str) -> list[LegalAcceptanceRecord]:
        raise NotImplementedError


class SupabaseStore(CloudStore):
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        if not settings.supabase_server_key:
            raise RuntimeError("Supabase secret key is required for cloud storage")
        self.settings = settings
        self.transport = transport
        self.rest_url = f"{settings.supabase_url.rstrip('/')}/rest/v1"

    def _headers(self, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.settings.supabase_server_key,
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def _request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        json_body: object | None = None,
        prefer: str | None = None,
    ) -> httpx.Response:
        async with httpx.AsyncClient(timeout=10.0, transport=self.transport) as client:
            response = await client.request(
                method,
                f"{self.rest_url}/{table}",
                params=params,
                json=json_body,
                headers=self._headers(prefer),
            )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise RuntimeError(
                    "Supabase REST rejected NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY. "
                    "Create or copy a valid server-side secret key from Supabase Settings -> API Keys, "
                    "update services/cloud-api/.env, then restart services/cloud-api."
                ) from exc
            raise
        return response

    async def _select_rows(self, table: str, *, params: dict[str, str]) -> list[dict]:
        response = await self._request("GET", table, params=params)
        payload = response.json()
        if not isinstance(payload, list):
            return []
        return [row for row in payload if isinstance(row, dict)]

    async def upsert_credential(
        self,
        user_id: str,
        provider: str,
        encrypted_value: str,
        connection_type: str,
    ) -> None:
        now = _utcnow().isoformat()
        await self._request(
            "POST",
            "provider_credentials",
            json_body={
                "user_id": user_id,
                "provider": provider,
                "encrypted_value": encrypted_value,
                "connection_type": connection_type,
                "created_at": now,
                "updated_at": now,
            },
            prefer="resolution=merge-duplicates,return=representation",
        )

    async def delete_credential(self, user_id: str, provider: str) -> None:
        await self._request(
            "DELETE",
            "provider_credentials",
            params={"user_id": f"eq.{user_id}", "provider": f"eq.{provider}"},
        )

    async def list_statuses(self, user_id: str) -> list[ProviderStatus]:
        rows = await self._select_rows(
            "provider_credentials",
            params={
                "user_id": f"eq.{user_id}",
                "select": "provider,connection_type,updated_at",
            },
        )
        provider_rows = {str(row["provider"]): row for row in rows if row.get("provider")}
        statuses: list[ProviderStatus] = []
        for provider in ("openai", "openrouter"):
            row = provider_rows.get(provider)
            if not row:
                statuses.append(
                    ProviderStatus(provider=provider, connected=False, via="none", last_updated_at=None)
                )
                continue

            connection_type = str(row.get("connection_type") or "none")
            statuses.append(
                ProviderStatus(
                    provider=provider,
                    connected=True,
                    via=connection_type if connection_type in {"oauth", "api_key"} else "none",
                    last_updated_at=_parse_datetime(str(row.get("updated_at") or "")),
                )
            )
        return statuses

    async def get_credential(self, user_id: str, provider: str) -> CredentialRecord | None:
        rows = await self._select_rows(
            "provider_credentials",
            params={
                "user_id": f"eq.{user_id}",
                "provider": f"eq.{provider}",
                "select": "user_id,provider,encrypted_value,connection_type,updated_at",
                "limit": "1",
            },
        )
        if not rows:
            return None
        row = rows[0]
        return CredentialRecord(
            user_id=str(row["user_id"]),
            provider=str(row["provider"]),
            encrypted_value=str(row["encrypted_value"]),
            connection_type=str(row["connection_type"]),
            updated_at=str(row["updated_at"]),
        )

    async def save_oauth_state(self, state: str, user_id: str) -> None:
        await self._request(
            "POST",
            "oauth_states",
            json_body={
                "state": state,
                "user_id": user_id,
                "created_at": _utcnow().isoformat(),
            },
            prefer="resolution=merge-duplicates,return=representation",
        )

    async def consume_oauth_state(self, state: str) -> str | None:
        rows = await self._select_rows(
            "oauth_states",
            params={"state": f"eq.{state}", "select": "state,user_id", "limit": "1"},
        )
        if not rows:
            return None
        await self._request("DELETE", "oauth_states", params={"state": f"eq.{state}"})
        return str(rows[0]["user_id"])

    async def upsert_storage_preference(
        self,
        user_id: str,
        mode: str,
        local_root: str | None,
    ) -> StoragePreference:
        now = _utcnow().isoformat()
        await self._request(
            "POST",
            "user_storage_preferences",
            json_body={
                "user_id": user_id,
                "mode": mode,
                "local_root": local_root,
                "updated_at": now,
            },
            prefer="resolution=merge-duplicates,return=representation",
        )
        return await self.get_storage_preference(user_id)

    async def get_storage_preference(self, user_id: str) -> StoragePreference:
        rows = await self._select_rows(
            "user_storage_preferences",
            params={
                "user_id": f"eq.{user_id}",
                "select": "mode,local_root,updated_at",
                "limit": "1",
            },
        )
        if not rows:
            return StoragePreference(mode="local", local_root=None, updated_at=None)
        row = rows[0]
        return StoragePreference(
            mode=str(row["mode"]),
            local_root=str(row["local_root"]) if row.get("local_root") else None,
            updated_at=_parse_datetime(str(row.get("updated_at") or "")),
        )

    async def save_legal_acceptances(
        self,
        user_id: str,
        acceptances: list[tuple[str, str]],
    ) -> list[LegalAcceptanceRecord]:
        accepted_at = _utcnow().isoformat()
        rows = [
            {
                "user_id": user_id,
                "doc_type": doc_type,
                "version": version,
                "accepted_at": accepted_at,
            }
            for doc_type, version in acceptances
        ]
        await self._request(
            "POST",
            "legal_acceptances",
            json_body=rows,
            prefer="resolution=merge-duplicates,return=representation",
        )
        return await self.list_legal_acceptances(user_id)

    async def list_legal_acceptances(self, user_id: str) -> list[LegalAcceptanceRecord]:
        rows = await self._select_rows(
            "legal_acceptances",
            params={
                "user_id": f"eq.{user_id}",
                "select": "doc_type,version,accepted_at",
                "order": "accepted_at.desc",
            },
        )
        return [
            LegalAcceptanceRecord(
                type=str(row["doc_type"]),
                version=str(row["version"]),
                accepted_at=_parse_datetime(str(row.get("accepted_at") or "")) or _utcnow(),
            )
            for row in rows
        ]


@dataclass
class MemoryStore(CloudStore):
    credentials: dict[tuple[str, str], CredentialRecord] = field(default_factory=dict)
    oauth_states: dict[str, str] = field(default_factory=dict)
    storage_preferences: dict[str, StoragePreference] = field(default_factory=dict)
    legal_acceptances: dict[tuple[str, str, str], LegalAcceptanceRecord] = field(default_factory=dict)

    async def upsert_credential(
        self,
        user_id: str,
        provider: str,
        encrypted_value: str,
        connection_type: str,
    ) -> None:
        now = _utcnow().isoformat()
        self.credentials[(user_id, provider)] = CredentialRecord(
            user_id=user_id,
            provider=provider,
            encrypted_value=encrypted_value,
            connection_type=connection_type,
            updated_at=now,
        )

    async def delete_credential(self, user_id: str, provider: str) -> None:
        self.credentials.pop((user_id, provider), None)

    async def list_statuses(self, user_id: str) -> list[ProviderStatus]:
        statuses: list[ProviderStatus] = []
        for provider in ("openai", "openrouter"):
            record = self.credentials.get((user_id, provider))
            if not record:
                statuses.append(
                    ProviderStatus(provider=provider, connected=False, via="none", last_updated_at=None)
                )
                continue
            statuses.append(
                ProviderStatus(
                    provider=provider,
                    connected=True,
                    via=record.connection_type if record.connection_type in {"oauth", "api_key"} else "none",
                    last_updated_at=_parse_datetime(record.updated_at),
                )
            )
        return statuses

    async def get_credential(self, user_id: str, provider: str) -> CredentialRecord | None:
        return self.credentials.get((user_id, provider))

    async def save_oauth_state(self, state: str, user_id: str) -> None:
        self.oauth_states[state] = user_id

    async def consume_oauth_state(self, state: str) -> str | None:
        return self.oauth_states.pop(state, None)

    async def upsert_storage_preference(
        self,
        user_id: str,
        mode: str,
        local_root: str | None,
    ) -> StoragePreference:
        pref = StoragePreference(mode=mode, local_root=local_root, updated_at=_utcnow())
        self.storage_preferences[user_id] = pref
        return pref

    async def get_storage_preference(self, user_id: str) -> StoragePreference:
        return self.storage_preferences.get(user_id, StoragePreference(mode="local", local_root=None, updated_at=None))

    async def save_legal_acceptances(
        self,
        user_id: str,
        acceptances: list[tuple[str, str]],
    ) -> list[LegalAcceptanceRecord]:
        now = _utcnow()
        for doc_type, version in acceptances:
            self.legal_acceptances[(user_id, doc_type, version)] = LegalAcceptanceRecord(
                type=doc_type,
                version=version,
                accepted_at=now,
            )
        return await self.list_legal_acceptances(user_id)

    async def list_legal_acceptances(self, user_id: str) -> list[LegalAcceptanceRecord]:
        records = [
            record
            for (record_user_id, _doc_type, _version), record in self.legal_acceptances.items()
            if record_user_id == user_id
        ]
        return sorted(records, key=lambda record: record.accepted_at, reverse=True)

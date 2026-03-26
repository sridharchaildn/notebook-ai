from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .models import LegalAcceptanceRecord, ProviderStatus, StoragePreference


@dataclass
class CredentialRecord:
    user_id: str
    provider: str
    encrypted_value: str
    connection_type: str
    updated_at: str


@dataclass
class DesktopAuthCodeRecord:
    code: str
    user_id: str
    onboarding_complete: bool


class CredentialVault:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS credentials (
                  user_id TEXT NOT NULL,
                  provider TEXT NOT NULL,
                  encrypted_value TEXT NOT NULL,
                  connection_type TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (user_id, provider)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS oauth_states (
                  state TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS desktop_auth_states (
                  state TEXT PRIMARY KEY,
                  user_id TEXT,
                  device_label TEXT,
                  created_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL,
                  consumed_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS desktop_auth_codes (
                  code TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  onboarding_complete INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL,
                  consumed_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS legal_acceptances (
                  user_id TEXT NOT NULL,
                  doc_type TEXT NOT NULL,
                  version TEXT NOT NULL,
                  accepted_at TEXT NOT NULL,
                  PRIMARY KEY (user_id, doc_type, version)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_storage_preferences (
                  user_id TEXT PRIMARY KEY,
                  mode TEXT NOT NULL,
                  local_root TEXT,
                  updated_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def upsert_credential(self, user_id: str, provider: str, encrypted_value: str, connection_type: str) -> None:
        now = datetime.now(UTC).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO credentials (user_id, provider, encrypted_value, connection_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, provider) DO UPDATE SET
                  encrypted_value = excluded.encrypted_value,
                  connection_type = excluded.connection_type,
                  updated_at = excluded.updated_at
                """,
                (user_id, provider, encrypted_value, connection_type, now, now),
            )
            conn.commit()

    def delete_credential(self, user_id: str, provider: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM credentials WHERE user_id = ? AND provider = ?",
                (user_id, provider),
            )
            conn.commit()

    def list_statuses(self, user_id: str) -> list[ProviderStatus]:
        provider_rows: dict[str, sqlite3.Row] = {}
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT provider, connection_type, updated_at FROM credentials WHERE user_id = ?",
                (user_id,),
            ).fetchall()
            for row in rows:
                provider_rows[str(row["provider"])] = row

        statuses: list[ProviderStatus] = []
        for provider in ("openai", "openrouter"):
            row = provider_rows.get(provider)
            if not row:
                statuses.append(
                    ProviderStatus(
                        provider=provider,
                        connected=False,
                        via="none",
                        last_updated_at=None,
                    )
                )
                continue

            connection_type = str(row["connection_type"])
            statuses.append(
                ProviderStatus(
                    provider=provider,
                    connected=True,
                    via=connection_type if connection_type in {"oauth", "api_key"} else "none",
                    last_updated_at=datetime.fromisoformat(str(row["updated_at"])),
                )
            )

        return statuses

    def save_oauth_state(self, state: str, user_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)",
                (state, user_id, datetime.now(UTC).isoformat()),
            )
            conn.commit()

    def consume_oauth_state(self, state: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_id FROM oauth_states WHERE state = ?",
                (state,),
            ).fetchone()
            conn.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
            conn.commit()

        if not row:
            return None
        return str(row["user_id"])

    def create_desktop_auth_state(self, state: str, device_label: str | None) -> None:
        now = datetime.now(UTC)
        expires = now + timedelta(minutes=15)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO desktop_auth_states (state, user_id, device_label, created_at, expires_at, consumed_at)
                VALUES (?, NULL, ?, ?, ?, NULL)
                """,
                (state, device_label, now.isoformat(), expires.isoformat()),
            )
            conn.commit()

    def issue_desktop_auth_code(self, state: str, user_id: str, onboarding_complete: bool = True) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT state, expires_at, consumed_at FROM desktop_auth_states WHERE state = ?",
                (state,),
            ).fetchone()
            if not row:
                return None

            expires_at = _parse_datetime(str(row["expires_at"]))
            consumed_at = str(row["consumed_at"]) if row["consumed_at"] else None
            if consumed_at or not expires_at or expires_at <= datetime.now(UTC):
                return None

            code = _random_token(32)
            now = datetime.now(UTC)
            code_expires = now + timedelta(minutes=10)
            conn.execute(
                """
                INSERT INTO desktop_auth_codes (code, user_id, onboarding_complete, created_at, expires_at, consumed_at)
                VALUES (?, ?, ?, ?, ?, NULL)
                """,
                (code, user_id, 1 if onboarding_complete else 0, now.isoformat(), code_expires.isoformat()),
            )
            conn.execute(
                "UPDATE desktop_auth_states SET user_id = ?, consumed_at = ? WHERE state = ?",
                (user_id, now.isoformat(), state),
            )
            conn.commit()
            return code

    def consume_desktop_auth_code(self, code: str) -> DesktopAuthCodeRecord | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT code, user_id, onboarding_complete, expires_at, consumed_at FROM desktop_auth_codes WHERE code = ?",
                (code,),
            ).fetchone()
            if not row:
                return None

            expires_at = _parse_datetime(str(row["expires_at"]))
            consumed_at = str(row["consumed_at"]) if row["consumed_at"] else None
            if consumed_at or not expires_at or expires_at <= datetime.now(UTC):
                return None

            now = datetime.now(UTC).isoformat()
            conn.execute(
                "UPDATE desktop_auth_codes SET consumed_at = ? WHERE code = ?",
                (now, code),
            )
            conn.commit()

            return DesktopAuthCodeRecord(
                code=str(row["code"]),
                user_id=str(row["user_id"]),
                onboarding_complete=bool(row["onboarding_complete"]),
            )

    def get_desktop_auth_state(self, state: str) -> DesktopAuthCodeRecord | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT state, user_id, expires_at, consumed_at FROM desktop_auth_states WHERE state = ?",
                (state,),
            ).fetchone()
            if not row:
                return None

            user_id = str(row["user_id"]) if row["user_id"] else None
            consumed_at = str(row["consumed_at"]) if row["consumed_at"] else None
            expires_at = _parse_datetime(str(row["expires_at"]))
            if not user_id or not consumed_at or not expires_at or expires_at <= datetime.now(UTC):
                return None

            return DesktopAuthCodeRecord(
                code="",
                user_id=user_id,
                onboarding_complete=True,
            )

    def upsert_storage_preference(self, user_id: str, mode: str, local_root: str | None) -> StoragePreference:
        now = datetime.now(UTC).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_storage_preferences (user_id, mode, local_root, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  mode = excluded.mode,
                  local_root = excluded.local_root,
                  updated_at = excluded.updated_at
                """,
                (user_id, mode, local_root, now),
            )
            conn.commit()
        return self.get_storage_preference(user_id)

    def get_storage_preference(self, user_id: str) -> StoragePreference:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT mode, local_root, updated_at FROM user_storage_preferences WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if not row:
            return StoragePreference(mode="local", local_root=None, updated_at=None)

        return StoragePreference(
            mode=str(row["mode"]),
            local_root=str(row["local_root"]) if row["local_root"] else None,
            updated_at=_parse_datetime(str(row["updated_at"])),
        )

    def save_legal_acceptances(self, user_id: str, acceptances: list[tuple[str, str]]) -> list[LegalAcceptanceRecord]:
        accepted_at = datetime.now(UTC).isoformat()
        with self._connect() as conn:
            for doc_type, version in acceptances:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO legal_acceptances (user_id, doc_type, version, accepted_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (user_id, doc_type, version, accepted_at),
                )
            conn.commit()
        return self.list_legal_acceptances(user_id)

    def list_legal_acceptances(self, user_id: str) -> list[LegalAcceptanceRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT doc_type, version, accepted_at
                FROM legal_acceptances
                WHERE user_id = ?
                ORDER BY accepted_at DESC
                """,
                (user_id,),
            ).fetchall()

        return [
            LegalAcceptanceRecord(
                type=str(row["doc_type"]),
                version=str(row["version"]),
                accepted_at=_parse_datetime(str(row["accepted_at"])) or datetime.now(UTC),
            )
            for row in rows
        ]

    def get_credential(self, user_id: str, provider: str) -> CredentialRecord | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_id, provider, encrypted_value, connection_type, updated_at FROM credentials WHERE user_id = ? AND provider = ?",
                (user_id, provider),
            ).fetchone()

        if not row:
            return None

        return CredentialRecord(
            user_id=str(row["user_id"]),
            provider=str(row["provider"]),
            encrypted_value=str(row["encrypted_value"]),
            connection_type=str(row["connection_type"]),
            updated_at=str(row["updated_at"]),
        )


def _parse_datetime(raw: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed
    except ValueError:
        return None


def _random_token(length: int) -> str:
    import secrets

    return secrets.token_urlsafe(length)

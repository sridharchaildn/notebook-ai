from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .models import ProviderStatus


@dataclass
class CredentialRecord:
    user_id: str
    provider: str
    encrypted_value: str
    connection_type: str
    updated_at: str


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

from __future__ import annotations

import json
import secrets
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from .config import Settings
from .logging_setup import configure_cloud_logging
from .models import (
    AuthLogoutResponse,
    AuthRefreshRequest,
    AuthRefreshResponse,
    AuthenticatedUser,
    DriveConnectionStatus,
    GoogleDriveByokRequest,
    GoogleDriveFolderUpdateRequest,
    GoogleDriveTokenResponse,
    LegalAcceptRequest,
    LegalAcceptanceRecord,
    LegalCurrentResponse,
    LegalDocument,
    OAuthStartResponse,
    ProviderByokRequest,
    ProviderCredentialResponse,
    ProviderDeleteResponse,
    ProviderStatus,
    StoragePreference,
    StoragePreferenceRequest,
    WorkspaceDescriptor,
)
from .security import AuthError, SupabaseAuthGateway, decrypt_secret, encrypt_secret
from .storage import CloudStore, SupabaseStore


def create_app(
    settings: Settings | None = None,
    *,
    store: CloudStore | None = None,
    auth_gateway: SupabaseAuthGateway | None = None,
) -> FastAPI:
    current_settings = settings or Settings()
    log = configure_cloud_logging(current_settings.debug)
    log.info("Cloud API starting (debug=%s)", current_settings.debug)

    current_store = store or SupabaseStore(current_settings)
    current_auth = auth_gateway or SupabaseAuthGateway(current_settings)

    app = FastAPI(title="Notebook AI Cloud API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/auth/session/refresh", response_model=AuthRefreshResponse)
    async def auth_session_refresh(payload: AuthRefreshRequest) -> AuthRefreshResponse:
        try:
            session = await current_auth.refresh_session(payload.refresh_token)
        except AuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        return AuthRefreshResponse(session=session)

    @app.post("/auth/logout", response_model=AuthLogoutResponse)
    async def auth_logout(
        authorization: Annotated[str | None, Header()] = None,
    ) -> AuthLogoutResponse:
        access_token = _require_bearer_token(authorization)
        try:
            await current_auth.logout(access_token)
        except AuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        return AuthLogoutResponse(ok=True)

    @app.get("/legal/current", response_model=LegalCurrentResponse)
    async def legal_current() -> LegalCurrentResponse:
        documents = [
            LegalDocument(
                type="privacy_policy",
                version=current_settings.privacy_policy_version,
                title="Privacy Policy",
                url=current_settings.privacy_policy_url,
            ),
            LegalDocument(
                type="user_agreement",
                version=current_settings.user_agreement_version,
                title="User Agreement",
                url=current_settings.user_agreement_url,
            ),
        ]
        return LegalCurrentResponse(documents=documents)

    @app.post("/legal/accept", response_model=list[LegalAcceptanceRecord])
    async def legal_accept(
        payload: LegalAcceptRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> list[LegalAcceptanceRecord]:
        if len(payload.acceptances) == 0:
            raise HTTPException(status_code=400, detail="acceptances must include at least one document")

        user = await _require_user(current_auth, authorization)
        accepted = [(item.type, item.version) for item in payload.acceptances]
        return await current_store.save_legal_acceptances(user.id, accepted)

    @app.get("/legal/accept", response_model=list[LegalAcceptanceRecord])
    async def legal_accept_status(
        authorization: Annotated[str | None, Header()] = None,
    ) -> list[LegalAcceptanceRecord]:
        user = await _require_user(current_auth, authorization)
        return await current_store.list_legal_acceptances(user.id)

    @app.get("/settings/storage", response_model=StoragePreference)
    async def get_storage_preference(
        authorization: Annotated[str | None, Header()] = None,
    ) -> StoragePreference:
        user = await _require_user(current_auth, authorization)
        return await current_store.get_storage_preference(user.id)

    @app.put("/settings/storage", response_model=StoragePreference)
    async def put_storage_preference(
        payload: StoragePreferenceRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> StoragePreference:
        user = await _require_user(current_auth, authorization)
        return await current_store.upsert_storage_preference(
            user.id,
            mode=payload.mode,
            local_root=payload.local_root,
        )

    @app.get("/workspaces/current", response_model=WorkspaceDescriptor)
    async def get_current_workspace(
        authorization: Annotated[str | None, Header()] = None,
    ) -> WorkspaceDescriptor:
        user = await _require_user(current_auth, authorization)
        preference = await current_store.get_storage_preference(user.id)
        drive_record = await current_store.get_credential(user.id, "google_drive")
        drive_folder_id: str | None = None
        if drive_record:
            try:
                decrypted = decrypt_secret(drive_record.encrypted_value, current_settings.credential_secret)
                parsed = json.loads(decrypted)
                if isinstance(parsed, dict) and parsed.get("folder_id"):
                    drive_folder_id = str(parsed["folder_id"])
            except Exception:
                drive_folder_id = None

        return WorkspaceDescriptor(
            id=f"default::{user.id}",
            name="Notebook AI Workspace",
            kind="drive_shared" if preference.mode == "local_and_drive" else "desktop_local_only",
            storage_mode=preference.mode,
            drive_folder_id=drive_folder_id,
            local_root=preference.local_root,
            updated_at=preference.updated_at,
        )

    @app.post("/providers/openai/oauth/start", response_model=OAuthStartResponse)
    async def openai_oauth_start(
        authorization: Annotated[str | None, Header()] = None,
    ) -> OAuthStartResponse:
        user = await _require_user(current_auth, authorization)
        state = secrets.token_urlsafe(32)
        await current_store.save_oauth_state(state=state, user_id=user.id)

        params = {
            "client_id": current_settings.openai_oauth_client_id or "notebook-ai-dev-client",
            "response_type": "code",
            "redirect_uri": current_settings.openai_oauth_redirect_uri,
            "scope": current_settings.openai_oauth_scope,
            "state": state,
        }
        target = f"{current_settings.openai_oauth_authorize_url}?{urlencode(params)}"
        log.debug("OpenAI OAuth start user_id=%s", user.id)
        return OAuthStartResponse(url=target, state=state, expires_in_seconds=900)

    @app.get("/providers/openai/oauth/callback")
    async def openai_oauth_callback(
        code: str | None = Query(default=None),
        state: str | None = Query(default=None),
        error: str | None = Query(default=None),
    ) -> HTMLResponse:
        if error:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")

        if not state:
            raise HTTPException(status_code=400, detail="Missing OAuth state")

        user_id = await current_store.consume_oauth_state(state)
        if not user_id:
            raise HTTPException(status_code=400, detail="OAuth state is invalid or expired")

        token_payload: dict[str, str] = {"provider": "openai"}
        if (
            code
            and current_settings.openai_oauth_token_url
            and current_settings.openai_oauth_client_id
            and current_settings.openai_oauth_client_secret
        ):
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    current_settings.openai_oauth_token_url,
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "client_id": current_settings.openai_oauth_client_id,
                        "client_secret": current_settings.openai_oauth_client_secret,
                        "redirect_uri": current_settings.openai_oauth_redirect_uri,
                    },
                )
                response.raise_for_status()
                token_payload = response.json()
        else:
            token_payload = {
                "authorization_code": code or "dev-oauth-code",
                "note": "Token endpoint not configured; stored callback payload for development.",
            }

        encrypted = encrypt_secret(json.dumps(token_payload), current_settings.credential_secret)
        await current_store.upsert_credential(
            user_id=user_id,
            provider="openai",
            encrypted_value=encrypted,
            connection_type="oauth",
        )
        log.info("OpenAI OAuth callback stored credential user_id=%s", user_id)

        return HTMLResponse(
            content=(
                "<html><body style='font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 24px;'>"
                "<h2>OpenAI Connected</h2>"
                "<p>You can close this window and return to Notebook AI.</p>"
                "</body></html>"
            )
        )

    @app.post("/integrations/google-drive/oauth/start", response_model=OAuthStartResponse)
    async def google_drive_oauth_start(
        authorization: Annotated[str | None, Header()] = None,
    ) -> OAuthStartResponse:
        user = await _require_user(current_auth, authorization)
        state = secrets.token_urlsafe(32)
        await current_store.save_oauth_state(state=state, user_id=user.id)

        params = {
            "client_id": current_settings.google_drive_client_id or "notebook-ai-dev-client",
            "redirect_uri": current_settings.google_drive_redirect_uri,
            "response_type": "code",
            "scope": current_settings.google_drive_scope,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        target = f"{current_settings.google_drive_oauth_authorize_url}?{urlencode(params)}"
        return OAuthStartResponse(url=target, state=state, expires_in_seconds=900)

    @app.get("/integrations/google-drive/oauth/callback")
    async def google_drive_oauth_callback(
        code: str | None = Query(default=None),
        state: str | None = Query(default=None),
        error: str | None = Query(default=None),
    ) -> HTMLResponse:
        if error:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")
        if not state:
            raise HTTPException(status_code=400, detail="Missing OAuth state")

        user_id = await current_store.consume_oauth_state(state)
        if not user_id:
            raise HTTPException(status_code=400, detail="OAuth state is invalid or expired")

        token_payload: dict[str, str] = {
            "refresh_token": "dev-google-drive-token",
            "folder_name": current_settings.google_drive_default_folder_name,
        }
        if (
            code
            and current_settings.google_drive_oauth_token_url
            and current_settings.google_drive_client_id
            and current_settings.google_drive_client_secret
        ):
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    current_settings.google_drive_oauth_token_url,
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "client_id": current_settings.google_drive_client_id,
                        "client_secret": current_settings.google_drive_client_secret,
                        "redirect_uri": current_settings.google_drive_redirect_uri,
                    },
                )
                response.raise_for_status()
                token_payload = response.json()
                token_payload["folder_name"] = current_settings.google_drive_default_folder_name

        encrypted = encrypt_secret(json.dumps(token_payload), current_settings.credential_secret)
        await current_store.upsert_credential(
            user_id=user_id,
            provider="google_drive",
            encrypted_value=encrypted,
            connection_type="oauth",
        )

        return HTMLResponse(
            content=(
                "<html><body style='font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 24px;'>"
                "<h2>Google Drive Connected</h2>"
                "<p>Notebook AI can now mirror transcripts to your Drive folder.</p>"
                "</body></html>"
            )
        )

    async def _load_google_drive_payload(user_id: str) -> tuple[object | None, object | None]:
        record = await current_store.get_credential(user_id, "google_drive")
        if not record:
            return None, None
        decrypted = decrypt_secret(record.encrypted_value, current_settings.credential_secret)
        try:
            parsed = json.loads(decrypted)
        except json.JSONDecodeError:
            parsed = decrypted
        return record, parsed

    async def _save_google_drive_payload(
        user_id: str,
        payload: dict[str, object],
    ) -> None:
        encrypted = encrypt_secret(json.dumps(payload), current_settings.credential_secret)
        await current_store.upsert_credential(
            user_id=user_id,
            provider="google_drive",
            encrypted_value=encrypted,
            connection_type="oauth",
        )

    @app.get("/integrations/google-drive/status", response_model=DriveConnectionStatus)
    async def google_drive_status(
        authorization: Annotated[str | None, Header()] = None,
    ) -> DriveConnectionStatus:
        user = await _require_user(current_auth, authorization)
        record, parsed = await _load_google_drive_payload(user.id)
        if not record:
            return DriveConnectionStatus(
                connected=False,
                folder_name=current_settings.google_drive_default_folder_name,
                folder_id=None,
                last_updated_at=None,
            )

        folder_id: str | None = None
        folder_name = current_settings.google_drive_default_folder_name
        try:
            if isinstance(parsed, dict):
                folder_id = str(parsed.get("folder_id")) if parsed.get("folder_id") else None
                folder_name = str(parsed.get("folder_name") or folder_name)
        except Exception:
            folder_id = None

        return DriveConnectionStatus(
            connected=True,
            folder_name=folder_name,
            folder_id=folder_id,
            last_updated_at=None,
        )

    @app.put("/integrations/google-drive/folder", response_model=DriveConnectionStatus)
    async def google_drive_folder_update(
        payload: GoogleDriveFolderUpdateRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> DriveConnectionStatus:
        user = await _require_user(current_auth, authorization)
        record, parsed = await _load_google_drive_payload(user.id)
        if not record:
            raise HTTPException(status_code=404, detail="Google Drive is not connected")

        next_payload = parsed if isinstance(parsed, dict) else {}
        next_payload["folder_id"] = payload.folder_id
        next_payload["folder_name"] = payload.folder_name or str(
            next_payload.get("folder_name") or current_settings.google_drive_default_folder_name
        )
        await _save_google_drive_payload(user.id, next_payload)

        return DriveConnectionStatus(
            connected=True,
            folder_name=str(next_payload["folder_name"]),
            folder_id=str(next_payload["folder_id"]),
            last_updated_at=None,
        )

    @app.post("/integrations/google-drive/byok", response_model=DriveConnectionStatus)
    async def google_drive_byok(
        payload: GoogleDriveByokRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> DriveConnectionStatus:
        user = await _require_user(current_auth, authorization)
        serialized = json.dumps(
            {
                "refresh_token": payload.refresh_token,
                "folder_id": payload.folder_id,
                "folder_name": current_settings.google_drive_default_folder_name,
            }
        )
        encrypted = encrypt_secret(serialized, current_settings.credential_secret)
        await current_store.upsert_credential(
            user_id=user.id,
            provider="google_drive",
            encrypted_value=encrypted,
            connection_type="oauth",
        )

        return DriveConnectionStatus(
            connected=True,
            folder_name=current_settings.google_drive_default_folder_name,
            folder_id=payload.folder_id,
            last_updated_at=None,
        )

    @app.post("/integrations/google-drive/access-token", response_model=GoogleDriveTokenResponse)
    async def google_drive_access_token(
        authorization: Annotated[str | None, Header()] = None,
    ) -> GoogleDriveTokenResponse:
        user = await _require_user(current_auth, authorization)
        record, parsed = await _load_google_drive_payload(user.id)
        if not record:
            raise HTTPException(status_code=404, detail="Google Drive is not connected")

        folder_id: str | None = None
        folder_name = current_settings.google_drive_default_folder_name
        token = ""
        next_payload = parsed if isinstance(parsed, dict) else {}

        if isinstance(parsed, dict):
            folder_id = str(parsed.get("folder_id")) if parsed.get("folder_id") else None
            folder_name = str(parsed.get("folder_name") or folder_name)
            refresh_token = str(parsed.get("refresh_token") or "")
            token = str(parsed.get("access_token") or "")
            if (
                refresh_token
                and current_settings.google_drive_oauth_token_url
                and current_settings.google_drive_client_id
                and current_settings.google_drive_client_secret
            ):
                async with httpx.AsyncClient(timeout=20) as client:
                    response = await client.post(
                        current_settings.google_drive_oauth_token_url,
                        data={
                            "grant_type": "refresh_token",
                            "refresh_token": refresh_token,
                            "client_id": current_settings.google_drive_client_id,
                            "client_secret": current_settings.google_drive_client_secret,
                        },
                    )
                    response.raise_for_status()
                    refreshed = response.json()
                token = str(refreshed.get("access_token") or token)
                if token:
                    next_payload["access_token"] = token
                    if refreshed.get("refresh_token"):
                        next_payload["refresh_token"] = refreshed["refresh_token"]
                    await _save_google_drive_payload(user.id, next_payload)
            elif refresh_token and not token:
                token = refresh_token
        elif isinstance(parsed, str):
            token = parsed

        if not token:
            raise HTTPException(
                status_code=409,
                detail="Stored Google Drive credential cannot be exchanged for an access token",
            )
        return GoogleDriveTokenResponse(
            access_token=token,
            folder_id=folder_id,
            folder_name=folder_name,
        )

    @app.post("/providers/byok", response_model=list[ProviderStatus])
    async def save_provider_byok(
        payload: ProviderByokRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> list[ProviderStatus]:
        user = await _require_user(current_auth, authorization)
        encrypted = encrypt_secret(payload.api_key, current_settings.credential_secret)
        await current_store.upsert_credential(
            user_id=user.id,
            provider=payload.provider,
            encrypted_value=encrypted,
            connection_type="api_key",
        )
        log.info("BYOK saved user_id=%s provider=%s", user.id, payload.provider)
        return await current_store.list_statuses(user.id)

    @app.get("/providers/status", response_model=list[ProviderStatus])
    async def provider_status(
        authorization: Annotated[str | None, Header()] = None,
    ) -> list[ProviderStatus]:
        user = await _require_user(current_auth, authorization)
        log.debug("GET /providers/status user_id=%s", user.id)
        return await current_store.list_statuses(user.id)

    @app.get("/providers/credential", response_model=ProviderCredentialResponse)
    async def provider_credential(
        provider: str,
        authorization: Annotated[str | None, Header()] = None,
    ) -> ProviderCredentialResponse:
        if provider not in {"openai", "openrouter"}:
            raise HTTPException(status_code=404, detail="Unsupported provider")

        user = await _require_user(current_auth, authorization)
        record = await current_store.get_credential(user.id, provider)
        if not record:
            log.warning("GET /providers/credential miss user_id=%s provider=%s", user.id, provider)
            raise HTTPException(status_code=404, detail="Credential not found")

        if record.connection_type not in {"oauth", "api_key"}:
            raise HTTPException(status_code=409, detail="Credential type unsupported")

        log.debug(
            "GET /providers/credential hit user_id=%s provider=%s via=%s",
            user.id,
            provider,
            record.connection_type,
        )
        return ProviderCredentialResponse(
            provider=provider,
            connection_type=record.connection_type,
            secret=decrypt_secret(record.encrypted_value, current_settings.credential_secret),
        )

    @app.delete("/providers/{provider}", response_model=ProviderDeleteResponse)
    async def delete_provider_connection(
        provider: str,
        authorization: Annotated[str | None, Header()] = None,
    ) -> ProviderDeleteResponse:
        if provider not in {"openai", "openrouter"}:
            raise HTTPException(status_code=404, detail="Unsupported provider")

        user = await _require_user(current_auth, authorization)
        await current_store.delete_credential(user.id, provider)
        log.info("DELETE provider user_id=%s provider=%s", user.id, provider)
        return ProviderDeleteResponse(provider=provider, connected=False)

    return app


def _create_default_app() -> FastAPI:
    try:
        return create_app()
    except RuntimeError as exc:
        fallback = FastAPI(title="Notebook AI Cloud API", version="0.1.0")

        @fallback.get("/health")
        async def health() -> dict[str, str]:
            return {"status": "misconfigured"}

        @fallback.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        async def unavailable(_request: Request, path: str) -> JSONResponse:
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Cloud API configuration is incomplete",
                    "missing_path": path,
                    "error": str(exc),
                },
            )

        return fallback


app = _create_default_app()


def _require_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


async def _require_user(auth_gateway: SupabaseAuthGateway, authorization: str | None) -> AuthenticatedUser:
    token = _require_bearer_token(authorization)
    try:
        return await auth_gateway.verify_access_token(token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

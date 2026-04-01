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
    OAuthStartResponse,
    ProviderByokRequest,
    ProviderCredentialResponse,
    ProviderDeleteResponse,
    ProviderModel,
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
    provider_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    current_settings = settings or Settings()
    _validate_runtime_settings(current_settings)
    log = configure_cloud_logging(current_settings.debug)
    log.info("Cloud API starting (debug=%s)", current_settings.debug)

    current_store = store or SupabaseStore(current_settings)
    current_auth = auth_gateway or SupabaseAuthGateway(current_settings)

    app = FastAPI(title="Notebook AI Cloud API", version=current_settings.app_version)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(current_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.get("/health")
    async def health() -> dict[str, str | bool]:
        return {
            "status": "ok",
            "service": "cloud-api",
            "version": current_settings.app_version,
            "build_version": current_settings.resolved_build_version,
            "configured": True,
        }

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
        _require_openai_oauth_configuration(current_settings)
        user = await _require_user(current_auth, authorization)
        state = secrets.token_urlsafe(32)
        await current_store.save_oauth_state(state=state, user_id=user.id)

        params = {
            "client_id": current_settings.openai_oauth_client_id,
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
        _require_openai_oauth_configuration(current_settings)
        if error:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")
        if not code:
            raise HTTPException(status_code=400, detail="Missing OAuth code")

        if not state:
            raise HTTPException(status_code=400, detail="Missing OAuth state")

        user_id = await current_store.consume_oauth_state(state)
        if not user_id:
            raise HTTPException(status_code=400, detail="OAuth state is invalid or expired")

        async with httpx.AsyncClient(timeout=20, transport=provider_transport) as client:
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
        _require_google_drive_oauth_configuration(current_settings)
        user = await _require_user(current_auth, authorization)
        state = secrets.token_urlsafe(32)
        await current_store.save_oauth_state(state=state, user_id=user.id)

        params = {
            "client_id": current_settings.google_drive_client_id,
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
        _require_google_drive_oauth_configuration(current_settings)
        if error:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")
        if not code:
            raise HTTPException(status_code=400, detail="Missing OAuth code")
        if not state:
            raise HTTPException(status_code=400, detail="Missing OAuth state")

        user_id = await current_store.consume_oauth_state(state)
        if not user_id:
            raise HTTPException(status_code=400, detail="OAuth state is invalid or expired")

        async with httpx.AsyncClient(timeout=20, transport=provider_transport) as client:
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
                async with httpx.AsyncClient(timeout=20, transport=provider_transport) as client:
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

    @app.get("/providers/models", response_model=list[ProviderModel])
    async def provider_models(
        provider: str = Query(...),
        use_case: str = Query(default="copilot"),
        authorization: Annotated[str | None, Header()] = None,
    ) -> list[ProviderModel]:
        if provider not in {"openai", "openrouter"}:
            raise HTTPException(status_code=404, detail="Unsupported provider")
        if use_case not in {"copilot", "transcription"}:
            raise HTTPException(status_code=400, detail="Unsupported use_case")

        user = await _require_user(current_auth, authorization)
        record = await current_store.get_credential(user.id, provider)
        if not record:
            raise HTTPException(status_code=404, detail="Credential not found")

        return await _fetch_provider_models(
            record=record,
            settings=current_settings,
            provider=provider,
            use_case=use_case,
            transport=provider_transport,
        )

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


def _validate_runtime_settings(settings: Settings) -> None:
    if not settings.debug and settings.credential_secret == "dev-credential-secret":
        raise RuntimeError("NOTEBOOK_CLOUD_CREDENTIAL_SECRET must be set before deploying the cloud API")


def _require_openai_oauth_configuration(settings: Settings) -> None:
    if (
        not settings.openai_oauth_client_id
        or not settings.openai_oauth_client_secret
        or not settings.openai_oauth_token_url
    ):
        raise HTTPException(status_code=503, detail="OpenAI OAuth is not configured")


def _require_google_drive_oauth_configuration(settings: Settings) -> None:
    if (
        not settings.google_drive_client_id
        or not settings.google_drive_client_secret
        or not settings.google_drive_oauth_token_url
    ):
        raise HTTPException(status_code=503, detail="Google Drive OAuth is not configured")


def _create_default_app() -> FastAPI:
    settings = Settings()
    try:
        return create_app(settings)
    except RuntimeError as exc:
        fallback = FastAPI(title="Notebook AI Cloud API", version=settings.app_version)

        @fallback.get("/health")
        async def health() -> dict[str, str | bool]:
            return {
                "status": "misconfigured",
                "service": "cloud-api",
                "version": settings.app_version,
                "build_version": settings.resolved_build_version,
                "configured": False,
            }

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


async def _fetch_provider_models(
    *,
    record,
    settings: Settings,
    provider: str,
    use_case: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[ProviderModel]:
    token = _resolve_provider_access_token(record=record, settings=settings, provider=provider)
    if provider == "openai":
        return await _fetch_openai_models(token=token, use_case=use_case, transport=transport)
    return await _fetch_openrouter_models(token=token, use_case=use_case, transport=transport)


def _resolve_provider_access_token(*, record, settings: Settings, provider: str) -> str:
    secret = decrypt_secret(record.encrypted_value, settings.credential_secret)
    if record.connection_type != "oauth":
        return secret

    try:
        payload = json.loads(secret)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=409, detail=f"{provider} OAuth credential is invalid") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=409, detail=f"{provider} OAuth credential is invalid")

    access_token = str(payload.get("access_token") or "").strip()
    if access_token:
        return access_token

    raise HTTPException(
        status_code=409,
        detail=(
            f"{provider} OAuth connection does not include a usable access token yet. "
            "Use BYOK or configure the OAuth token exchange."
        ),
    )


async def _fetch_openai_models(
    *,
    token: str,
    use_case: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[ProviderModel]:
    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        response = await client.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {token}"},
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI model list failed: {exc.response.text[:300]}") from exc

    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, list):
        data = []

    models: list[ProviderModel] = []
    for raw in data:
        if not isinstance(raw, dict):
            continue
        model_id = str(raw.get("id") or "").strip()
        if not model_id:
            continue
        if use_case == "copilot":
            if not _openai_supports_copilot(model_id):
                continue
            models.append(
                ProviderModel(
                    id=model_id,
                    label=model_id,
                    provider="openai",
                    owned_by=str(raw.get("owned_by") or "") or None,
                )
            )
            continue

        if _openai_supports_transcription(model_id):
            models.append(
                ProviderModel(
                    id=model_id,
                    label=model_id,
                    provider="openai",
                    owned_by=str(raw.get("owned_by") or "") or None,
                    supports_audio_input=True,
                )
            )

    if use_case == "transcription":
        for fallback_id in ("gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"):
            if all(item.id != fallback_id for item in models):
                models.append(
                    ProviderModel(
                        id=fallback_id,
                        label=fallback_id,
                        provider="openai",
                        owned_by="openai",
                        supports_audio_input=True,
                    )
                )

    return sorted(models, key=lambda item: _provider_model_sort_key(item.id))


async def _fetch_openrouter_models(
    *,
    token: str,
    use_case: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[ProviderModel]:
    headers = {
        "Authorization": f"Bearer {token}",
        "HTTP-Referer": "https://notebook-ai.local",
        "X-Title": "Notebook AI",
    }
    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        response = await client.get("https://openrouter.ai/api/v1/models", headers=headers)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenRouter model list failed: {exc.response.text[:300]}") from exc

    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, list):
        data = []

    models: list[ProviderModel] = []
    for raw in data:
        if not isinstance(raw, dict):
            continue
        model_id = str(raw.get("id") or "").strip()
        if not model_id:
            continue

        architecture = raw.get("architecture") if isinstance(raw.get("architecture"), dict) else {}
        input_modalities = architecture.get("input_modalities") if isinstance(architecture, dict) else None
        supports_audio = isinstance(input_modalities, list) and "audio" in {
            str(item).lower() for item in input_modalities
        }

        if use_case == "transcription" and not supports_audio:
            continue

        models.append(
            ProviderModel(
                id=model_id,
                label=str(raw.get("name") or model_id),
                provider="openrouter",
                owned_by=str(raw.get("top_provider") or "") or None,
                context_length=int(raw.get("context_length")) if isinstance(raw.get("context_length"), int) else None,
                supports_audio_input=supports_audio,
            )
        )

    return sorted(models, key=lambda item: _provider_model_sort_key(item.id))


def _openai_supports_copilot(model_id: str) -> bool:
    blocked_fragments = ("embedding", "moderation", "transcribe", "whisper", "tts", "realtime")
    if any(fragment in model_id for fragment in blocked_fragments):
        return False
    return model_id.startswith(("gpt-", "chatgpt-", "o1", "o3", "o4"))


def _openai_supports_transcription(model_id: str) -> bool:
    lowered = model_id.lower()
    return "transcribe" in lowered or lowered == "whisper-1" or "audio" in lowered


def _provider_model_sort_key(model_id: str) -> tuple[int, str]:
    preferred = {
        "gpt-4o-mini": 0,
        "gpt-4.1-mini": 1,
        "gpt-4.1": 2,
        "gpt-4o": 3,
        "o4-mini": 4,
        "o3-mini": 5,
        "openai/gpt-4o-mini": 6,
        "openai/gpt-4.1-mini": 7,
        "openai/gpt-4.1": 8,
        "openai/gpt-4o": 9,
        "openai/gpt-4o-audio-preview": 10,
        "gpt-4o-mini-transcribe": 11,
        "gpt-4o-transcribe": 12,
        "whisper-1": 13,
    }
    return preferred.get(model_id, 1000), model_id

from __future__ import annotations

import json
import secrets
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse

from .config import Settings
from .logging_setup import configure_cloud_logging
from .models import (
    AuthSessionExchangeRequest,
    AuthSessionExchangeResponse,
    ProviderByokRequest,
    ProviderCredentialResponse,
    ProviderDeleteResponse,
    ProviderStatus,
)
from .security import (
    AuthError,
    create_app_session_token,
    decrypt_secret,
    encrypt_secret,
    parse_app_session_token,
    verify_supabase_access_token,
)
from .storage import CredentialVault


def create_app(settings: Settings | None = None) -> FastAPI:
    current_settings = settings or Settings()
    log = configure_cloud_logging(current_settings.debug)
    log.info("Cloud API starting (debug=%s)", current_settings.debug)

    vault = CredentialVault(current_settings.database_path)

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

    @app.post("/auth/session/exchange", response_model=AuthSessionExchangeResponse)
    async def auth_session_exchange(payload: AuthSessionExchangeRequest) -> AuthSessionExchangeResponse:
        user_id = current_settings.dev_user_id
        if payload.access_token:
            claims = verify_supabase_access_token(payload.access_token, current_settings)
            user_id = str(
                claims.get("sub")
                or claims.get("user_id")
                or claims.get("id")
                or current_settings.dev_user_id
            )

        session_token, expires = create_app_session_token(user_id, current_settings)
        return AuthSessionExchangeResponse(
            user_id=user_id,
            session_token=session_token,
            expires_in_seconds=expires,
        )

    @app.get("/providers/openai/oauth/start")
    async def openai_oauth_start(
        session_token: str | None = Query(default=None),
        user_id: str | None = Query(default=None),
        authorization: Annotated[str | None, Header()] = None,
    ) -> RedirectResponse:
        resolved_user_id = _resolve_user_id(
            settings=current_settings,
            authorization=authorization,
            session_token=session_token,
            explicit_user_id=user_id,
        )

        state = secrets.token_urlsafe(32)
        vault.save_oauth_state(state=state, user_id=resolved_user_id)

        params = {
            "client_id": current_settings.openai_oauth_client_id or "notebook-ai-dev-client",
            "response_type": "code",
            "redirect_uri": current_settings.openai_oauth_redirect_uri,
            "scope": current_settings.openai_oauth_scope,
            "state": state,
        }
        target = f"{current_settings.openai_oauth_authorize_url}?{urlencode(params)}"
        log.debug("OpenAI OAuth start user_id=%s", resolved_user_id)
        return RedirectResponse(target)

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

        user_id = vault.consume_oauth_state(state)
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
        vault.upsert_credential(
            user_id=user_id,
            provider="openai",
            encrypted_value=encrypted,
            connection_type="oauth",
        )
        log.info("OpenAI OAuth callback stored credential user_id=%s", user_id)

        html = (
            "<html><body style='font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 24px;'>"
            "<h2>OpenAI Connected</h2>"
            "<p>You can close this window and return to Notebook AI.</p>"
            "</body></html>"
        )
        return HTMLResponse(content=html)

    @app.post("/providers/byok", response_model=list[ProviderStatus])
    async def save_provider_byok(
        payload: ProviderByokRequest,
        authorization: Annotated[str | None, Header()] = None,
    ) -> list[ProviderStatus]:
        resolved_user_id = _resolve_user_id(
            settings=current_settings,
            authorization=authorization,
            session_token=payload.session_token,
            explicit_user_id=payload.user_id,
        )

        encrypted = encrypt_secret(payload.api_key, current_settings.credential_secret)
        vault.upsert_credential(
            user_id=resolved_user_id,
            provider=payload.provider,
            encrypted_value=encrypted,
            connection_type="api_key",
        )
        log.info("BYOK saved user_id=%s provider=%s", resolved_user_id, payload.provider)

        return vault.list_statuses(resolved_user_id)

    @app.get("/providers/status", response_model=list[ProviderStatus])
    async def provider_status(
        session_token: str | None = Query(default=None),
        user_id: str | None = Query(default=None),
        authorization: Annotated[str | None, Header()] = None,
    ) -> list[ProviderStatus]:
        resolved_user_id = _resolve_user_id(
            settings=current_settings,
            authorization=authorization,
            session_token=session_token,
            explicit_user_id=user_id,
        )
        log.debug("GET /providers/status user_id=%s", resolved_user_id)
        return vault.list_statuses(resolved_user_id)

    @app.get("/providers/credential", response_model=ProviderCredentialResponse)
    async def provider_credential(
        provider: str,
        session_token: str | None = Query(default=None),
        user_id: str | None = Query(default=None),
        authorization: Annotated[str | None, Header()] = None,
    ) -> ProviderCredentialResponse:
        if provider not in {"openai", "openrouter"}:
            raise HTTPException(status_code=404, detail="Unsupported provider")

        resolved_user_id = _resolve_user_id(
            settings=current_settings,
            authorization=authorization,
            session_token=session_token,
            explicit_user_id=user_id,
        )

        record = vault.get_credential(resolved_user_id, provider)
        if not record:
            log.warning(
                "GET /providers/credential miss user_id=%s provider=%s",
                resolved_user_id,
                provider,
            )
            raise HTTPException(status_code=404, detail="Credential not found")

        if record.connection_type not in {"oauth", "api_key"}:
            raise HTTPException(status_code=409, detail="Credential type unsupported")

        log.debug(
            "GET /providers/credential hit user_id=%s provider=%s via=%s",
            resolved_user_id,
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
        session_token: str | None = Query(default=None),
        user_id: str | None = Query(default=None),
        authorization: Annotated[str | None, Header()] = None,
    ) -> ProviderDeleteResponse:
        if provider not in {"openai", "openrouter"}:
            raise HTTPException(status_code=404, detail="Unsupported provider")

        resolved_user_id = _resolve_user_id(
            settings=current_settings,
            authorization=authorization,
            session_token=session_token,
            explicit_user_id=user_id,
        )

        vault.delete_credential(resolved_user_id, provider)
        log.info("DELETE provider user_id=%s provider=%s", resolved_user_id, provider)
        return ProviderDeleteResponse(provider=provider, connected=False)

    return app


app = create_app()


def _resolve_user_id(
    *,
    settings: Settings,
    authorization: str | None,
    session_token: str | None,
    explicit_user_id: str | None,
) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        return _user_from_session(token=token, settings=settings)

    if session_token:
        return _user_from_session(token=session_token, settings=settings)

    if explicit_user_id:
        return explicit_user_id

    return settings.dev_user_id


def _user_from_session(token: str, settings: Settings) -> str:
    try:
        payload = parse_app_session_token(token, settings)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Session token missing user")
    return str(user_id)

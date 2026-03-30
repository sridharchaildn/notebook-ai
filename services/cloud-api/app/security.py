from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from cryptography.fernet import Fernet
from jwt import PyJWKClient

from .config import Settings
from .models import AuthenticatedUser, SupabaseSessionPayload


class AuthError(RuntimeError):
    pass


def build_fernet(secret: str) -> Fernet:
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(secret_value: str, app_secret: str) -> str:
    fernet = build_fernet(app_secret)
    return fernet.encrypt(secret_value.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted_value: str, app_secret: str) -> str:
    fernet = build_fernet(app_secret)
    return fernet.decrypt(encrypted_value.encode("utf-8")).decode("utf-8")


def _verify_supabase_claims(token: str, settings: Settings) -> dict[str, Any]:
    if settings.supabase_jwt_secret:
        try:
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256", "HS384", "HS512"],
                options={"verify_aud": False},
            )
        except jwt.PyJWTError as exc:
            raise AuthError("Invalid Supabase JWT") from exc

    if settings.supabase_jwks_url:
        try:
            header = jwt.get_unverified_header(token)
            algorithm = str(header.get("alg") or "").strip()
            jwk_client = PyJWKClient(settings.supabase_jwks_url)
            key = jwk_client.get_signing_key_from_jwt(token).key
            return jwt.decode(
                token,
                key=key,
                algorithms=[algorithm] if algorithm else ["RS256", "ES256", "EdDSA"],
                options={"verify_aud": False},
            )
        except (jwt.PyJWTError, ValueError) as exc:
            raise AuthError("Unable to verify Supabase JWT with JWKS") from exc

    raise AuthError("Supabase token verification is not configured")


def _session_from_payload(payload: dict[str, Any]) -> SupabaseSessionPayload:
    user_payload = payload.get("user")
    if not isinstance(user_payload, dict):
        raise AuthError("Supabase session response is missing user data")

    access_token = str(payload.get("access_token") or "").strip()
    refresh_token = str(payload.get("refresh_token") or "").strip()
    if not access_token or not refresh_token:
        raise AuthError("Supabase session response is missing tokens")

    return SupabaseSessionPayload(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=int(payload["expires_at"]) if payload.get("expires_at") is not None else None,
        expires_in=int(payload["expires_in"]) if payload.get("expires_in") is not None else None,
        token_type=str(payload.get("token_type") or "bearer"),
        user=AuthenticatedUser(
            id=str(user_payload.get("id") or user_payload.get("sub") or ""),
            email=str(user_payload["email"]) if user_payload.get("email") else None,
        ),
    )


class SupabaseAuthGateway:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    def _anon_headers(self, access_token: str | None = None) -> dict[str, str]:
        if not self.settings.supabase_anon_key:
            raise AuthError("Supabase anon key is not configured")

        headers = {"apikey": self.settings.supabase_anon_key}
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        return headers

    async def verify_access_token(self, token: str) -> AuthenticatedUser:
        token = token.strip()
        if not token:
            raise AuthError("Missing bearer token")

        try:
            claims = _verify_supabase_claims(token, self.settings)
            user_id = str(claims.get("sub") or claims.get("user_id") or claims.get("id") or "").strip()
            if not user_id:
                raise AuthError("Supabase token is missing subject")
            email = str(claims["email"]) if claims.get("email") else None
            return AuthenticatedUser(id=user_id, email=email)
        except AuthError:
            if self.settings.supabase_jwt_secret:
                raise

        async with httpx.AsyncClient(timeout=10.0, transport=self.transport) as client:
            response = await client.get(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers=self._anon_headers(token),
            )

        if response.status_code != 200:
            raise AuthError("Invalid Supabase access token")

        payload = response.json()
        user_id = str(payload.get("id") or payload.get("sub") or "").strip()
        if not user_id:
            raise AuthError("Supabase user response is missing id")
        email = str(payload["email"]) if payload.get("email") else None
        return AuthenticatedUser(id=user_id, email=email)

    async def refresh_session(self, refresh_token: str) -> SupabaseSessionPayload:
        async with httpx.AsyncClient(timeout=10.0, transport=self.transport) as client:
            response = await client.post(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/token",
                params={"grant_type": "refresh_token"},
                headers={**self._anon_headers(), "Content-Type": "application/json"},
                json={"refresh_token": refresh_token},
            )

        if response.status_code != 200:
            raise AuthError("Unable to refresh Supabase session")

        return _session_from_payload(response.json())

    async def logout(self, access_token: str) -> None:
        async with httpx.AsyncClient(timeout=10.0, transport=self.transport) as client:
            response = await client.post(
                f"{self.settings.supabase_url.rstrip('/')}/auth/v1/logout",
                params={"scope": "local"},
                headers=self._anon_headers(access_token),
            )

        if response.status_code not in {200, 204}:
            raise AuthError("Unable to sign out of Supabase")


@dataclass
class MemoryAuthGateway:
    users_by_access_token: dict[str, AuthenticatedUser] = field(default_factory=dict)
    sessions_by_refresh_token: dict[str, SupabaseSessionPayload] = field(default_factory=dict)
    revoked_access_tokens: set[str] = field(default_factory=set)

    async def verify_access_token(self, token: str) -> AuthenticatedUser:
        token = token.strip()
        if not token or token in self.revoked_access_tokens:
            raise AuthError("Invalid Supabase access token")
        user = self.users_by_access_token.get(token)
        if not user:
            raise AuthError("Invalid Supabase access token")
        return user

    async def refresh_session(self, refresh_token: str) -> SupabaseSessionPayload:
        session = self.sessions_by_refresh_token.get(refresh_token)
        if not session:
            raise AuthError("Unable to refresh Supabase session")
        return session

    async def logout(self, access_token: str) -> None:
        self.revoked_access_tokens.add(access_token.strip())

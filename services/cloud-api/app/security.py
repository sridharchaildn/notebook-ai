from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from cryptography.fernet import Fernet
from jwt import PyJWKClient

from .config import Settings


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


def create_app_session_token(user_id: str, settings: Settings) -> tuple[str, int]:
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=settings.app_jwt_exp_minutes)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "aud": "notebook-ai-desktop",
        "iss": "notebook-ai-cloud-api",
    }
    token = jwt.encode(payload, settings.app_jwt_secret, algorithm="HS256")
    return token, int((expires - now).total_seconds())


def parse_app_session_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            settings.app_jwt_secret,
            algorithms=["HS256"],
            audience="notebook-ai-desktop",
            issuer="notebook-ai-cloud-api",
        )
    except jwt.PyJWTError as exc:
        raise AuthError("Invalid app session token") from exc


def verify_supabase_access_token(token: str, settings: Settings) -> dict[str, Any]:
    if settings.supabase_jwt_secret:
        try:
            return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256", "HS384", "HS512"])
        except jwt.PyJWTError as exc:
            raise AuthError("Invalid Supabase JWT") from exc

    if settings.supabase_jwks_url:
        try:
            jwk_client = PyJWKClient(settings.supabase_jwks_url)
            key = jwk_client.get_signing_key_from_jwt(token).key
            return jwt.decode(token, key=key, algorithms=["RS256", "RS384", "RS512"])
        except jwt.PyJWTError as exc:
            raise AuthError("Unable to verify Supabase JWT with JWKS") from exc

    try:
        return jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError as exc:
        raise AuthError("Supabase token format is invalid") from exc

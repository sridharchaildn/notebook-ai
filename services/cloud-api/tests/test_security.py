from __future__ import annotations

import asyncio

import httpx

from app.config import Settings
from app.models import AuthenticatedUser, SupabaseSessionPayload
from app.security import MemoryAuthGateway, SupabaseAuthGateway, decrypt_secret, encrypt_secret


def test_encrypt_decrypt_roundtrip():
    secret = "top-secret-key"
    encrypted = encrypt_secret("sk-test-value", secret)
    decrypted = decrypt_secret(encrypted, secret)
    assert decrypted == "sk-test-value"


def test_memory_auth_gateway_roundtrip_and_logout():
    user = AuthenticatedUser(id="user-123", email="user@example.com")
    session = SupabaseSessionPayload(
        access_token="access-token",
        refresh_token="refresh-token",
        expires_at=1_800_000_000,
        expires_in=3600,
        token_type="bearer",
        user=user,
    )
    gateway = MemoryAuthGateway(
        users_by_access_token={session.access_token: user},
        sessions_by_refresh_token={session.refresh_token: session},
    )

    resolved_user = asyncio.run(gateway.verify_access_token(session.access_token))
    assert resolved_user.id == "user-123"

    refreshed = asyncio.run(gateway.refresh_session(session.refresh_token))
    assert refreshed.access_token == session.access_token

    asyncio.run(gateway.logout(session.access_token))

    try:
        asyncio.run(gateway.verify_access_token(session.access_token))
        assert False, "Expected logout to revoke the token"
    except Exception:
        pass


def test_supabase_auth_gateway_logout_uses_local_scope():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status_code=204)

    transport = httpx.MockTransport(handler)
    gateway = SupabaseAuthGateway(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_anon_key="anon-key",
            supabase_secret_key="sb_secret_test_key",
        ),
        transport=transport,
    )

    asyncio.run(gateway.logout("access-token"))

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://example.supabase.co/auth/v1/logout?scope=local"
    assert request.headers["Authorization"] == "Bearer access-token"
    assert request.headers["apikey"] == "anon-key"

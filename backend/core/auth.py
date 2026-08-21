import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Mapping
from typing import Annotated, Any
from uuid import UUID

import httpx
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.core.config import settings
from backend.core.errors import ApiError
from backend.identity.models import AuthenticatedUser

ALLOWED_JWT_ALGORITHMS = ("ES256", "RS256")
AUTH_REQUIRED = ("AUTH_REQUIRED", "로그인이 필요합니다.", 401)
GOOGLE_AUTH_REQUIRED = (
    "GOOGLE_AUTH_REQUIRED",
    "교사 기능은 Google 계정으로 로그인해야 합니다.",
    403,
)

JwksFetcher = Callable[[], Awaitable[dict[str, Any]]]
TimeSource = Callable[[], float]


def _api_error(error: tuple[str, str, int]) -> ApiError:
    return ApiError(*error)


class JwksVerifier:
    def __init__(
        self,
        *,
        supabase_url: str,
        audience: str,
        jwks_url: str | None = None,
        cache_ttl_seconds: int = 300,
        max_cached_keys: int = 16,
        fetch_jwks: JwksFetcher | None = None,
        time_source: TimeSource = time.monotonic,
    ) -> None:
        base_url = supabase_url.rstrip("/")
        self.issuer = f"{base_url}/auth/v1"
        self.jwks_url = jwks_url or f"{self.issuer}/.well-known/jwks.json"
        self.audience = audience
        self.cache_ttl_seconds = min(max(cache_ttl_seconds, 1), 600)
        self.max_cached_keys = min(max(max_cached_keys, 1), 32)
        self._fetch_jwks = fetch_jwks or self._fetch_remote_jwks
        self._time_source = time_source
        self._keys: OrderedDict[str, jwt.PyJWK] = OrderedDict()
        self._cache_expires_at = 0.0
        self._cache_lock = asyncio.Lock()

    @property
    def cached_key_count(self) -> int:
        return len(self._keys)

    async def _fetch_remote_jwks(self) -> dict[str, Any]:
        timeout = httpx.Timeout(5.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.get(self.jwks_url)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict):
            raise TypeError("JWKS response must be an object")
        return data

    def _replace_cached_keys(
        self,
        jwks: Mapping[str, Any],
        *,
        requested_kid: str,
        requested_algorithm: str,
    ) -> None:
        raw_keys = jwks.get("keys")
        if not isinstance(raw_keys, list) or not 1 <= len(raw_keys) <= 64:
            raise ValueError("JWKS must contain a bounded key list")

        parsed: list[tuple[str, jwt.PyJWK]] = []
        requested: tuple[str, jwt.PyJWK] | None = None
        for raw_key in raw_keys:
            if not isinstance(raw_key, dict):
                continue
            kid = raw_key.get("kid")
            algorithm = raw_key.get("alg")
            if (
                not isinstance(kid, str)
                or not kid
                or len(kid) > 128
                or algorithm not in ALLOWED_JWT_ALGORITHMS
                or raw_key.get("use", "sig") != "sig"
            ):
                continue
            key_ops = raw_key.get("key_ops")
            if key_ops is not None and (
                not isinstance(key_ops, list) or "verify" not in key_ops
            ):
                continue
            try:
                jwk = jwt.PyJWK.from_dict(raw_key, algorithm=algorithm)
            except (jwt.PyJWTError, ValueError, TypeError):
                continue
            item = (kid, jwk)
            if kid == requested_kid and algorithm == requested_algorithm:
                requested = item
            else:
                parsed.append(item)

        if requested is not None:
            parsed.append(requested)

        self._keys.clear()
        for kid, key in parsed:
            self._keys[kid] = key
            self._keys.move_to_end(kid)
            while len(self._keys) > self.max_cached_keys:
                self._keys.popitem(last=False)
        self._cache_expires_at = self._time_source() + self.cache_ttl_seconds

    async def _get_signing_key(self, kid: str, algorithm: str) -> jwt.PyJWK:
        async with self._cache_lock:
            now = self._time_source()
            if now >= self._cache_expires_at:
                self._keys.clear()

            cached = self._keys.get(kid)
            if cached is not None and cached.algorithm_name == algorithm:
                self._keys.move_to_end(kid)
                return cached

            if now < self._cache_expires_at:
                raise ValueError("Unknown signing key")

            jwks = await self._fetch_jwks()
            self._replace_cached_keys(
                jwks,
                requested_kid=kid,
                requested_algorithm=algorithm,
            )
            key = self._keys.get(kid)
            if key is None or key.algorithm_name != algorithm:
                raise ValueError("Unknown signing key")
            return key

    async def verify(self, token: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(token)
            algorithm = header.get("alg")
            kid = header.get("kid")
            if algorithm not in ALLOWED_JWT_ALGORITHMS:
                raise ValueError("JWT algorithm is not allowed")
            if not isinstance(kid, str) or not kid or len(kid) > 128:
                raise ValueError("JWT signing key identifier is invalid")

            signing_key = await self._get_signing_key(kid, algorithm)
            return jwt.decode(
                token,
                signing_key,
                algorithms=list(ALLOWED_JWT_ALGORITHMS),
                audience=self.audience,
                issuer=self.issuer,
                options={"require": ["aud", "email", "exp", "iss", "sub"]},
            )
        except ApiError:
            raise
        except (httpx.HTTPError, jwt.PyJWTError, KeyError, TypeError, ValueError):
            raise _api_error(AUTH_REQUIRED) from None


def extract_current_provider(claims: Mapping[str, Any]) -> str:
    app_metadata = claims.get("app_metadata")
    if not isinstance(app_metadata, Mapping):
        raise _api_error(AUTH_REQUIRED)
    provider = app_metadata.get("provider")
    if not isinstance(provider, str) or not provider.strip():
        raise _api_error(AUTH_REQUIRED)
    return provider.strip().lower()


bearer = HTTPBearer(auto_error=False)
jwt_verifier = JwksVerifier(
    supabase_url=settings.supabase_url,
    audience=settings.supabase_jwt_audience,
    jwks_url=settings.supabase_jwks_url,
    cache_ttl_seconds=settings.supabase_jwks_cache_ttl_seconds,
)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer)
    ] = None,
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _api_error(AUTH_REQUIRED)

    claims = await jwt_verifier.verify(credentials.credentials)
    try:
        user_id = UUID(claims["sub"])
        email = claims["email"]
        if not isinstance(email, str) or not email.strip():
            raise ValueError("Email claim is invalid")
        provider = extract_current_provider(claims)
    except (KeyError, TypeError, ValueError):
        raise _api_error(AUTH_REQUIRED) from None

    return AuthenticatedUser(
        user_id=user_id,
        email=email.strip().lower(),
        provider=provider,
        email_verified=bool(
            claims.get("email_confirmed_at") or claims.get("email_verified") is True
        ),
    )


async def require_google_user(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> AuthenticatedUser:
    if user.provider != "google":
        raise _api_error(GOOGLE_AUTH_REQUIRED)
    return user

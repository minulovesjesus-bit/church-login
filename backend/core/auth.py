import asyncio
import hashlib
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
AuthUserFetcher = Callable[[str], Awaitable[dict[str, Any]]]
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
        failed_refresh_backoff_seconds: int = 5,
        fetch_jwks: JwksFetcher | None = None,
        time_source: TimeSource = time.monotonic,
    ) -> None:
        base_url = supabase_url.rstrip("/")
        self.issuer = f"{base_url}/auth/v1"
        self.jwks_url = jwks_url or f"{self.issuer}/.well-known/jwks.json"
        self.audience = audience
        self.cache_ttl_seconds = min(max(cache_ttl_seconds, 1), 600)
        self.max_cached_keys = min(max(max_cached_keys, 1), 32)
        self.failed_refresh_backoff_seconds = min(
            max(failed_refresh_backoff_seconds, 1), 30
        )
        self._fetch_jwks = fetch_jwks or self._fetch_remote_jwks
        self._time_source = time_source
        self._keys: OrderedDict[str, jwt.PyJWK] = OrderedDict()
        self._cache_expires_at = 0.0
        self._refresh_failed_until = 0.0
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

            if now < self._refresh_failed_until:
                raise ValueError("JWKS refresh is temporarily unavailable")

            try:
                jwks = await self._fetch_jwks()
                self._replace_cached_keys(
                    jwks,
                    requested_kid=kid,
                    requested_algorithm=algorithm,
                )
            except (httpx.HTTPError, jwt.PyJWTError, KeyError, TypeError, ValueError):
                self._refresh_failed_until = (
                    self._time_source() + self.failed_refresh_backoff_seconds
                )
                raise
            self._refresh_failed_until = 0.0
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


class SupabaseAuthUserResolver:
    def __init__(
        self,
        *,
        supabase_url: str,
        publishable_key: str | None,
        timeout_seconds: float = 5,
        cache_ttl_seconds: int = 30,
        max_cached_users: int = 512,
        failed_request_backoff_seconds: int = 5,
        fetch_auth_user: AuthUserFetcher | None = None,
        http_client: httpx.AsyncClient | None = None,
        time_source: TimeSource = time.monotonic,
    ) -> None:
        self.auth_user_url = f"{supabase_url.rstrip('/')}/auth/v1/user"
        self.publishable_key = publishable_key
        self.timeout_seconds = min(max(float(timeout_seconds), 0.5), 10.0)
        self.cache_ttl_seconds = min(max(cache_ttl_seconds, 1), 60)
        self.max_cached_users = min(max(max_cached_users, 1), 2048)
        self.failed_request_backoff_seconds = min(
            max(failed_request_backoff_seconds, 1), 30
        )
        self._fetch_auth_user = fetch_auth_user or self._fetch_remote_auth_user
        self._http_client = http_client
        self._time_source = time_source
        self._users: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
        self._inflight: dict[str, asyncio.Task[dict[str, Any]]] = {}
        self._shared_failure_backoff_until = 0.0
        self._cache_lock = asyncio.Lock()

    async def _request_auth_user(
        self, client: httpx.AsyncClient, token: str
    ) -> dict[str, Any]:
        if not self.publishable_key:
            raise ValueError("Supabase publishable key is not configured")
        response = await client.get(
            self.auth_user_url,
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": self.publishable_key,
            },
            timeout=httpx.Timeout(self.timeout_seconds),
        )
        response.raise_for_status()
        if response.status_code != 200:
            raise ValueError("Supabase Auth returned an unexpected response")
        data = response.json()
        if not isinstance(data, dict):
            raise TypeError("Supabase Auth user must be an object")
        return data

    async def _fetch_remote_auth_user(self, token: str) -> dict[str, Any]:
        if self._http_client is not None:
            return await self._request_auth_user(self._http_client, token)
        async with httpx.AsyncClient(follow_redirects=False) as client:
            return await self._request_auth_user(client, token)

    async def _clear_inflight(
        self,
        token_digest: str,
        task: asyncio.Task[dict[str, Any]],
    ) -> None:
        if not task.cancelled():
            task.exception()
        async with self._cache_lock:
            if self._inflight.get(token_digest) is task:
                del self._inflight[token_digest]

    async def _cached_user_or_fetch_task(
        self, token_digest: str, token: str
    ) -> dict[str, Any] | asyncio.Task[dict[str, Any]]:
        async with self._cache_lock:
            now = self._time_source()
            cached = self._users.get(token_digest)
            if cached is not None:
                expires_at, user = cached
                if now < expires_at:
                    self._users.move_to_end(token_digest)
                    return dict(user)
                del self._users[token_digest]

            task = self._inflight.get(token_digest)
            if task is not None:
                return task
            if now < self._shared_failure_backoff_until:
                raise ValueError("Supabase Auth is temporarily unavailable")
            if len(self._inflight) >= self.max_cached_users:
                raise ValueError("Too many Auth user lookups are in flight")

            task = asyncio.create_task(self._fetch_auth_user(token))
            self._inflight[token_digest] = task
            task.add_done_callback(
                lambda completed: asyncio.create_task(
                    self._clear_inflight(token_digest, completed)
                )
            )
            return task

    async def resolve(self, token: str) -> dict[str, Any]:
        token_digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        try:
            cached_or_task = await self._cached_user_or_fetch_task(
                token_digest, token
            )
            if isinstance(cached_or_task, dict):
                return cached_or_task

            user = await asyncio.shield(cached_or_task)
            if not isinstance(user, dict):
                raise TypeError("Supabase Auth user must be an object")
            async with self._cache_lock:
                self._shared_failure_backoff_until = 0.0
                self._users[token_digest] = (
                    self._time_source() + self.cache_ttl_seconds,
                    dict(user),
                )
                self._users.move_to_end(token_digest)
                while len(self._users) > self.max_cached_users:
                    self._users.popitem(last=False)
                return dict(user)
        except ApiError:
            raise
        except httpx.HTTPStatusError as error:
            status_code = error.response.status_code
            if status_code == 429 or 500 <= status_code <= 599:
                async with self._cache_lock:
                    self._shared_failure_backoff_until = (
                        self._time_source() + self.failed_request_backoff_seconds
                    )
            raise _api_error(AUTH_REQUIRED) from None
        except httpx.TransportError:
            async with self._cache_lock:
                self._shared_failure_backoff_until = (
                    self._time_source() + self.failed_request_backoff_seconds
                )
            raise _api_error(AUTH_REQUIRED) from None
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            raise _api_error(AUTH_REQUIRED) from None


def extract_current_provider(
    claims: Mapping[str, Any], auth_user: Mapping[str, Any]
) -> str:
    amr = claims.get("amr")
    if not isinstance(amr, list):
        raise _api_error(AUTH_REQUIRED)
    methods = [
        entry.get("method").strip().lower()
        for entry in amr
        if isinstance(entry, Mapping)
        and isinstance(entry.get("method"), str)
        and entry.get("method").strip()
    ]
    if not methods:
        raise _api_error(AUTH_REQUIRED)

    auth_user_id = auth_user.get("id")
    identities = auth_user.get("identities")
    has_google_identity = isinstance(identities, list) and any(
        isinstance(identity, Mapping)
        and identity.get("provider") == "google"
        and identity.get("user_id") == auth_user_id
        for identity in identities
    )
    if "oauth" in methods and has_google_identity:
        return "google"
    return methods[0]


bearer = HTTPBearer(auto_error=False)
jwt_verifier = JwksVerifier(
    supabase_url=settings.supabase_url,
    audience=settings.supabase_jwt_audience,
    jwks_url=settings.supabase_jwks_url,
    cache_ttl_seconds=settings.supabase_jwks_cache_ttl_seconds,
)
auth_user_resolver = SupabaseAuthUserResolver(
    supabase_url=settings.supabase_url,
    publishable_key=settings.supabase_publishable_key,
)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer)
    ] = None,
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _api_error(AUTH_REQUIRED)

    token = credentials.credentials
    claims = await jwt_verifier.verify(token)
    auth_user = await auth_user_resolver.resolve(token)
    try:
        user_id = UUID(claims["sub"])
        if UUID(auth_user["id"]) != user_id:
            raise ValueError("Auth user does not match JWT subject")
        email = auth_user["email"]
        if not isinstance(email, str) or not email.strip():
            raise ValueError("Email claim is invalid")
        provider = extract_current_provider(claims, auth_user)
    except (KeyError, TypeError, ValueError):
        raise _api_error(AUTH_REQUIRED) from None

    email_confirmed_at = auth_user.get("email_confirmed_at")

    return AuthenticatedUser(
        user_id=user_id,
        email=email.strip().lower(),
        provider=provider,
        email_verified=isinstance(email_confirmed_at, str)
        and bool(email_confirmed_at.strip()),
    )


async def require_google_user(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> AuthenticatedUser:
    if user.provider != "google":
        raise _api_error(GOOGLE_AUTH_REQUIRED)
    return user

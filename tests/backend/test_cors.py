import httpx

from backend.core.config import settings


async def test_configured_frontend_origin_receives_explicit_cors_headers(
    client: httpx.AsyncClient,
) -> None:
    origin = settings.allowed_frontend_origins[0]

    response = await client.options(
        "/api/me",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == origin
    assert response.headers["Access-Control-Allow-Credentials"] == "true"
    assert response.headers["Vary"] == "Origin"


async def test_unconfigured_frontend_origin_receives_no_allow_origin_header(
    client: httpx.AsyncClient,
) -> None:
    response = await client.options(
        "/api/me",
        headers={
            "Origin": "https://attacker.example.test",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "Access-Control-Allow-Origin" not in response.headers

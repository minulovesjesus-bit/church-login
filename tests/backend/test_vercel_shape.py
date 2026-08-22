from pathlib import Path

import httpx

from api.index import app as vercel_app
from backend.main import app as backend_app


def test_vercel_entrypoint_exports_the_single_backend_asgi_app() -> None:
    api_files = sorted(Path("api").glob("*.py"))

    assert api_files == [Path("api/index.py")]
    assert vercel_app is backend_app


async def test_vercel_asgi_shape_routes_health_and_protects_database_routes() -> None:
    transport = httpx.ASGITransport(app=vercel_app)
    async with httpx.AsyncClient(
        transport=transport, base_url="https://deployment.example.test"
    ) as client:
        health = await client.get("/api/health")
        protected = await client.get("/api/teacher/students")

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert protected.status_code == 401
    assert protected.json()["error"]["code"] == "AUTH_REQUIRED"

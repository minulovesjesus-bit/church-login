from fastapi import FastAPI

app = FastAPI(title="Church Attendance API")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

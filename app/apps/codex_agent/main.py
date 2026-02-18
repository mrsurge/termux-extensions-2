from fastapi import APIRouter

codex_agent_bp = APIRouter()


@codex_agent_bp.get("/")
async def status():
    return {"ok": True, "data": {"message": "codex_agent backend ready"}}

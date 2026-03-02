from fastapi import APIRouter

example_proxy_shell_bp = APIRouter()


@example_proxy_shell_bp.get("/")
async def status():
    return {"ok": True, "data": {"message": "example_proxy_shell_app backend ready"}}

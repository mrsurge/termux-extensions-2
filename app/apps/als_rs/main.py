from fastapi import APIRouter

als_rs_bp = APIRouter()


@als_rs_bp.get("/")
async def status():
    return {"ok": True, "data": {"message": "ALS-RS backend ready"}}

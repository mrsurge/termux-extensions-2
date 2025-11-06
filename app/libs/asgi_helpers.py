from fastapi import HTTPException
from typing import Any, Dict

def success_response(data: Any, status_code: int = 200) -> Dict:
    """Standard success response"""
    return {"ok": True, "data": data}

def error_response(message: str, status_code: int = 400):
    """Standard error response"""
    raise HTTPException(status_code=status_code, detail=message)

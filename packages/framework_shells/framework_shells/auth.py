import hashlib
import hmac
import json
import os
from typing import Optional

def get_secret() -> str:
    """Get secret from environment, raise if missing."""
    secret = os.environ.get("FRAMEWORK_SHELLS_SECRET", "")
    if not secret:
        raise RuntimeError("FRAMEWORK_SHELLS_SECRET is required")
    return secret

def derive_runtime_id(secret: str) -> str:
    """sha256(secret)[:16] — namespace identifier."""
    return hashlib.sha256(secret.encode()).hexdigest()[:16]

def derive_api_token(secret: str) -> str:
    """HMAC(secret, 'api') — bearer token for mutations."""
    return hmac.new(secret.encode(), b"api", hashlib.sha256).hexdigest()

def sign_record(secret: str, record_dict: dict) -> str:
    """HMAC signature over canonical JSON (excludes signature field)."""
    clean = {k: v for k, v in record_dict.items() if k != "signature"}
    canonical = json.dumps(clean, sort_keys=True, separators=(",", ":"))
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

def verify_record(secret: str, record_dict: dict) -> bool:
    """Verify record signature matches."""
    expected = sign_record(secret, record_dict)
    return hmac.compare_digest(record_dict.get("signature", ""), expected)

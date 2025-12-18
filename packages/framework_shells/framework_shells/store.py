from pathlib import Path
from typing import Optional
import os
import hashlib

from .auth import get_secret, derive_runtime_id


def _compute_fingerprint_from_cwd() -> str:
    cwd = Path.cwd().resolve()
    return hashlib.sha256(str(cwd).encode("utf-8")).hexdigest()[:16]

def _default_base_dir() -> Path:
    return Path.home() / ".cache" / "framework_shells"


class RuntimeStore:
    """Namespaced storage paths for a framework runtime."""
    
    def __init__(self, base_dir: Optional[Path] = None):
        self.secret = get_secret()
        self.runtime_id = derive_runtime_id(self.secret)
        
        base = (
            base_dir
            or (Path(os.path.expanduser(os.environ["FRAMEWORK_SHELLS_BASE_DIR"])).resolve() if os.environ.get("FRAMEWORK_SHELLS_BASE_DIR") else None)
            or _default_base_dir()
        )
        fingerprint = os.environ.get("FRAMEWORK_SHELLS_REPO_FINGERPRINT")
        if not fingerprint:
            if os.getenv("FRAMEWORK_SHELLS_ALLOW_NO_FINGERPRINT"):
                fingerprint = "standalone_debug"
            else:
                fingerprint = _compute_fingerprint_from_cwd()
                os.environ["FRAMEWORK_SHELLS_REPO_FINGERPRINT"] = fingerprint

        self.root = base / "runtimes" / fingerprint / self.runtime_id
        self.metadata_dir = self.root / "meta"
        self.logs_dir = self.root / "logs"
        self.sockets_dir = self.root / "sockets"
        
        for d in (self.metadata_dir, self.logs_dir, self.sockets_dir):
            d.mkdir(parents=True, exist_ok=True)

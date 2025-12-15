from pathlib import Path
from typing import Optional
import os

from .auth import get_secret, derive_runtime_id

class RuntimeStore:
    """Namespaced storage paths for a framework runtime."""
    
    def __init__(self, base_dir: Optional[Path] = None):
        self.secret = get_secret()
        self.runtime_id = derive_runtime_id(self.secret)
        
        base = base_dir or Path.home() / ".cache" / "te_framework"
        fingerprint = os.environ.get("TE_REPO_FINGERPRINT")
        # In standalone CLI usage, fingerprint might need to be computed or
        # allow a fallback if we want to run without the wrapper script.
        # But per plan, we enforce strict prerequisites.
        if not fingerprint:
             # Try to compute it if we are in a recognizable repo
             # This is a bit tricky for a pipx installed package.
             # Let's rely on the env var being set or raise validation error.
             if not os.environ.get("TE_REPO_FINGERPRINT"):
                 # ONE LAST CHANCE: If configured to allow loose mode (e.g. testing)
                 if os.getenv("FRAMEWORK_SHELLS_ALLOW_NO_FINGERPRINT"):
                      fingerprint = "standalone_debug"
                 else:
                      raise RuntimeError("TE_REPO_FINGERPRINT environment variable is required")

        self.root = base / "runtimes" / fingerprint / self.runtime_id
        self.metadata_dir = self.root / "meta"
        self.logs_dir = self.root / "logs"
        self.sockets_dir = self.root / "sockets"
        
        for d in (self.metadata_dir, self.logs_dir, self.sockets_dir):
            d.mkdir(parents=True, exist_ok=True)

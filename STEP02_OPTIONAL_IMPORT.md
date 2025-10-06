# Step 2 — Optional / Conditional Imports Inside Endpoints

**New file:** `app/utils/optional_import.py`

```python
# app/utils/optional_import.py
import importlib, types, traceback

class MissingModule(types.SimpleNamespace):
    def __init__(self, name, err):
        super().__init__(__missing__=True, __name__=name, __error__=repr(err), __trace__=traceback.format_exc())

def optional_import(name: str):
    try:
        return importlib.import_module(name)
    except BaseException as e:
        return MissingModule(name, e)
```

**Example usage:**
```python
from flask import Blueprint, jsonify
from app.utils.optional_import import optional_import

bp = Blueprint("opt_demo", __name__)

@bp.get("/optional_demo/pil_info")
def pil_info():
    PIL = optional_import("PIL")
    if getattr(PIL, "__missing__", False):
        return jsonify({"ok": False, "error": f"Dependency {PIL.__name__} unavailable: {PIL.__error__}"}), 500
    return jsonify({"ok": True, "data": {"version": getattr(PIL, "__version__", "unknown")}})
```

Next → `STEP03_WORKER_FALLBACK.md`

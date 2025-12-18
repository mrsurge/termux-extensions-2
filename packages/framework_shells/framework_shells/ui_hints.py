import json
from pathlib import Path
from typing import Dict, Any, Union

def load_ui_hints(apps_dir: Union[str, Path]) -> Dict[str, Any]:
    """Load framework shell UI hints from app manifests in a directory."""
    apps_dir = Path(apps_dir)
    out: Dict[str, Any] = {}
    
    if not apps_dir.exists():
        return out
        
    for entry in apps_dir.iterdir():
        if not entry.is_dir():
            continue
            
        manifest_path = entry / "manifest.json"
        if not manifest_path.exists():
            continue
            
        try:
            with open(manifest_path, "r", encoding="utf-8") as fh:
                manifest = json.load(fh)
        except Exception:
            continue
            
        app_id = manifest.get("id") or entry.name
        ui = manifest.get("framework_shell_ui")
        
        if isinstance(ui, dict) and ui:
            out[app_id] = ui
            
    return out

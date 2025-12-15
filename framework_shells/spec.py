from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Union
import yaml
from pathlib import Path

@dataclass
class ShellSpec:
    """Declarative specification for a framework shell."""
    name: str # Acts as the stable ID key
    command: Union[str, List[str]]
    cwd: Optional[str] = None
    env: Dict[str, str] = field(default_factory=dict)
    autostart: bool = True
    backend: str = "pty" # subprocess, pty, dtach
    ui: Dict[str, Any] = field(default_factory=dict)
    # Lifecycle
    restart: str = "always" # always, on-failure, no
    
    @classmethod
    def from_dict(cls, name: str, data: Dict[str, Any]) -> "ShellSpec":
        return cls(
            name=name,
            command=data.get("command"),
            cwd=data.get("cwd"),
            env=data.get("env", {}),
            autostart=data.get("autostart", True),
            backend=data.get("backend", "pty"),
            ui=data.get("ui", {}),
            restart=data.get("restart", "always")
        )

def load_specs(path: Union[str, Path]) -> List[ShellSpec]:
    path = Path(path)
    if not path.exists():
        return []
    
    with open(path, "r") as f:
        data = yaml.safe_load(f)
        
    specs = []
    if not data or not isinstance(data, dict):
        return specs
        
    # Format: 
    # shells:
    #   my-shell:
    #     command: ...
    roots = data.get("shells", {})
    for name, config in roots.items():
        specs.append(ShellSpec.from_dict(name, config))
        
    return specs

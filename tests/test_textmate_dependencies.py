from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import cast

from app.apps.code_te2.textmate_dependencies import Rule, resolve_dependencies


def test_reachable_dependencies_match_real_textmate() -> None:
    grammars: dict[str, Rule] = {
        "source.root": {
            "scopeName": "source.root",
            "patterns": [{"include": "#entry"}, {"include": "source.partial#used"},
                         {"include": "source.cycle"}],
            "repository": {"entry": {"patterns": [{"include": "source.child"}]},
                           "unused": {"include": "source.unused"}},
        },
        "source.partial": {"scopeName": "source.partial", "patterns": [{"include": "source.unused"}],
                           "repository": {"used": {"patterns": [{"include": "source.leaf"}, {"include": "$base"}]}}},
        "source.child": {"scopeName": "source.child", "patterns": [{"include": "#local"}],
                         "repository": {"local": {"include": "source.leaf"}}},
        "source.cycle": {"scopeName": "source.cycle", "patterns": [{"include": "$self"}, {"include": "source.root"}]},
        "source.leaf": {"scopeName": "source.leaf", "patterns": []},
        "source.injection": {"scopeName": "source.injection", "patterns": [{"include": "source.leaf"}]},
        "source.unused": {"scopeName": "source.unused", "patterns": []},
    }
    injection_map = {"source.root": ["source.injection"]}
    actual = resolve_dependencies("source.root", grammars.get, lambda scope: injection_map.get(scope, []))
    script = r"""
const fs = require('fs');
const tm = require('./app/apps/code_te2/vendor/vscode-textmate/release/main.js');
const {grammars, injections} = JSON.parse(fs.readFileSync(0, 'utf8'));
const loaded = [];
const registry = new tm.Registry({onigLib: Promise.resolve({}),
 getInjections: scope => injections[scope] || [],
 loadGrammar: async scope => { if (!grammars[scope]) return null; loaded.push(scope); return grammars[scope]; }});
registry.loadGrammar('source.root').then(() => { console.log(JSON.stringify(loaded)); registry.dispose(); });
"""
    result = subprocess.run(["node", "-e", script], cwd=Path(__file__).resolve().parents[1],
                            input=json.dumps({"grammars": grammars, "injections": injection_map}),
                            capture_output=True, text=True, check=True, timeout=15)
    expected = cast(list[str], json.loads(result.stdout))
    assert actual == expected
    assert "source.unused" not in actual


def test_nested_repository_overrides_and_missing_optional_scope() -> None:
    root: Rule = {"scopeName": "source.root", "repository": {"local": {"include": "source.unused"}},
                  "patterns": [{"repository": {"local": {"include": "source.used"}},
                                "patterns": [{"include": "#local"}, {"include": "source.missing"}]}]}
    grammars: dict[str, Rule] = {"source.root": root, "source.used": {"scopeName": "source.used", "patterns": []}}
    assert resolve_dependencies("source.root", grammars.get, lambda _: []) == ["source.root", "source.used"]

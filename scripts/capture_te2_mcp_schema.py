"""Capture current tool discovery in disposable roots, never the live console."""
from __future__ import annotations
import argparse
import asyncio
import json
import os
from pathlib import Path
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser()
    _ = parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    scratch = Path(os.environ.get('TMPDIR', str(Path.cwd() / '.codex-scratch')))
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='mcp-schema-', dir=scratch) as root:
        os.environ['TE2_CACHE_HOME'] = root
        os.environ['TE2_CONFIG_HOME'] = root + '/config'
        os.environ['TE2_DATA_HOME'] = root + '/data'
        from app.te2_mcp.server import build_server
        async def capture() -> list[dict[str, object]]:
            tools = await build_server().list_tools()
            return [tool.to_mcp_tool().model_dump(mode='json', exclude_none=True, by_alias=True) for tool in tools]
        tools = asyncio.run(capture())
        tools.sort(key=lambda tool: str(tool['name']))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({'tools': tools}, indent=2) + '\n', encoding='utf-8')
        print(f'Captured {len(tools)} tool definitions: {args.output}')


if __name__ == '__main__':
    main()

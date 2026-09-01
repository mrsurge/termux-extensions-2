from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.apps.code_te2.explorer.services import search_sessions


def test_name_search_hydrates_all_matching_directories_in_one_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []

    async def emit_personal(
        method: str,
        payload: dict[str, object],
        reply_to: str | None = None,
    ) -> None:
        _ = method, payload, reply_to
        return None

    async def build_directory_listings(
        rels: list[str],
        *,
        project_root: Path | None = None,
        project_generation: int | None = None,
    ) -> list[dict[str, object]]:
        calls.append(list(rels))
        assert project_root == Path("/workspace/project")
        assert project_generation == 3
        return [
            {
                "cwd": rel,
                "entries": [
                    {
                        "rel": f"{rel}/child.py",
                        "name": "child.py",
                        "kind": "file",
                    }
                ],
            }
            for rel in rels
        ]

    monkeypatch.setattr(
        search_sessions,
        "build_directory_listings",
        build_directory_listings,
    )
    manager = search_sessions.ExplorerSearchSessions(
        get_project_root=lambda: Path("/workspace/project"),
        emit_personal=emit_personal,
    )
    session = search_sessions.SearchSession(
        search_id="search-1",
        job_id="job-1",
        kind="name",
        root=Path("/workspace/project"),
        project_generation=3,
        correlation_id="correlation-1",
        query="code",
        name_items=[
            search_sessions.CachedNameItem(
                path="/workspace/project/src",
                relative_path="src",
                kind="dir",
                name="src",
            ),
            search_sessions.CachedNameItem(
                path="/workspace/project/tests",
                relative_path="tests",
                kind="dir",
                name="tests",
            ),
            search_sessions.CachedNameItem(
                path="/workspace/project/main.py",
                relative_path="main.py",
                kind="file",
                name="main.py",
            ),
        ],
    )

    asyncio.run(manager._hydrate_name_directory_listings(session))
    asyncio.run(manager._hydrate_name_directory_listings(session))

    assert calls == [["src", "tests"]]
    payload = manager._visible_payload(session)
    assert payload["shallowListings"] == [
        {
            "cwd": "src",
            "entries": [
                {"rel": "src/child.py", "name": "child.py", "kind": "file"}
            ],
        },
        {
            "cwd": "tests",
            "entries": [
                {"rel": "tests/child.py", "name": "child.py", "kind": "file"}
            ],
        },
    ]

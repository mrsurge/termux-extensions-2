"""Reachable TextMate dependencies, matching the pinned ScopeDependencyProcessor.

No tokenization/regex compilation: Python resolves transport resources only.
Full/partial repository requests, nested repositories, $base/$self and injections
retain the pinned vscode-textmate semantics. Tests compare against its real loader.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import cast

Rule = dict[str, object]
Reference = tuple[str, str | None]


def record(value: object) -> Rule:
    return cast(Rule, value) if isinstance(value, dict) else {}


def rules(value: object) -> list[Rule]:
    return [record(cast(object, item)) for item in cast(list[object], value) if isinstance(item, dict)] if isinstance(value, list) else []


def resolve_dependencies(
    root_scope: str,
    load: Callable[[str], Rule | None],
    injections: Callable[[str], list[str]],
) -> list[str]:
    loaded: dict[str, Rule | None] = {}
    order: list[str] = []
    full: set[str] = {root_scope}
    partial: set[Reference] = set()
    queue: list[Reference] = [(root_scope, None)]
    work = 0
    while queue:
        for scope, _ in queue:
            if scope not in loaded:
                loaded[scope] = load(scope)
                if loaded[scope] is not None:
                    order.append(scope)
        root_grammar = loaded.get(root_scope)
        if root_grammar is None:
            raise ValueError("textmate_root_grammar_missing")
        base: Rule = root_grammar
        refs: list[Reference] = []
        seen_refs: set[Reference] = set()
        visited: set[int] = set()

        def add(scope: str, rule: str | None = None) -> None:
            reference = (scope, rule)
            if reference not in seen_refs:
                seen_refs.add(reference)
                refs.append(reference)

        def top(grammar: Rule, depth: int) -> None:
            repository = record(grammar.get("repository"))
            walk(rules(grammar.get("patterns")), grammar, repository, depth + 1)
            walk([record(item) for item in record(grammar.get("injections")).values()], grammar, repository, depth + 1)

        def relative(name: str, grammar: Rule, repository: Rule, depth: int) -> None:
            value = repository.get(name)
            if isinstance(value, dict):
                walk([record(cast(object, value))], grammar, repository, depth + 1)

        def walk(items: list[Rule], grammar: Rule, repository: Rule, depth: int) -> None:
            nonlocal work
            if depth > 256:
                raise ValueError("textmate_dependency_depth_exceeded")
            for item in items:
                if id(item) in visited:
                    continue
                visited.add(id(item))
                work += 1
                if work > 250_000:
                    raise ValueError("textmate_dependency_work_exceeded")
                nested = {**repository, **record(item.get("repository"))}
                walk(rules(item.get("patterns")), grammar, nested, depth + 1)
                include = item.get("include")
                if not isinstance(include, str) or not include:
                    continue
                if include == "$base":
                    top(base, depth + 1)
                elif include == "$self":
                    top(grammar, depth + 1)
                elif include.startswith("#"):
                    relative(include[1:], grammar, nested, depth + 1)
                else:
                    scope, separator, name = include.partition("#")
                    target = grammar if scope == grammar.get("scopeName") else base if scope == base.get("scopeName") else None
                    if target is None:
                        add(scope, name if separator else None)
                    elif separator:
                        relative(name, target, nested, depth + 1)
                    else:
                        top(target, depth + 1)

        for scope, name in queue:
            grammar = loaded.get(scope)
            if grammar is None:
                continue
            if name is None:
                top(grammar, 0)
            else:
                relative(name, grammar, record(grammar.get("repository")), 0)
            for injected in injections(scope):
                add(injected)
        queue = []
        for reference in refs:
            scope, name = reference
            if scope in full:
                continue
            if name is None:
                full.add(scope)
            elif reference in partial:
                continue
            else:
                partial.add(reference)
            queue.append(reference)
    return order

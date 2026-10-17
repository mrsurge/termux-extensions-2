"""Short shared-state/main-page references and exact live presentation proofs."""
from __future__ import annotations

import json
import re
import secrets
import string
from collections.abc import Callable
from dataclasses import dataclass
from typing import cast

JsonObject = dict[str, object]
PREF_KEY = "sidebarIdentityReferences"
SHORT_ID = re.compile(r"^[A-Za-z0-9]{4}$")


def _object(value: object) -> JsonObject:
    return cast(JsonObject, value) if isinstance(value, dict) else {}


@dataclass(frozen=True)
class MainPage:
    client_id: str
    window_id: str
    page_id: str


@dataclass(frozen=True)
class SidebarPresentation:
    sid: str
    page: MainPage
    host_id: str
    incarnation: str
    state_id: str
    qualified_id: str

    def payload(self) -> JsonObject:
        return {"mainPageId": self.page.page_id, "sidebarStateId": self.state_id,
                "sidebarWindowId": self.qualified_id}


class SidebarIdentities:
    def __init__(self, read: Callable[[], JsonObject], write: Callable[[JsonObject], None]) -> None:
        self.read = read
        self.write = write
        self.pages: dict[str, MainPage] = {}
        self.presentations: dict[str, SidebarPresentation] = {}

    def _reference(self, kind: str, key: str) -> str:
        refs = self.read()
        entries = _object(refs.get(kind))
        existing = entries.get(key)
        if isinstance(existing, str) and SHORT_ID.fullmatch(existing):
            if sum(value == existing for value in entries.values()) != 1:
                raise ValueError("duplicate persisted sidebar short reference")
            return existing
        if len(entries) >= 4096:
            raise ValueError("sidebar short-reference capacity reached")
        used = set(str(value) for value in entries.values())
        for _ in range(128):
            candidate = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(4))
            if candidate not in used:
                entries[key] = candidate
                self.write({**refs, "version": 1, kind: entries})
                return candidate
        raise ValueError("sidebar short-reference allocation failed")

    def register_page(self, sid: str, client_id: str, window_id: str) -> MainPage:
        if not client_id or not window_id:
            raise ValueError("main page requires client and window identity")
        key = json.dumps([client_id, window_id], separators=(',', ':'))
        page = MainPage(client_id, window_id, self._reference("mainPages", key))
        previous = self.pages.get(sid)
        if previous is not None and previous != page:
            self.disconnect(sid)
        self.pages[sid] = page
        return page

    def qualify(self, sid: str, host_id: str, incarnation: str, app_id: str) -> SidebarPresentation:
        page = self.pages[sid]
        state_id = self._reference("states", host_id)
        prefix = re.sub(r'[^A-Za-z0-9_-]', '_', app_id)
        qualified_id = f'{prefix}:{state_id}.{page.page_id}'
        receipt = SidebarPresentation(sid, page, host_id, incarnation, state_id, qualified_id)
        self.presentations[qualified_id] = receipt
        return receipt

    def validate(self, target: JsonObject) -> SidebarPresentation | None:
        qualified_id = str(target.get("sidebarWindowId") or "").strip()
        page_id = str(target.get("mainPageId") or "").strip()
        if not qualified_id and not page_id:
            return None  # Explicit compatibility for previously loaded clients.
        receipt = self.presentations.get(qualified_id)
        if (receipt is None or self.pages.get(receipt.sid) != receipt.page
                or page_id != receipt.page.page_id
                or str(target.get("clientId") or target.get("client_id") or "") != receipt.page.client_id
                or str(target.get("hostId") or target.get("host_id") or "") != receipt.host_id
                or str(target.get("presentationId") or target.get("presentation_id") or "") != receipt.incarnation):
            raise ValueError("sidebar window identity is stale or belongs to another main page")
        return receipt

    def forget(self, sid: str, host_id: str) -> None:
        for key, receipt in list(self.presentations.items()):
            if receipt.sid == sid and receipt.host_id == host_id:
                self.presentations.pop(key)

    def disconnect(self, sid: str) -> None:
        self.pages.pop(sid, None)
        for key, receipt in list(self.presentations.items()):
            if receipt.sid == sid:
                self.presentations.pop(key)


def _read_references() -> JsonObject:
    from ..stores import get_preferences_store
    return _object(_object(get_preferences_store().get_preferences().get("ui")).get(PREF_KEY))


def _write_references(value: JsonObject) -> None:
    from ..stores import get_preferences_store
    get_preferences_store().update_preferences(ui={PREF_KEY: value})


sidebar_identities = SidebarIdentities(_read_references, _write_references)

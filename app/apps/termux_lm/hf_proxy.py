"""Hugging Face search helper used by Termux-LM."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any, Dict, List

HF_ENDPOINT = "https://huggingface.co/api/models"
GGUF_EXTENSIONS = {".gguf"}


def search_hf_models(query: str, limit: int = 40) -> List[Dict[str, Any]]:
    """Return a list of GGUF models for the given query."""
    params = {
        "search": query,
        "limit": limit,
        "full": "1",
        "sort": "downloads",
    }
    url = f"{HF_ENDPOINT}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if not isinstance(payload, list):
        return []

    results: List[Dict[str, Any]] = []
    for item in payload:
        files = item.get("siblings") or []
        gguf_files = []
        for file_entry in files:
            name = file_entry.get("rfilename") or file_entry.get("filename")
            if not isinstance(name, str):
                continue
            if not any(name.endswith(ext) for ext in GGUF_EXTENSIONS):
                continue
            gguf_files.append({
                "name": name,
                "size": file_entry.get("size"),
                "sha": file_entry.get("sha256"),
            })
        if not gguf_files:
            continue
        results.append({
            "id": item.get("id"),
            "modelId": item.get("modelId") or item.get("id"),
            "author": item.get("author"),
            "files": gguf_files,
            "downloads": item.get("downloads"),
        })
    return results


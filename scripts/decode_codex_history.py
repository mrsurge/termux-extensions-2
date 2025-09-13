#!/usr/bin/env python3
"""
Decode Codex CLI history .jsonl files into readable text.

Usage:
  python scripts/decode_codex_history.py <file1.jsonl> [<file2.jsonl> ...] \
      [-o OUTPUT_DIR] [--include-token-count] [--fernet-key KEY | --fernet-key-file PATH]

Outputs a human-readable combined text file per input under OUTPUT_DIR
(`decoded/` by default), named <basename>.txt.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Union
import os

try:
    from cryptography.fernet import Fernet
except Exception:  # optional, used only if available / provided
    Fernet = None  # type: ignore


def deep_json_parse(value: Any, max_depth: int = 3) -> Any:
    """Attempt to parse JSON from a string up to max_depth times.

    - If value is not a string, returns it unchanged.
    - If value is a JSON string of an object/array, returns the parsed object.
    - If value is a JSON string of a string (nested quoting), continues until
      an object/array is obtained or depth is exhausted.
    - On any parsing error, returns the original string.
    """
    if not isinstance(value, str):
        return value

    s: str = value
    for _ in range(max_depth):
        try:
            parsed = json.loads(s)
        except Exception:
            return s

        # If we parsed to a non-string (dict/list/number/bool/null), return it
        if not isinstance(parsed, str):
            return parsed

        # If we parsed to a string, try another round (handles nested quotes)
        s = parsed

    return s


def pretty_json(obj: Any) -> str:
    try:
        return json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True)
    except Exception:
        return str(obj)


def summarize_token_count(payload: dict) -> str:
    info = payload.get("info", {}) if isinstance(payload, dict) else {}
    total = info.get("total_token_usage", {})
    last = info.get("last_token_usage", {})
    parts = []
    if total:
        parts.append(
            f"total_tokens={total.get('total_tokens')} input={total.get('input_tokens')} "
            f"cached={total.get('cached_input_tokens')} output={total.get('output_tokens')}"
        )
    if last:
        parts.append(
            f"last_total={last.get('total_tokens')} last_input={last.get('input_tokens')} "
            f"last_cached={last.get('cached_input_tokens')} last_output={last.get('output_tokens')}"
        )
    return "; ".join(parts) if parts else pretty_json(payload)


def try_get_fernet_from_env():
    if Fernet is None:
        return None
    for key_name in ("CODEX_FERNET_KEY", "CODEX_ENCRYPTION_KEY", "CODEX_HISTORY_KEY"):
        key = os.environ.get(key_name)
        if key:
            try:
                return Fernet(key)
            except Exception:
                pass
    return None


def decode_line(obj: dict, include_token_count: bool, fernet=None) -> str:
    ts = obj.get("timestamp", "")
    top_type = obj.get("type", "")
    payload = obj.get("payload", {})

    # Handle event messages
    if top_type == "event_msg":
        ptype = payload.get("type") if isinstance(payload, dict) else None
        if ptype == "token_count":
            if not include_token_count:
                return ""
            summary = summarize_token_count(payload)
            return f"[{ts}] token_count: {summary}\n"
        # Unknown event message type
        return f"[{ts}] event: {pretty_json(payload)}\n"

    # Handle response items
    if top_type == "response_item":
        if not isinstance(payload, dict):
            return f"[{ts}] response_item: {pretty_json(payload)}\n"

        ptype = payload.get("type")

        # Decrypt encrypted content if present
        if isinstance(payload, dict) and payload.get("encrypted_content") is not None:
            enc_raw = payload.get("encrypted_content")
            token = deep_json_parse(enc_raw)
            decrypted = None
            if isinstance(token, str) and fernet is not None:
                try:
                    decrypted_bytes = fernet.decrypt(token.encode("utf-8"))
                    decrypted = decrypted_bytes.decode("utf-8", errors="replace")
                except Exception:
                    decrypted = None

            if decrypted is not None:
                as_json = deep_json_parse(decrypted)
                body = pretty_json(as_json) if isinstance(as_json, (dict, list)) else str(decrypted)
                return f"[{ts}] decrypted_content ({ptype or 'unknown'}):\n{body}\n\n"
            else:
                tlen = len(token) if isinstance(token, str) else 0
                return f"[{ts}] encrypted_content ({ptype or 'unknown'}): <fernet token, length={tlen}>\n\n"

        # Function call request
        if ptype == "function_call":
            name = payload.get("name", "")
            call_id = payload.get("call_id") or payload.get("id") or ""
            args_raw = payload.get("arguments")
            args = deep_json_parse(args_raw)

            header = f"[{ts}] function_call {name}"
            if call_id:
                header += f" (call_id={call_id})"
            body = pretty_json(args)
            return f"{header}\narguments:\n{body}\n\n"

        # Function call output
        if ptype == "function_call_output":
            call_id = payload.get("call_id") or payload.get("id") or ""
            out_raw = payload.get("output")
            out_obj = deep_json_parse(out_raw)

            # If output decoded to object, try to extract common fields
            if isinstance(out_obj, dict) and ("output" in out_obj or "metadata" in out_obj):
                output_text = out_obj.get("output", "")
                meta = out_obj.get("metadata", {})
                exit_code = meta.get("exit_code")
                duration = meta.get("duration_seconds")
                header = f"[{ts}] function_call_output"
                if call_id:
                    header += f" (call_id={call_id})"
                if exit_code is not None:
                    header += f" exit_code={exit_code}"
                if duration is not None:
                    header += f" duration={duration}s"
                return f"{header}\n--- output ---\n{output_text}\n-------------\n\n"
            else:
                header = f"[{ts}] function_call_output"
                if call_id:
                    header += f" (call_id={call_id})"
                body = out_obj if isinstance(out_obj, str) else pretty_json(out_obj)
                return f"{header}\n{body}\n\n"

        # Generic message or unknown response payload
        content = payload.get("content") or payload.get("text")
        if content:
            return f"[{ts}] message:\n{content}\n\n"

        # Fallback: dump payload
        return f"[{ts}] response_item: {pretty_json(payload)}\n\n"

    # Unknown top-level type
    return f"[{ts}] {top_type}: {pretty_json(payload) if payload else pretty_json(obj)}\n\n"


def process_file(path: Path, out_dir: Path, include_token_count: bool, fernet=None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{path.stem}.txt"

    with path.open("r", encoding="utf-8") as f, out_path.open("w", encoding="utf-8") as out:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception as e:
                out.write(f"[line {line_num}] <unparseable JSON>: {e}\n{line}\n\n")
                continue

            try:
                decoded = decode_line(obj, include_token_count=include_token_count, fernet=fernet)
            except Exception as e:
                out.write(f"[line {line_num}] <decode error>: {e}\n{line}\n\n")
                continue

            if decoded:
                out.write(decoded)

    return out_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Decode Codex CLI history .jsonl to readable text")
    ap.add_argument("files", nargs="+", type=Path, help="Input .jsonl files")
    ap.add_argument("-o", "--output-dir", type=Path, default=Path("decoded"), help="Output directory (default: decoded)")
    ap.add_argument("--include-token-count", action="store_true", help="Include token_count event summaries")
    ap.add_argument("--fernet-key", help="Fernet key used to decrypt encrypted_content (44-char base64)")
    ap.add_argument("--fernet-key-file", type=Path, help="Path to file containing the Fernet key")
    args = ap.parse_args(argv)

    # Prepare Fernet decryptor
    fernet = None
    if Fernet is not None:
        key = None
        if args.fernet_key:
            key = args.fernet_key
        elif args.fernet_key_file:
            try:
                key = args.fernet_key_file.read_text(encoding="utf-8").strip()
            except Exception:
                key = None
        if key:
            try:
                fernet = Fernet(key)
            except Exception:
                fernet = None
        if fernet is None:
            fernet = try_get_fernet_from_env()

    out_paths = []
    for p in args.files:
        if not p.exists():
            print(f"Warning: file not found: {p}")
            continue
        out_paths.append(process_file(p, args.output_dir, include_token_count=args.include_token_count, fernet=fernet))

    if out_paths:
        print("Decoded files:")
        for op in out_paths:
            print(f" - {op}")
        return 0
    else:
        print("No files decoded.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

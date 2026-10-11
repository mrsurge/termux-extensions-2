"""Disposable shell-control feasibility tests, not production integration.

The broker must separately prove it may deliver a Readline wake-up. These
tests prove only the callback's behavior once Bash is accepting input.
"""
from __future__ import annotations

import os
from pathlib import Path
import pty
import select
import subprocess
import time


CALLBACK = r'''
PS1='CONTROL_PROMPT> '
__control_apply() {
    local requested
    # Don't execute or erase unfinished user input.
    [[ -z $READLINE_LINE ]] || return 0
    IFS= read -r -d '' requested < "$CONTROL_REQUEST" || return 0
    builtin cd -- "$requested" || return 0
    printf 'APPLIED:%s\0' "$PWD" > "$CONTROL_ACK"
}
bind -x '"\e[99~":__control_apply'
'''


class Probe:
    def __init__(self, root: Path) -> None:
        startup = root / 'control.bash'
        startup.write_text(CALLBACK)
        self.request = root / 'request'
        self.ack = root / 'ack'
        self.request.write_bytes(b'')
        self.fd, slave = pty.openpty()
        self.child = subprocess.Popen(
            ['bash', '--noprofile', '--init-file', str(startup), '-i'],
            cwd=root, stdin=slave, stdout=slave, stderr=slave,
            env={**os.environ, 'HOME': str(root), 'TERM': 'xterm-256color',
                 'CONTROL_REQUEST': str(self.request), 'CONTROL_ACK': str(self.ack)},
            start_new_session=True,
        )
        os.close(slave)
        self.until(b'CONTROL_PROMPT> ')

    def send(self, data: bytes) -> None:
        os.write(self.fd, data)

    def until(self, marker: bytes) -> bytes:
        result = bytearray()
        deadline = time.monotonic() + 3
        while marker not in result:
            remaining = deadline - time.monotonic()
            assert remaining > 0, bytes(result)
            if select.select([self.fd], [], [], remaining)[0]:
                result.extend(os.read(self.fd, 65536))
        return bytes(result)

    def wait_ack(self) -> bytes:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if self.ack.exists():
                return self.ack.read_bytes()
            time.sleep(.01)
        raise AssertionError('Readline callback did not acknowledge without Enter')

    def close(self) -> None:
        self.child.kill()
        self.child.wait(timeout=3)
        os.close(self.fd)


def test_idle_readline_callback_changes_directory_without_enter(tmp_path: Path) -> None:
    target = tmp_path / "quotes' spaces\n$(must-not-run)"
    target.mkdir()
    probe = Probe(tmp_path)
    try:
        probe.request.write_bytes(os.fsencode(target) + b'\0')
        probe.send(b'\x1b[99~')
        assert probe.wait_ack() == b'APPLIED:' + os.fsencode(target) + b'\0'
        # The ordinary shell remains usable after callback processing.
        probe.send(b"printf 'STILL_ALIVE\\n'\n")
        probe.until(b'STILL_ALIVE\r\n')
    finally:
        probe.close()


def test_readline_callback_preserves_unfinished_input(tmp_path: Path) -> None:
    target = tmp_path / 'target'
    target.mkdir()
    probe = Probe(tmp_path)
    try:
        probe.request.write_bytes(os.fsencode(target) + b'\0')
        probe.send(b"printf 'USER_TEXT=%s\\n' preserved")
        probe.until(b'preserved')
        probe.send(b'\x1b[99~')
        probe.send(b'\n')
        output = probe.until(b'USER_TEXT=preserved\r\n')
        assert b'USER_TEXT=preserved' in output
        assert not probe.ack.exists()
    finally:
        probe.close()


def test_wake_sequence_is_not_safe_to_deliver_to_foreground_program(tmp_path: Path) -> None:
    probe = Probe(tmp_path)
    try:
        probe.send(b"bash -c 'printf BUSY_READY; read -r line; printf \"CHILD_INPUT=%s\\n\" \"$line\"'\n")
        probe.until(b'BUSY_READY')
        # Deliberately demonstrate why transport typing alone is insufficient.
        # This sequence must NOT be delivered by a production broker while busy.
        probe.send(b'\x1b[99~\n')
        output = probe.until(b'CHILD_INPUT=\x1b[99~\r\n')
        assert b'CHILD_INPUT=\x1b[99~' in output
        assert not probe.ack.exists()
    finally:
        probe.close()

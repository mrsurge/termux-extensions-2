"""Isolated Bash feasibility probe; not production shell integration.

Only disposable PTYs/HOME/mailboxes are used. No TE2 runtime is touched.
"""
from __future__ import annotations

import os
from pathlib import Path
import pty
import select
import subprocess
import time

import pytest
from app.apps.file_explorer.directory_tracking import DirectoryTracking


HOOK = """() {
    local previous=$? requested
    if IFS= read -r -d '' requested < "$TE2_PROBE_MAILBOX"; then
        builtin cd -- "$requested"
    fi
    printf '%s\\0' "$PWD" > "$TE2_PROBE_OBSERVED"
    printf 'TE2_PROBE_HOOK\\n'
    return "$previous"
}"""


class BashProbe:
    def __init__(self, root: Path, profile: str = '', inherited: str = '', *, install: bool = True,
                 init_file: bool = False, profile_name: str = '.bash_profile', tracking_root: Path | None = None) -> None:
        self.root = root
        self.mailbox = root / 'desired'
        self.observed = root / 'observed'
        self.mailbox.write_bytes(b'')
        # Cooperative fixture installation AFTER profile loading, not a proposed
        # modification to a real user's startup files. /etc/profile may replace
        # the inherited PROMPT_COMMAND before .bash_profile runs.
        setup = '\nPROMPT_COMMAND=(__te2_probe_hook "${PROMPT_COMMAND[@]}")\n' if install and not init_file and tracking_root is None else ''
        (root / profile_name).write_text(
            "PS1='TE2_PROBE_PROMPT> '; PS2='TE2_PROBE_MORE> '\n" + profile + setup)
        command = ['bash', '-l', '-i']
        if init_file:
            startup = root / 'probe-init.bash'
            startup.write_text('''
if [[ -r /etc/profile ]]; then builtin source /etc/profile; fi
if [[ -r ~/.bash_profile ]]; then builtin source ~/.bash_profile
elif [[ -r ~/.bash_login ]]; then builtin source ~/.bash_login
elif [[ -r ~/.profile ]]; then builtin source ~/.profile
fi
PROMPT_COMMAND=(__te2_probe_hook "${PROMPT_COMMAND[@]}")
''')
            command = ['bash', '--init-file', str(startup), '-i']
        if tracking_root is not None:
            startup = Path(__file__).resolve().parents[1] / 'app/apps/file_explorer/shellspec/directory_tracking.bash'
            command = ['bash', '--init-file', str(startup), '-i']
        self.master, slave = pty.openpty()
        env = {**os.environ, 'HOME': str(root), 'TERM': 'xterm-256color',
               'TE2_PROBE_MAILBOX': str(self.mailbox), 'TE2_PROBE_OBSERVED': str(self.observed),
               'BASH_FUNC___te2_probe_hook%%': HOOK,
               'PROMPT_COMMAND': '__te2_probe_hook' + ('; ' + inherited if inherited else '')}
        if tracking_root is not None:
            env['TE2_DIRECTORY_TRACKING_ROOT'] = str(tracking_root)
        self.process = subprocess.Popen(command, cwd=root, env=env,
                                        stdin=slave, stdout=slave, stderr=slave,
                                        start_new_session=True)
        os.close(slave)
        self.output = bytearray()
        self.until(b'TE2_PROBE_PROMPT> ')

    def until(self, marker: bytes) -> bytes:
        data = bytearray()
        deadline = time.monotonic() + 4
        while marker not in data:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f'Missing {marker!r}: {bytes(data)!r}')
            if select.select([self.master], [], [], remaining)[0]:
                data.extend(os.read(self.master, 65536))
        self.output.extend(data)
        return bytes(data)

    def send(self, command: bytes) -> None:
        _ = os.write(self.master, command)

    def request(self, path: Path) -> None:
        stage = self.root / 'desired.new'
        stage.write_bytes(os.fsencode(path) + b'\0')
        stage.replace(self.mailbox)

    def close(self) -> None:
        self.process.terminate()
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)
        os.close(self.master)


@pytest.mark.parametrize('prior', [
    "PROMPT_COMMAND=\"printf 'PRIOR_STATUS=%s\\\\n' \\\"\\$?\\\"\"\n",
    "PROMPT_COMMAND=(\"printf 'PRIOR_STATUS=%s\\\\n' \\\"\\$?\\\"\")\n",
])
def test_login_profile_and_prior_prompt_status_survive(tmp_path, prior):
    probe = BashProbe(tmp_path, "export TE2_PROBE_PROFILE=loaded\n"
                      + prior)
    try:
        probe.send(b"printf 'PROFILE=%s LOGIN=' \"$TE2_PROBE_PROFILE\"; shopt login_shell; false\n")
        data = probe.until(b'TE2_PROBE_PROMPT> ')
        assert b'PROFILE=loaded LOGIN=login_shell' in data
        assert b'on' in data
        assert b'PRIOR_STATUS=1' in data
    finally:
        probe.close()


def test_foreground_program_and_partial_input_defer_latest_directory(tmp_path):
    first, latest = tmp_path / 'first', tmp_path / "quote' space\n$(not-executed)"
    first.mkdir(); latest.mkdir()
    probe = BashProbe(tmp_path)
    try:
        # Separate foreground Bash process owns input; no injected terminal text.
        probe.send(b"bash -c 'read -r answer; printf \"ANSWER=%s\\n\" \"$answer\"'\n")
        probe.until(b'printf')
        probe.request(first); probe.request(latest)
        assert probe.observed.read_bytes() == os.fsencode(tmp_path) + b'\0'
        probe.send(b'unchanged\n')
        data = probe.until(b'TE2_PROBE_PROMPT> ')
        assert b'ANSWER=unchanged' in data
        assert probe.observed.read_bytes() == os.fsencode(latest) + b'\0'
        probe.send(b"printf 'PARTIAL_%s\\n' ")
        probe.until(b'PARTIAL_')
        probe.request(first)
        assert probe.observed.read_bytes() == os.fsencode(latest) + b'\0'
        probe.send(b'intact\n')
        data = probe.until(b'TE2_PROBE_PROMPT> ')
        assert b'PARTIAL_intact' in data
        assert probe.observed.read_bytes() == os.fsencode(first) + b'\0'
    finally:
        probe.close()


@pytest.mark.parametrize('profile', [
    "PROMPT_COMMAND=\"printf 'USER_SCALAR\\\\n'\"\n",
    "PROMPT_COMMAND=(\"printf 'USER_ARRAY\\\\n'\")\n",
])
def test_profile_replacement_requires_explicit_unavailable_state(tmp_path, profile):
    probe = BashProbe(tmp_path, profile, install=False)
    try:
        # Do not silently overwrite user hooks or claim directory lock works.
        assert b'USER_' in probe.output
        assert b'TE2_PROBE_HOOK' not in probe.output
        assert not probe.observed.exists()
    finally:
        probe.close()


@pytest.mark.parametrize('profile_name', ['.bash_profile', '.bash_login', '.profile'])
def test_init_file_uses_first_login_profile_once_without_login_flag(tmp_path, profile_name):
    names = ['.bash_profile', '.bash_login', '.profile']
    for later in names[names.index(profile_name) + 1:]:
        (tmp_path / later).write_text("printf 'WRONG_PROFILE\\n'\n")
    probe = BashProbe(tmp_path, "printf 'RIGHT_PROFILE\\n'\n", init_file=True, profile_name=profile_name)
    try:
        assert probe.output.count(b'RIGHT_PROFILE') == 1
        assert b'WRONG_PROFILE' not in probe.output
        assert b'TE2_PROBE_HOOK' in probe.output
        probe.send(b'shopt login_shell\n')
        data = probe.until(b'TE2_PROBE_PROMPT> ')
        assert b'off' in data
    finally:
        probe.close()


@pytest.mark.parametrize('profile', [
    "PROMPT_COMMAND=\"printf 'USER_SCALAR\\\\n'\"\n",
    "PROMPT_COMMAND=(\"printf 'USER_ARRAY\\\\n'\")\n",
])
def test_init_file_installs_after_user_hook_replacement(tmp_path, profile):
    target = tmp_path / 'directory'
    target.mkdir()
    probe = BashProbe(tmp_path, profile, init_file=True)
    try:
        assert b'USER_' in probe.output
        assert b'TE2_PROBE_HOOK' in probe.output
        probe.request(target)
        probe.send(b'false\n')
        probe.until(b'TE2_PROBE_PROMPT> ')
        assert probe.observed.read_bytes() == os.fsencode(target) + b'\0'
    finally:
        probe.close()


def test_production_hook_applies_once_preserves_manual_cd_and_cancels_pending(tmp_path):
    tracking = DirectoryTracking(tmp_path / 'tracking')
    identity = tracking.create()
    first, manual = tmp_path / "first 'quoted'\n$(literal)", tmp_path / 'manual'
    first.mkdir(); manual.mkdir()
    probe = BashProbe(tmp_path, tracking_root=tracking.directory(identity))
    try:
        assert tracking.status(identity, True)['state'] == 'ready'
        tracking.request(identity, 2, str(first))
        assert tracking.status(identity, True)['state'] == 'pending'
        probe.send(b'true\n'); probe.until(b'TE2_PROBE_PROMPT> ')
        assert tracking.status(identity, True) == {'state': 'applied', 'path': str(first)}
        # Manual cd is never reverted just because another prompt appears.
        probe.send(b'cd ../manual; pwd\n'); probe.until(b'TE2_PROBE_PROMPT> ')
        probe.send(b'pwd\n')
        assert os.fsencode(manual) in probe.until(b'TE2_PROBE_PROMPT> ')
        # A foreground process retains its input. Only newest unconsumed request
        # is eligible; unlock publishes cancellation before it returns to prompt.
        probe.send(b"bash -c 'read -r answer; printf \"UNCHANGED=%s\\n\" \"$answer\"'\n")
        probe.until(b'printf')
        tracking.request(identity, 3, str(first))
        tracking.request(identity, 4, None)
        probe.send(b'still-input\n')
        assert b'UNCHANGED=still-input' in probe.until(b'TE2_PROBE_PROMPT> ')
        assert tracking.status(identity, True) == {'state': 'ready', 'path': str(manual)}
        # Missing directory reports a shell error, not success or retry.
        tracking.request(identity, 5, str(tmp_path / 'missing'))
        probe.send(b'true\n'); probe.until(b'TE2_PROBE_PROMPT> ')
        assert tracking.status(identity, True) == {'state': 'error', 'path': str(manual)}
        probe.send(b'true\n')
        assert b'No such file' not in probe.until(b'TE2_PROBE_PROMPT> ')
    finally:
        probe.close()

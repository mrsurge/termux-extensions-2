import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { encodePipeFrame, PipeFrameDecoder } from './terminal_stream_protocol.mjs';

test('opt-in broker coordinates idle cd, partial input and busy builtins without PTY commands', { timeout: 20_000 }, async () => {
  const scratch = process.env.TMPDIR || path.resolve('../../../.codex-scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'terminal-control-test-'));
  const target = path.join(root, "quotes' spaces\n$(literal)");
  const second = path.join(root, 'second');
  fs.mkdirSync(target); fs.mkdirSync(second);
  fs.writeFileSync(path.join(root, '.bash_profile'), "PS1='BROKER_PROMPT> '\n");
  const child = spawn(process.execPath, ['terminal_stream_broker.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: root, TERMINAL_STREAM_CWD: root,
      TERMINAL_STREAM_DIRECTORY_CONTROL: '1', TERMINAL_STREAM_CONTROL_ROOT: root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const decoder = new PipeFrameDecoder();
  const messages = [];
  let stderr = '', output = '';
  child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  child.stdout.on('data', bytes => {
    for (const message of decoder.push(bytes)) {
      messages.push(message);
      if (message.type === 'output') output += Buffer.from(message.data).toString();
    }
  });
  const send = message => child.stdin.write(encodePipeFrame(message));
  const input = text => {
    // Prompt regeneration adds a real idle event. Do not mistake a previously
    // observed prompt for completion of this new user command.
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].type === 'shell.state' && messages[index].state === 'idle') messages.splice(index, 1);
    }
    send({ type: 'input', data: Buffer.from(text) });
  };
  async function wait(predicate, label) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      if (child.exitCode !== null) throw new Error(`early exit ${child.exitCode}: ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`timeout ${label}: ${JSON.stringify(messages.filter(message => message.type !== 'output'))} stderr=${stderr} outputTail=${JSON.stringify(output.slice(-1200))}`);
  }
  const state = value => wait(message => message.type === 'shell.state' && message.state === value, value);
  async function outputContains(text) {
    const deadline = Date.now() + 3000;
    while (!output.includes(text)) {
      assert.ok(Date.now() < deadline, `missing output: ${text}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  const result = (id, value) => wait(message => message.type === 'directory.result'
    && message.request_id === id && message.state === value, `${id}:${value}`);
  try {
    await state('idle');
    send({ type: 'directory.request', request_id: 'idle', path: target });
    assert.equal((await result('idle', 'applied')).cwd, target);

    // Any partially typed line defers cd without erasing/executing that line.
    input("printf 'PRESERVED=%s\\n' original");
    send({ type: 'directory.request', request_id: 'partial', path: second });
    await result('partial', 'pending');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(messages.some(message => message.request_id === 'partial' && message.state === 'applied'), false);
    input('\n');
    assert.equal((await result('partial', 'applied')).cwd, second);
    await state('idle');
    assert.ok(output.includes('PRESERVED=original'));

    // Bash read is a builtin: no child-process heuristic could detect this.
    input("printf 'READ_READY\\n'; read -r answer; printf 'ANSWER=%s\\n' \"$answer\"\n");
    await state('busy');
    send({ type: 'directory.request', request_id: 'builtin', path: root });
    await result('builtin', 'pending');
    input('untouched\n');
    assert.equal((await result('builtin', 'applied')).cwd, root);
    await state('idle');
    assert.ok(output.includes('ANSWER=untouched'));

    input("bash -c 'printf CHILD_READY; read -r answer; printf \"CHILD_ANSWER=%s\\n\" \"$answer\"'\n");
    await state('busy');
    send({ type: 'directory.request', request_id: 'child', path: second });
    await result('child', 'pending');
    input('unmodified\n');
    assert.equal((await result('child', 'applied')).cwd, second);
    await state('idle');
    assert.ok(output.includes('CHILD_ANSWER=unmodified'));

    send({ type: 'directory.request', request_id: 'missing', path: path.join(root, 'absent') });
    await result('missing', 'error');
    // Manual cd remains authoritative until another explicit request.
    input(`cd '${root.replaceAll("'", "'\\''")}'; printf 'MANUAL_CWD=%s\\n' "$PWD"\n`);
    await state('idle');
    assert.ok(output.includes('MANUAL_CWD=' + root));
    for (let index = 0; index < 12; index += 1) {
      const destination = index % 2 ? root : second;
      const id = `repeat-${index}`;
      send({ type: 'directory.request', request_id: id, path: destination });
      assert.equal((await result(id, 'applied')).cwd, destination);
    }
    // Input following a wake request is held until its acknowledgment, not
    // interleaved with the shell-control operation.
    send({ type: 'directory.request', request_id: 'ordered', path: root });
    input("printf 'ORDERED_CWD=%s\\n' \"$PWD\"\n");
    await result('ordered', 'applied');
    await state('idle');
    await outputContains('ORDERED_CWD=' + root);
  } finally {
    if (child.exitCode === null) {
      send({ type: 'destroy' });
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const starship of [false, true]) {
  test(`directory change regenerates ${starship ? 'Starship' : 'PROMPT_COMMAND'} prompt`,
    { timeout: 12_000, skip: starship && spawnSync('starship', ['--version']).status !== 0 }, async () => {
      const scratch = process.env.TMPDIR || path.resolve('../../../.codex-scratch');
      fs.mkdirSync(scratch, { recursive: true });
      const root = fs.mkdtempSync(path.join(scratch, 'prompt-refresh-'));
      const target = path.join(root, 'PROMPT_TARGET');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(root, '.bash_profile'), starship
        ? 'eval "$(starship init bash --print-full-init)"\n'
        : '__test_prompt() { PS1="CWD=$PWD> "; }; PROMPT_COMMAND=__test_prompt\n');
      const config = path.join(root, 'starship.toml');
      fs.writeFileSync(config, "format = '$directory$character'\nadd_newline = false\n[directory]\ntruncation_length = 0\ntruncate_to_repo = false\n");
      const child = spawn(process.execPath, ['terminal_stream_broker.mjs'], {
        env: { ...process.env, HOME: root, STARSHIP_CONFIG: config, TERMINAL_STREAM_CWD: root,
          TERMINAL_STREAM_DIRECTORY_CONTROL: '1', TERMINAL_STREAM_CONTROL_ROOT: root },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const decoder = new PipeFrameDecoder();
      let output = '', idle = 0, checkpoint, errors = '';
      const visible = text => text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
      child.stderr.on('data', bytes => { errors += bytes; });
      child.stdout.on('data', bytes => {
        for (const message of decoder.push(bytes)) {
          if (message.type === 'output') output += Buffer.from(message.data).toString();
          if (message.type === 'shell.state' && message.state === 'idle') idle += 1;
          if (message.type === 'checkpoint') checkpoint = fs.readFileSync(message.logPath).subarray(0, message.outputOffset).toString();
        }
      });
      const send = message => child.stdin.write(encodePipeFrame(message));
      async function until(predicate) {
        const deadline = Date.now() + 4000;
        while (!predicate()) {
          assert.ok(Date.now() < deadline, `prompt refresh timeout: ${JSON.stringify(output)} ${errors}`);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      try {
        await until(() => idle > 0);
        send({ type: 'directory.request', request_id: 'idle-prompt', path: target });
        await until(() => visible(output).includes('PROMPT_TARGET'));
        send({ type: 'attach', request_id: 'checkpoint' });
        await until(() => checkpoint !== undefined);
        assert.ok(visible(checkpoint).includes('PROMPT_TARGET'), checkpoint);
        // Deferred application must precede custom prompt computation too.
        send({ type: 'input', data: Buffer.from("printf 'PARTIAL_DONE\\n'") });
        send({ type: 'directory.request', request_id: 'deferred-prompt', path: root });
        const before = idle;
        send({ type: 'input', data: Buffer.from('\n') });
        await until(() => idle > before);
        checkpoint = undefined;
        send({ type: 'attach', request_id: 'checkpoint-2' });
        await until(() => checkpoint !== undefined);
        // The active final prompt, not an OSC cwd notification or old scrollback.
        await until(() => visible(output).trimEnd().endsWith(starship ? '~ ❯' : `CWD=${root}>`));
        checkpoint = undefined;
        send({ type: 'attach', request_id: 'checkpoint-3' });
        await until(() => checkpoint !== undefined);
        assert.ok(visible(checkpoint).trimEnd().endsWith(starship ? '~ ❯' : `CWD=${root}>`), checkpoint);
      } finally {
        if (child.exitCode === null) {
          send({ type: 'destroy' });
          await new Promise(resolve => {
            const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
          });
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
}

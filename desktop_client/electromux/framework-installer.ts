import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {OwnedChildSupervisor} from '../../vendor/electromux/runtime/src/child-supervisor';
import {OutputPump} from '../../vendor/electromux/runtime/src/output-pump';

const INSTALLER_URL = 'https://github.com/mrsurge/termux-extensions-2/releases/latest/download/install-te2';
export type InstallationState = {
  phase: 'idle' | 'downloading' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
  processId: number | null; output: string; error: string | null; exitCode: number | null;
};
export type InstallerOptions = {
  environment: NodeJS.ProcessEnv;
  changed: () => void;
  // Native/test injection only; no renderer-selected URL, path or command.
  download?: (signal: AbortSignal) => Promise<Uint8Array>;
};

async function downloadBootstrap(signal: AbortSignal): Promise<Uint8Array> {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  let url = new URL(INSTALLER_URL), response: Response | undefined;
  for (let redirects = 0; redirects <= 8; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Installer redirect must use credential-free HTTPS');
    response = await fetch(url, {signal: boundedSignal, redirect: 'manual'});
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 8) throw new Error('Installer redirect failed');
    url = new URL(location, url);
  }
  if (!response?.ok || !response.body)
    throw new Error(`Installer download failed (${response?.status ?? 'no response'})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Installer bootstrap exceeds 2MiB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('Installer bootstrap is empty');
  return Buffer.concat(chunks);
}

/** One explicit installer operation; no framework PID/control ownership. */
export class FrameworkInstaller {
  private value: InstallationState = {phase: 'idle', processId: null, output: '', error: null, exitCode: null};
  private supervisor: OwnedChildSupervisor | undefined;
  private operation: Promise<void> | undefined;
  private closed = false;
  constructor(private readonly options: InstallerOptions) {}
  snapshot(): InstallationState { return {...this.value}; }
  active(): boolean { return this.operation !== undefined; }
  discovered(found: boolean): void {
    if (this.value.phase !== 'succeeded') return;
    this.update(found ? {output: 'TE2 installed. Ready to start.', error: null} :
      {phase: 'failed', error: 'Installer finished but TE2 was not found on PATH. Review Settings before retrying.'});
  }
  private update(values: Partial<InstallationState>): void {
    this.value = {...this.value, ...values};
    if (!this.closed) this.options.changed();
  }
  start(): Promise<void> {
    if (this.closed || this.active()) throw new Error('Installer already active or closed');
    const owner = new OwnedChildSupervisor(); this.supervisor = owner;
    this.update({phase: 'downloading', processId: null, output: 'Downloading the TE2 installer', error: null, exitCode: null});
    const operation = owner.run(async signal => {
      const environment = {...this.options.environment};
      const temporaryRoot = environment.TMPDIR;
      const prefix = environment.PREFIX;
      if (!temporaryRoot || !isAbsolute(temporaryRoot) || !prefix || !isAbsolute(prefix))
        throw new Error('Installer needs native Termux prefix and temporary directory');
      const root = await mkdtemp(join(temporaryRoot, 'te2-electromux-install-'));
      try {
        const bootstrap = await (this.options.download || downloadBootstrap)(signal);
        signal.throwIfAborted();
        const entry = join(root, 'install-te2');
        await writeFile(entry, bootstrap, {mode: 0o600});
        signal.throwIfAborted();
        for (const key of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'NODE_OPTIONS', 'NODE_PATH',
          'TE2_RELEASE_REPOSITORY', 'TE2_RELEASE_TAG', 'TE2_RELEASE_BASE_URL', 'TE2_INSTALL_PYTHON']) delete environment[key];
        environment.DEBIAN_FRONTEND = 'noninteractive';
        const code = await this.runChild(join(prefix, 'bin', 'sh'), entry, root, environment, signal);
        if (code !== 0) throw new Error(`TE2 installer exited with status ${code}`);
        signal.throwIfAborted();
        this.update({phase: 'succeeded', output: 'Installation finished; checking for TE2'});
      } finally { await rm(root, {recursive: true, force: true}); }
    }).catch((error: unknown) => {
      const cancelled = this.value.phase === 'cancelling' || this.closed;
      this.update({phase: cancelled ? 'cancelled' : 'failed', processId: null,
        error: cancelled ? 'Installation cancelled. Partial changes may remain; no rollback was performed.' :
          (error instanceof Error ? error.message : String(error)).slice(-2048)});
    }).finally(() => {
      this.supervisor = undefined; this.operation = undefined;
      this.update({processId: null});
    });
    this.operation = operation;
    return operation;
  }
  private runChild(shell: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(shell, [entry, '--yes'], {cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
      let failure: Error | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const partial = {stdout: '', stderr: ''};
      const decoders = {stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8')};
      const output = new OutputPump(async (lane, bytes) => {
        const lines = (partial[lane] + decoders[lane].write(bytes)).split(/\r\n|\r|\n/);
        partial[lane] = (lines.pop() || '').slice(-2048);
        this.update({output: (partial[lane] || lines.at(-1) || '').slice(-2048)});
      });
      const kill = (kind: NodeJS.Signals) => {
        if (!child.pid) return;
        try { process.kill(-child.pid, kind); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(kind); }
      };
      const abort = () => {
        kill('SIGTERM');
        escalation ||= setTimeout(() => kill('SIGKILL'), 2000);
      };
      const fail = (error: unknown) => {
        failure ||= error instanceof Error ? error : new Error(String(error)); kill('SIGKILL');
      };
      this.update({phase: 'running', processId: child.pid || null});
      child.once('error', fail);
      for (const [lane, stream] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
        if (!stream) { fail(new Error('Installer output pipe missing')); continue; }
        stream.on('error', fail);
        stream.on('data', (bytes: Buffer) => {
          stream.pause();
          void output.push(lane, bytes).then(() => stream.resume()).catch(fail);
        });
      }
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
      child.once('close', (code) => { void (async () => {
        signal.removeEventListener('abort', abort);
        if (escalation) clearTimeout(escalation);
        kill('SIGKILL'); // Reap remaining descendants, including after leader exit.
        try { await output.drain(); } catch (error) { failure ||= error instanceof Error ? error : new Error(String(error)); }
        this.update({exitCode: code, processId: null});
        if (signal.aborted) reject(new Error('Installer cancelled'));
        else if (failure) reject(failure);
        else resolve(code);
      })(); });
    });
  }
  async cancel(): Promise<void> {
    if (!this.operation) return;
    this.update({phase: 'cancelling'});
    await this.supervisor?.dispose();
    await this.operation;
  }
  async dispose(): Promise<void> { this.closed = true; await this.cancel(); }
}

import { jobRecordDto, actionError, type JobRecord, type JobMetadata, type JobMessage } from './action_types';
import { objectDto } from './api';

export interface JobProgress { completed?: number; total?: number; detail?: string }
interface ResultEntry { destination?: string; source_parent?: string }
interface JobResult { destination?: string; succeeded?: ResultEntry[]; failed?: unknown[] }
export interface ObservedJob extends JobRecord { status: string; type?: string; progress?: JobProgress; result?: JobResult }
export interface JobNotification {
  id: string; title: string; message: string;
  variant: 'info' | 'success' | 'warning' | 'error'; status: string;
  progress?: JobProgress;
  actions: Array<{ label: string; onClick(): Promise<void> }>;
  onDismiss(): void;
}
export interface JobsOptions {
  client: unknown;
  eventSourceAvailable: boolean;
  currentPath(): string;
  refresh(): void | Promise<void>;
  fetch: typeof fetch;
  notify(notification: JobNotification): void;
  dismiss(id: string): void;
  toast(message: string): void;
  onError?(error: unknown): void;
  cleanupDelayMs?: number;
}
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const statuses = new Set(['pending', 'running', ...terminal]);
type Callable = (...args: unknown[]) => unknown;
function callable(value: unknown): value is Callable { return typeof value === 'function'; }
function optionalString(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid job ${label}`);
  return value;
}
function optionalNumber(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid job ${label}`);
  return value;
}
export function observedJobDto(value: unknown): ObservedJob {
  const raw = jobRecordDto(value);
  if (!raw.status || !statuses.has(raw.status)) throw new Error('Invalid job status');
  const job: ObservedJob = { ...raw, status: raw.status };
  const type = optionalString(raw.type, 'type');
  if (type !== undefined) job.type = type; else delete job.type;
  if (raw.progress != null) {
    const progress = objectDto(raw.progress, 'job progress');
    job.progress = { completed: optionalNumber(progress.completed, 'completed'), total: optionalNumber(progress.total, 'total'), detail: optionalString(progress.detail, 'progress detail') };
  } else delete job.progress;
  if (raw.result != null) {
    const result = objectDto(raw.result, 'job result');
    const output: JobResult = { destination: optionalString(result.destination, 'result destination') };
    if (result.succeeded != null) {
      if (!Array.isArray(result.succeeded)) throw new Error('Invalid job succeeded result');
      output.succeeded = result.succeeded.map(value => {
        const entry = objectDto(value, 'job succeeded entry');
        return { destination: optionalString(entry.destination, 'entry destination'), source_parent: optionalString(entry.source_parent, 'entry source parent') };
      });
    }
    if (result.failed != null) {
      if (!Array.isArray(result.failed)) throw new Error('Invalid job failed result');
      output.failed = [...result.failed];
    }
    job.result = output;
  } else delete job.result;
  return job;
}
interface Feed { start(): void; stop(): void; isRunning(): boolean }
function feedDto(value: unknown): Feed | null {
  if (value == null) return null;
  const raw = objectDto(value, 'job feed');
  const { start, stop, isRunning } = raw;
  if (!callable(start) || !callable(stop) || !callable(isRunning)) throw new Error('Invalid job feed methods');
  return { start: () => { start.call(value); }, stop: () => { stop.call(value); }, isRunning: () => isRunning.call(value) === true };
}
interface Tracking { meta: JobMetadata; lastStatus: string; cleaned: boolean; timer?: ReturnType<typeof setTimeout>; job: ObservedJob }
export function createJobsController(options: JobsOptions) {
  const shared = options.client && typeof options.client === 'object' && !Array.isArray(options.client) ? objectDto(options.client, 'jobs client') : {};
  const client = callable(shared.createJobClient)
    ? objectDto(shared.createJobClient('/api/app/file_explorer/jobs'), 'app jobs client') : shared;
  let poller: Feed | null = null, stream: Feed | null = null, suspended = false, disposed = false;
  let feedEpoch = 0;
  const jobs = new Map<string, Tracking>();
  const report = (error: unknown): void => { options.onError?.(error); };
  const available = (): boolean => callable(client.createJobPoller) || callable(client.createJobStream);
  const live = (): boolean => !disposed && !suspended;
  function stopFeeds(): void { feedEpoch++; stream?.stop(); stream = null; poller?.stop(); poller = null; }
  function maybeStop(): void { if (!jobs.size) stopFeeds(); }
  function deleteRecord(job: ObservedJob): void {
    if (!terminal.has(job.status) || !callable(client.deleteJob)) return;
    try { Promise.resolve(client.deleteJob.call(options.client, job.id)).catch(report); } catch (error) { report(error); }
  }
  function remove(id: string, deletion: boolean): void {
    const info = jobs.get(id); if (!info) return;
    clearTimeout(info.timer); jobs.delete(id);
    if (deletion && live()) deleteRecord(info.job);
    maybeStop();
  }
  function message(template: JobMessage | undefined, job: ObservedJob, fallback: string): string {
    if (typeof template === 'string' && template.trim()) return template;
    if (typeof template === 'function') { try { return template(job) || fallback; } catch (error) { report(error); } }
    return fallback;
  }
  function resultCounts(job: ObservedJob) { return { failures: job.result?.failed?.length ?? 0, successes: job.result?.succeeded?.length ?? 0 }; }
  function completedMessage(job: ObservedJob, meta: JobMetadata, short: boolean): string {
    const { failures, successes } = resultCounts(job);
    return failures ? successes ? `${successes} completed, ${failures} failed.` : 'Operation completed with errors.'
      : meta.destination ? `Completed → ${meta.destination}` : short ? 'Completed.' : 'Operation completed.';
  }
  function cleanup(job: ObservedJob, info: Tracking): void {
    if (info.cleaned || !live()) return;
    info.cleaned = true;
    const meta = info.meta;
    const text = job.status === 'succeeded' ? message(meta.successToast ?? meta.successMessage, job, job.message || completedMessage(job, meta, false))
      : job.status === 'failed' ? message(meta.failureToast ?? meta.failureMessage, job, job.error || 'Job failed.')
      : message(meta.cancelToast ?? meta.cancelMessage, job, job.message || 'Job cancelled.');
    if (text) options.toast(text);
    if (job.status === 'succeeded') {
      const targets = new Set(meta.refreshOnSuccess ?? []);
      if (meta.destination) targets.add(meta.destination); if (job.result?.destination) targets.add(job.result.destination);
      for (const entry of job.result?.succeeded ?? []) { if (entry.destination) targets.add(entry.destination); if (entry.source_parent) targets.add(entry.source_parent); }
      if (targets.has(options.currentPath())) Promise.resolve(options.refresh()).catch(report);
    }
    scheduleRemoval(job, info);
  }
  function scheduleRemoval(job: ObservedJob, info: Tracking): void {
    clearTimeout(info.timer);
    info.timer = setTimeout(() => {
      info.timer = undefined;
      if (!live() || jobs.get(job.id) !== info) return;
      options.dismiss(job.id); remove(job.id, true);
    }, options.cleanupDelayMs ?? 4000);
  }
  function notify(job: ObservedJob, info: Tracking): void {
    if (!live()) return;
    info.job = job;
    const meta = info.meta, { failures, successes } = resultCounts(job);
    const title = meta.title || (meta.type === 'archive-extract' ? `Extract ${meta.archiveName || meta.archivePath?.split('/').pop() || 'archive'}`
      : meta.type === 'bulk-copy' ? 'Copy items' : meta.type === 'bulk-move' ? 'Move items' : job.type || 'Background task');
    let variant: JobNotification['variant'] = 'info';
    let text = job.message || message(meta.runningMessage, job, meta.destination ? `→ ${meta.destination}` : 'Working…');
    if (job.status === 'succeeded') { variant = failures ? successes ? 'warning' : 'error' : 'success'; text = job.message || message(meta.successMessage, job, completedMessage(job, meta, true)); }
    else if (job.status === 'failed') { variant = 'error'; text = job.error || message(meta.failureMessage, job, 'Job failed.'); }
    else if (job.status === 'cancelled') { variant = 'warning'; text = job.message || message(meta.cancelMessage, job, 'Job cancelled.'); }
    const actions: JobNotification['actions'] = [];
    if (job.status === 'running' || job.status === 'pending') actions.push({ label: 'Cancel', onClick: async () => {
      if (!live() || !callable(client.cancelJob)) return;
      try { await client.cancelJob.call(options.client, job.id); if (live()) options.toast('Cancellation requested.'); }
      catch (error) { if (live()) options.toast(actionError(error, 'Failed to cancel job.')); }
    } });
    options.notify({ id: job.id, title, message: text, variant, status: job.status, progress: job.progress, actions, onDismiss: () => { if (live()) remove(job.id, true); } });
    if (terminal.has(job.status) && (info.lastStatus !== job.status || !info.cleaned)) cleanup(job, info);
    info.lastStatus = job.status;
  }
  function updates(raw: unknown, partial: boolean): void {
    if (!live()) return;
    try {
      if (!Array.isArray(raw)) throw new Error('Invalid job update list');
      const incoming = raw.map(observedJobDto), lookup = new Map(incoming.map(job => [job.id, job]));
      for (const [id, info] of jobs) {
        const job = lookup.get(id);
        if (job) notify(job, info);
        else if (!partial) { options.dismiss(id); remove(id, false); }
      }
    } catch (error) { report(error); }
  }
  function startPoller(): void {
    if (!live() || !jobs.size || !callable(client.createJobPoller)) return;
    const epoch = feedEpoch;
    try {
      if (!poller) poller = feedDto(client.createJobPoller.call(options.client, { onUpdate: (raw: unknown) => { if (epoch === feedEpoch) updates(raw, false); }, onError: report }));
      if (!poller?.isRunning()) poller?.start();
    } catch (error) { report(error); }
  }
  function subscribe(): void {
    if (!live() || !jobs.size || stream?.isRunning() || poller?.isRunning()) return;
    const epoch = feedEpoch;
    if (options.eventSourceAvailable && callable(client.createJobStream)) {
      try {
        stream = feedDto(client.createJobStream.call(options.client, {
          onUpdate: (raw: unknown, config: unknown = {}) => { if (epoch !== feedEpoch) return; try { updates(raw, objectDto(config, 'job update options').partial === true); } catch (error) { report(error); } },
          onError: (error: unknown) => { if (epoch !== feedEpoch || !live()) return; report(error); stream?.stop(); stream = null; feedEpoch++; startPoller(); },
        }));
        stream?.start();
        if (stream?.isRunning()) return;
      } catch (error) { report(error); stream?.stop(); stream = null; }
    }
    startPoller();
  }
  function track(value: JobRecord, meta: JobMetadata = {}): void {
    if (!live() || !available()) return;
    const job = observedJobDto(value);
    clearTimeout(jobs.get(job.id)?.timer);
    const info: Tracking = { meta: { ...meta, refreshOnSuccess: meta.refreshOnSuccess?.slice() }, lastStatus: job.status, cleaned: false, job };
    jobs.set(job.id, info); notify(job, info); subscribe();
  }
  async function create(type: string, params: object): Promise<JobRecord> {
    if (disposed) throw new Error('File Explorer jobs controller is disposed');
    const response = await options.fetch('/api/app/file_explorer/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, params }) });
    const raw: unknown = await response.json().catch(() => ({})), body = objectDto(raw, 'job response');
    if (!response.ok || body.ok === false) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
    return jobRecordDto(body.data ?? body);
  }
  return {
    available, create, track,
    trackBulk: track,
    trackArchive(job: JobRecord, meta: JobMetadata = {}): void { track(job, { type: 'archive-extract', title: `Extract ${meta.archiveName || meta.archivePath?.split('/').pop() || 'archive'}`, ...meta }); },
    suspend(): void { if (disposed) return; suspended = true; stopFeeds(); for (const info of jobs.values()) { clearTimeout(info.timer); info.timer = undefined; } },
    resume(): void { if (disposed) return; suspended = false; for (const info of jobs.values()) { if (terminal.has(info.job.status) && info.cleaned) scheduleRemoval(info.job, info); } subscribe(); },
    dispose(): void { if (disposed) return; disposed = true; stopFeeds(); for (const [id, info] of jobs) { clearTimeout(info.timer); options.dismiss(id); } jobs.clear(); },
  };
}

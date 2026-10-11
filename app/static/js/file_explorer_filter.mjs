// Bound regex work off the UI thread. Each update invalidates older results.
export function createListingFilter(deliver, WorkerClass = Worker) {
  let generation = 0, worker = null, timer = null, deadline = null;
  function cancel() {
    generation++;
    clearTimeout(timer);
    clearTimeout(deadline);
    worker?.terminate();
    worker = null;
  }
  function apply(entries, pattern) {
    cancel();
    const current = generation;
    const finish = (result, error = '') => {
      if (current !== generation) return;
      cancel();
      deliver(result, error);
    };
    if (!pattern) { finish(entries); return; }
    const names = entries.map(entry => entry.name || '');
    if (pattern.length > 256) { finish([], 'Regex must be at most 256 characters.'); return; }
    if (names.length > 20000 || names.some(name => name.length > 4096) || names.reduce((n, name) => n + name.length, 0) > 1048576) {
      finish([], 'Directory is too large for regex filtering.'); return;
    }
    timer = setTimeout(() => {
      try {
        worker = new WorkerClass('/static/js/file_picker_filter_worker.js');
        deadline = setTimeout(() => finish([], 'Regex filtering exceeded its time limit.'), 500);
        worker.onerror = () => finish([], 'Regex filter worker is unavailable.');
        worker.onmessage = ({ data }) => {
          if (data.error) { finish([], data.error); return; }
          finish(data.indices.map(index => entries[index]));
        };
        worker.postMessage({ pattern, names });
      } catch { finish([], 'Regex filter worker is unavailable.'); }
    }, 120);
  }
  return { apply, cancel };
}

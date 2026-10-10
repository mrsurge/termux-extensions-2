// One lane, one decode at a time. Reset invalidates queued and active work;
// no decoded packet from an earlier connection can enter the current model.
export function createOrderedRpcReceiver(options: {
  decode(payload: unknown, signal: AbortSignal): unknown;
  size(payload: unknown): number;
  deliver(value: unknown): void;
  onError(error: unknown): void;
}) {
  let generation = 0;
  let queuedBytes = 0;
  let running = false;
  let active: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: { payload: unknown; size: number }[] = [];
  function reset(): void {
    generation++;
    active?.abort(); active = null;
    if (timer) clearTimeout(timer);
    timer = null; queue = []; queuedBytes = 0; running = false;
  }
  function fail(error: unknown): void { reset(); options.onError(error); }
  function drain(): void {
    if (running) return;
    while (queue.length) {
      const item = queue.shift()!;
      const current = generation;
      const controller = new AbortController();
      active = controller;
      let result: unknown;
      try { result = options.decode(item.payload, controller.signal); }
      catch (error) { fail(error); return; }
      if (result instanceof Promise) {
        running = true;
        timer = setTimeout(() => {
          if (generation === current) fail(new Error('RPC decode timeout'));
        }, 10000);
        void result.then(value => {
          if (generation !== current) return;
          if (timer) clearTimeout(timer);
          timer = null; active = null; running = false; queuedBytes -= item.size;
          try { options.deliver(value); } catch (error) { fail(error); return; }
          drain();
        }, error => { if (generation === current) fail(error); });
        return;
      }
      active = null; queuedBytes -= item.size;
      try { options.deliver(result); } catch (error) { fail(error); return; }
    }
  }
  return {
    reset,
    receive(payload: unknown): void {
      let size: number;
      try { size = options.size(payload); } catch (error) { fail(error); return; }
      if (!Number.isSafeInteger(size) || size < 0 || queue.length + Number(running) >= 64 ||
          size > 8 * 1024 * 1024 - queuedBytes) {
        fail(new Error('RPC decode queue limit')); return;
      }
      queue.push({ payload, size }); queuedBytes += size; drain();
    },
  };
}

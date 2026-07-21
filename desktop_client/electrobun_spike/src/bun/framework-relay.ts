const LOOPBACK_HOST = "127.0.0.1";

function trace(message: string): void {
  if (process.env.TE2_DESKTOP_RELAY_TRACE === "1") {
    console.log(`[te2-desktop-relay] ${message}`);
  }
}

type RelaySocket = Bun.Socket<RelayEndpoint>;

type QueuedWrite = {
  bytes: Buffer;
  offset: number;
};

type RelayFlow = {
  destination: RelaySocket | null;
  source: RelaySocket | null;
  queue: QueuedWrite[];
  ending: boolean;
  ended: boolean;
};

type RelayPair = {
  downstream: RelaySocket;
  upstream: RelaySocket | null;
  configuredOrigin: string;
  toDownstream: RelayFlow;
  toUpstream: RelayFlow;
  closed: boolean;
  downstreamClosed: boolean;
  upstreamClosed: boolean;
};

type RelayEndpoint = {
  pair: RelayPair;
  side: "downstream" | "upstream";
};

export type FrameworkRelay = {
  readonly browserOrigin: string;
  readonly configuredOrigin: string;
  readonly port: number;
  retarget(configuredOrigin: string): void;
  stop(): void;
};

type RelayTarget = {
  configuredOrigin: string;
  hostname: string;
  port: number;
};

function relayTarget(configuredOrigin: string): RelayTarget {
  const upstreamUrl = new URL(configuredOrigin);
  if (upstreamUrl.protocol !== "http:") {
    throw new Error("The desktop framework relay requires an HTTP origin");
  }
  return {
    configuredOrigin: upstreamUrl.origin,
    hostname: upstreamUrl.hostname,
    port: Number(upstreamUrl.port || 80),
  };
}

function flowForSource(endpoint: RelayEndpoint): RelayFlow {
  return endpoint.side === "downstream"
    ? endpoint.pair.toUpstream
    : endpoint.pair.toDownstream;
}

function flowForDestination(endpoint: RelayEndpoint): RelayFlow {
  return endpoint.side === "downstream"
    ? endpoint.pair.toDownstream
    : endpoint.pair.toUpstream;
}

function closePair(pair: RelayPair): void {
  if (pair.closed) return;
  pair.closed = true;
  pair.toDownstream.queue.length = 0;
  pair.toUpstream.queue.length = 0;
  if (pair.downstream.readyState > 0) pair.downstream.terminate();
  if (pair.upstream && pair.upstream.readyState > 0) pair.upstream.terminate();
}

function finishFlow(flow: RelayFlow): void {
  if (!flow.destination || flow.queue.length) return;
  if (flow.ending && flow.destination.readyState > 0) {
    flow.ending = false;
    flow.ended = true;
    flow.destination.shutdown(true);
    return;
  }
  if (!flow.ended && flow.source?.readyState && flow.source.readyState > 0) {
    flow.source.resume();
  }
}

function flushFlow(flow: RelayFlow): void {
  const destination = flow.destination;
  if (!destination || destination.readyState <= 0) return;

  while (flow.queue.length) {
    const pending = flow.queue[0];
    const remaining = pending.bytes.byteLength - pending.offset;
    const written = destination.write(pending.bytes, pending.offset, remaining);
    if (written < 0) {
      closePair(destination.data.pair);
      return;
    }
    pending.offset += written;
    if (pending.offset < pending.bytes.byteLength) return;
    flow.queue.shift();
  }
  finishFlow(flow);
}

function forwardBytes(source: RelaySocket, bytes: Buffer): void {
  const flow = flowForSource(source.data);
  const destination = flow.destination;
  if (
    (source.data.side === "downstream" && source.data.pair.upstreamClosed) ||
    (source.data.side === "upstream" && source.data.pair.downstreamClosed)
  ) {
    closePair(source.data.pair);
    return;
  }
  if (!destination || destination.readyState <= 0 || flow.queue.length) {
    flow.queue.push({ bytes: Buffer.from(bytes), offset: 0 });
    source.pause();
    return;
  }

  const written = destination.write(bytes);
  if (written < 0) {
    closePair(source.data.pair);
    return;
  }
  if (written < bytes.byteLength) {
    flow.queue.push({ bytes: Buffer.from(bytes.subarray(written)), offset: 0 });
    source.pause();
  }
}

function endFlow(source: RelaySocket): void {
  const flow = flowForSource(source.data);
  if (flow.ended || flow.ending) return;
  flow.ending = true;
  finishFlow(flow);
}

export function startFrameworkRelay(configuredOrigin: string): FrameworkRelay | null {
  const upstreamUrl = new URL(configuredOrigin);
  if (upstreamUrl.protocol !== "http:") return null;

  let target = relayTarget(upstreamUrl.origin);
  const activePairs = new Set<RelayPair>();

  const socketHandler: Bun.SocketHandler<RelayEndpoint, "buffer"> = {
    binaryType: "buffer",
    open(socket) {
      trace(`${socket.data.side} open`);
      socket.setNoDelay(true);
      const endpoint = socket.data;
      if (endpoint.side === "upstream") {
        const pair = endpoint.pair;
        if (pair.closed) {
          socket.terminate();
          return;
        }
        pair.upstream = socket;
        pair.toUpstream.destination = socket;
        pair.toDownstream.source = socket;
        flushFlow(pair.toUpstream);
      }
    },
    data(socket, bytes) {
      trace(`${socket.data.side} data ${bytes.byteLength}`);
      forwardBytes(socket, bytes);
    },
    drain(socket) {
      trace(`${socket.data.side} drain`);
      flushFlow(flowForDestination(socket.data));
    },
    end(socket) {
      trace(`${socket.data.side} end`);
      endFlow(socket);
    },
    close(socket) {
      trace(`${socket.data.side} close`);
      const pair = socket.data.pair;
      if (socket.data.side === "downstream") {
        pair.downstreamClosed = true;
        activePairs.delete(pair);
        closePair(pair);
        return;
      }

      pair.upstreamClosed = true;
      pair.upstream = null;
      pair.toUpstream.destination = null;
      if (!pair.toDownstream.ended && !pair.toDownstream.ending) {
        pair.toDownstream.ending = true;
      }
      finishFlow(pair.toDownstream);
      if (pair.downstreamClosed) {
        activePairs.delete(pair);
        closePair(pair);
      }
    },
    error(socket, error) {
      console.error(
        `[te2-desktop-relay] ${socket.data.side} socket error: ${error.message}`,
      );
      activePairs.delete(socket.data.pair);
      closePair(socket.data.pair);
    },
    connectError(socket, error) {
      console.error(
        `[te2-desktop-relay] failed to connect to ${socket.data.pair.configuredOrigin}: ${error.message}`,
      );
      activePairs.delete(socket.data.pair);
      closePair(socket.data.pair);
    },
  };

  const listener = Bun.listen<RelayEndpoint>({
    hostname: LOOPBACK_HOST,
    port: 0,
    exclusive: true,
    allowHalfOpen: true,
    data: null as unknown as RelayEndpoint,
    socket: {
      ...socketHandler,
      open(downstream) {
        downstream.setNoDelay(true);
        const connectionTarget = target;
        const pair = {
          downstream,
          upstream: null,
          configuredOrigin: connectionTarget.configuredOrigin,
          toDownstream: {
            destination: downstream,
            source: null,
            queue: [],
            ending: false,
            ended: false,
          },
          toUpstream: {
            destination: null,
            source: downstream,
            queue: [],
            ending: false,
            ended: false,
          },
          closed: false,
          downstreamClosed: false,
          upstreamClosed: false,
        } satisfies RelayPair;
        downstream.data = { pair, side: "downstream" };
        trace("downstream open");
        activePairs.add(pair);

        void Bun.connect<RelayEndpoint>({
          hostname: connectionTarget.hostname,
          port: connectionTarget.port,
          allowHalfOpen: true,
          data: { pair, side: "upstream" },
          socket: socketHandler,
        }).catch(() => {
          activePairs.delete(pair);
          closePair(pair);
        });
      },
    },
  });

  let stopped = false;
  const browserOrigin = `http://${LOOPBACK_HOST}:${listener.port}`;
  console.log(`[te2-desktop-relay] ${browserOrigin} -> ${configuredOrigin}`);
  return {
    browserOrigin,
    get configuredOrigin() {
      return target.configuredOrigin;
    },
    port: listener.port,
    retarget(nextOrigin) {
      const nextTarget = relayTarget(nextOrigin);
      if (nextTarget.configuredOrigin === target.configuredOrigin) return;
      const previousOrigin = target.configuredOrigin;
      target = nextTarget;
      for (const pair of activePairs) closePair(pair);
      activePairs.clear();
      console.log(
        `[te2-desktop-relay] retargeted ${browserOrigin}: ${previousOrigin} -> ${target.configuredOrigin}`,
      );
    },
    stop() {
      if (stopped) return;
      stopped = true;
      listener.stop(false);
      for (const pair of activePairs) closePair(pair);
      activePairs.clear();
    },
  };
}

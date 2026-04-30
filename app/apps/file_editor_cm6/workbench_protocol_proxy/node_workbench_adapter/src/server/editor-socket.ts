import type { Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Server as SocketIoServerCtor } from "socket.io";

type SocketIoModule = {
  Server: typeof SocketIoServerCtor;
};

const require = createRequire(import.meta.url);
const { Server: SocketIoServer } = require(
  "../../../../vendor/node_socketio/node_modules/socket.io/dist/index.js",
) as SocketIoModule;

export const WBA_SOCKET_PATH = "/wba_ws/socket.io";
export const WBA_SOCKET_NAMESPACE = "/wba";
export const WBA_RPC_EVENT = "rpc";

export type JsonRpcReply = Record<string, unknown> | null;

export interface EditorWbaSocketRuntime {
  handleJsonRpc(request: unknown): Promise<JsonRpcReply>;
  nowMs(): number;
  log: (...args: unknown[]) => void;
}

export interface EditorWbaSocketServer {
  broadcastNotification(method: string, params: unknown): void;
  clientCount(): number;
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function shouldDeliverReply(reply: JsonRpcReply): reply is Record<string, unknown> {
  if (!isRecord(reply)) return false;
  if (Object.prototype.hasOwnProperty.call(reply, "error")) return true;
  return Object.prototype.hasOwnProperty.call(reply, "id") && reply.id != null;
}

export function attachEditorWbaSocket(
  httpServer: HttpServer,
  runtime: EditorWbaSocketRuntime,
): EditorWbaSocketServer {
  const io = new SocketIoServer(httpServer, {
    path: WBA_SOCKET_PATH,
    serveClient: false,
    transports: ["websocket"],
    cors: {
      origin: true,
      credentials: true,
    },
    maxHttpBufferSize: 8 * 1024 * 1024,
  });
  const namespace = io.of(WBA_SOCKET_NAMESPACE);

  namespace.on("connection", (socket) => {
    runtime.log(
      JSON.stringify({
        type: "wba/socket/connect",
        ts_ms: runtime.nowMs(),
        id: socket.id,
        clients: namespace.sockets.size,
      }),
    );

    socket.on(WBA_RPC_EVENT, (payload: unknown) => {
      void (async () => {
        try {
          if (Array.isArray(payload)) {
            const replies = await Promise.all(payload.map((entry) => runtime.handleJsonRpc(entry)));
            const deliverable = replies.filter(shouldDeliverReply);
            if (deliverable.length) socket.emit(WBA_RPC_EVENT, deliverable);
            return;
          }

          const reply = await runtime.handleJsonRpc(payload);
          if (shouldDeliverReply(reply)) socket.emit(WBA_RPC_EVENT, reply);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          socket.emit(WBA_RPC_EVENT, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message },
          });
        }
      })();
    });

    socket.on("disconnect", (reason) => {
      runtime.log(
        JSON.stringify({
          type: "wba/socket/disconnect",
          ts_ms: runtime.nowMs(),
          id: socket.id,
          reason,
          clients: namespace.sockets.size,
        }),
      );
    });
  });

  return {
    broadcastNotification(method: string, params: unknown): void {
      namespace.emit(WBA_RPC_EVENT, { jsonrpc: "2.0", method, params });
    },
    clientCount(): number {
      return namespace.sockets.size;
    },
    close(): void {
      io.close();
    },
  };
}

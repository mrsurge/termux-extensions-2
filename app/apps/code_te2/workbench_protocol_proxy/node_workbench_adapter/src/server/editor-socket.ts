import type { Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Server as SocketIoServerCtor } from "socket.io";
import {
  WBA_RPC_CODEC_MSGPACK_V1,
  decodeWbaRpcMessage,
  encodeWbaRpcMessage,
} from "../protocol/messagepack-codec.mjs";

type SocketIoModule = {
  Server: typeof SocketIoServerCtor;
};

const require = createRequire(import.meta.url);
const { Server: SocketIoServer } =
  require("../../../../vendor/node_socketio/node_modules/socket.io/dist/index.js") as SocketIoModule;

export const WBA_SOCKET_PATH = "/wba_ws/socket.io";
export const WBA_SOCKET_NAMESPACE = "/wba";
export const WBA_RPC_EVENT = "rpc";

export type JsonRpcReply = Record<string, unknown> | null;

export interface EditorWbaRequestContext {
  clientInstanceId: string;
  windowId: string | null;
}

export interface EditorWbaSocketRuntime {
  handleJsonRpc(
    request: unknown,
    context?: EditorWbaRequestContext,
  ): Promise<JsonRpcReply>;
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

const CLIENT_INSTANCE_PATTERN = /^client_[a-z0-9]{12,64}$/;
const WINDOW_PATTERN = /^window_[a-z0-9]{20,64}$/;

function identityValue(value: unknown, pattern: RegExp): string | null {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return pattern.test(candidate) ? candidate : null;
}

function clientRoom(clientInstanceId: string): string {
  return `code_te2:client:${clientInstanceId}`;
}

export function editorWbaRequestContextFromQuery(
  query: Record<string, unknown>,
): EditorWbaRequestContext {
  const clientInstanceId = identityValue(
    query.client_instance_id,
    CLIENT_INSTANCE_PATTERN,
  );
  const rawWindowId = query.window_id;
  const windowId = identityValue(rawWindowId, WINDOW_PATTERN);
  if (!clientInstanceId || (rawWindowId != null && !windowId)) {
    throw new Error("invalid_client_presentation_identity");
  }
  return { clientInstanceId, windowId };
}

function shouldDeliverReply(
  reply: JsonRpcReply,
): reply is Record<string, unknown> {
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
    // Leave connectionStateRecovery unset; explicit adapter resync owns reconnect state.
    cors: {
      origin: true,
      credentials: true,
    },
    maxHttpBufferSize: 8 * 1024 * 1024,
  });
  const namespace = io.of(WBA_SOCKET_NAMESPACE);

  namespace.use((socket, next) => {
    const auth = socket.handshake.auth;
    if (!isRecord(auth) || auth.rpcCodec !== WBA_RPC_CODEC_MSGPACK_V1) {
      next(new Error("unsupported_rpc_codec"));
      return;
    }
    let context: EditorWbaRequestContext;
    try {
      context = editorWbaRequestContextFromQuery(socket.handshake.query);
    } catch {
      next(new Error("invalid_client_presentation_identity"));
      return;
    }
    socket.data.clientInstanceId = context.clientInstanceId;
    socket.data.windowId = context.windowId;
    next();
  });

  namespace.on("connection", (socket) => {
    const context: EditorWbaRequestContext = {
      clientInstanceId: String(socket.data.clientInstanceId),
      windowId: typeof socket.data.windowId === "string"
        ? socket.data.windowId
        : null,
    };
    void socket.join(clientRoom(context.clientInstanceId));
    runtime.log(
      JSON.stringify({
        type: "wba/socket/connect",
        ts_ms: runtime.nowMs(),
        id: socket.id,
        clientInstanceId: context.clientInstanceId,
        windowId: context.windowId,
        clients: namespace.sockets.size,
      }),
    );

    socket.on(WBA_RPC_EVENT, (payload: unknown) => {
      void (async () => {
        try {
          const decoded = decodeWbaRpcMessage(payload);
          if (Array.isArray(decoded)) {
            const replies = await Promise.all(
              decoded.map((entry) => runtime.handleJsonRpc(entry, context)),
            );
            const deliverable = replies.filter(shouldDeliverReply);
            if (deliverable.length)
              socket.emit(WBA_RPC_EVENT, encodeWbaRpcMessage(deliverable));
            return;
          }

          const reply = await runtime.handleJsonRpc(decoded, context);
          if (shouldDeliverReply(reply))
            socket.emit(WBA_RPC_EVENT, encodeWbaRpcMessage(reply));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          socket.emit(
            WBA_RPC_EVENT,
            encodeWbaRpcMessage({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32000, message },
            }),
          );
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
      const clientInstanceId = isRecord(params)
        ? identityValue(params.clientInstanceId, CLIENT_INSTANCE_PATTERN)
        : null;
      const target = clientInstanceId
        ? namespace.to(clientRoom(clientInstanceId))
        : namespace;
      target.emit(
        WBA_RPC_EVENT,
        encodeWbaRpcMessage({ jsonrpc: "2.0", method, params }),
      );
    },
    clientCount(): number {
      return namespace.sockets.size;
    },
    close(): void {
      io.close();
    },
  };
}

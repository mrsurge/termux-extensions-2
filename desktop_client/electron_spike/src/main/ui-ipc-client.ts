import { decode } from "@msgpack/msgpack";
import { io, type Socket } from "socket.io-client";

const UI_IPC_NOTIFICATION_EVENT = "rpc.notify";
const RUN_TARGET_ROUTES_CHANGED = "ui.runTarget.routes.changed";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function decodeNotification(payload: unknown): JsonObject | null {
  if (!(payload instanceof Uint8Array)) return null;
  try {
    return asObject(decode(payload));
  } catch {
    return null;
  }
}

export class ElectronUiIpcClient {
  #socket: Socket | null = null;
  #origin = "";

  constructor(
    private readonly clientId: string,
    private readonly onRunTargetRoutesChanged: (projection: JsonObject) => void,
    private readonly onRouteAuthorityUnavailable: () => void,
  ) {}

  connect(frameworkOrigin: string): void {
    const normalized = new URL(frameworkOrigin).origin;
    if (this.#socket && this.#origin === normalized) {
      if (!this.#socket.connected) this.#socket.connect();
      return;
    }
    this.disconnect();
    this.#origin = normalized;
    const socket = io(`${normalized}/ui_ipc`, {
      path: "/ui_ipc_ws/socket.io",
      transports: ["websocket"],
      upgrade: false,
      auth: { rpcCodec: "msgpack-v1" },
      query: {
        app_id: "file_editor_cm6",
        source: "electron_native",
        client_id: this.clientId,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      forceNew: true,
      multiplex: false,
    });
    this.#socket = socket;
    socket.on("connect", () => {
      console.log(`[te2-desktop-ui-ipc] connected to ${normalized}`);
    });
    socket.on("disconnect", (reason) => {
      this.onRouteAuthorityUnavailable();
      console.warn(`[te2-desktop-ui-ipc] disconnected: ${String(reason || "unknown")}`);
    });
    socket.on("connect_error", (error) => {
      console.warn(`[te2-desktop-ui-ipc] connect error: ${error.message}`);
    });
    socket.on(UI_IPC_NOTIFICATION_EVENT, (payload: unknown) => {
      const notification = decodeNotification(payload);
      if (!notification || notification.jsonrpc !== "2.0") return;
      if (notification.method !== RUN_TARGET_ROUTES_CHANGED) return;
      const params = asObject(notification.params);
      if (params) this.onRunTargetRoutesChanged(params);
    });
  }

  disconnect(): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#origin = "";
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  }
}

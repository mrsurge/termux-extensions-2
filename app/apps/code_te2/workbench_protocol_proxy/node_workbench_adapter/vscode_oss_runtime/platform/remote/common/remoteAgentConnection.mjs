import { VSBuffer } from "../../../base/common/buffer.mjs";
import { generateUuid } from "../../../base/common/uuid.mjs";
import { PersistentProtocol } from "../../../base/parts/ipc/common/ipc.net.mjs";

export const ConnectionType = Object.freeze({
  Management: 1,
  ExtensionHost: 2,
  Tunnel: 3,
});

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label || "timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function readOneControlMessage(protocol, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const d = protocol.onControlMessage((raw) => {
        try {
          d.dispose?.();
          resolve(JSON.parse(raw.toString()));
        } catch (e) {
          d.dispose?.();
          reject(e);
        }
      });
    }),
    timeoutMs,
    "handshake control message timeout"
  );
}

function getErrorFromMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.type !== "error") return null;
  const err = new Error(msg.reason || "VSCODE_CONNECTION_ERROR");
  err.code = "VSCODE_CONNECTION_ERROR";
  return err;
}

export function createNoopSignService() {
  return {
    async createNewMessage(data) {
      return { data };
    },
    async validate(_message, _signedData) {
      return true;
    },
    async sign(data) {
      // code-server uses a no-op sign in many setups (signedData == data)
      return data;
    },
  };
}

export async function connectToRemoteAgent({
  socketFactory,
  connectTo,
  serverRootPath,
  reconnectionToken,
  connectionToken,
  commit,
  desiredConnectionType,
  args,
  signService,
  timeoutMs = 10000,
  debugLabel = "te2-node",
}) {
  const protocol = await (async () => {
      const query = `reconnectionToken=${reconnectionToken}&reconnection=false`;
      const socket = await withTimeout(
      socketFactory.connect(connectTo, serverRootPath.replace(/^\//, ""), query, debugLabel),
      timeoutMs,
      "socket connect timeout"
    );
    return new PersistentProtocol({ socket });
  })();

  const message = await signService.createNewMessage(generateUuid());
  const authRequest = { type: "auth", auth: connectionToken || "00000000000000000000", data: message.data };
  protocol.sendControl(VSBuffer.fromString(JSON.stringify(authRequest)));

  const signMsg = await readOneControlMessage(protocol, timeoutMs);
  const err1 = getErrorFromMessage(signMsg);
  if (err1) throw err1;
  if (signMsg.type !== "sign" || typeof signMsg.data !== "string") throw Object.assign(new Error("Unexpected handshake message"), { code: "VSCODE_CONNECTION_ERROR" });
  const isValid = await signService.validate(message, signMsg.signedData);
  if (!isValid) throw Object.assign(new Error("Refused to connect to unsupported server"), { code: "VSCODE_CONNECTION_ERROR" });

  const signed = await signService.sign(signMsg.data);
  const connTypeRequest = { type: "connectionType", commit: commit ?? undefined, signedData: signed, desiredConnectionType };
  if (args) connTypeRequest.args = args;
  protocol.sendControl(VSBuffer.fromString(JSON.stringify(connTypeRequest)));

  const okMsg = await readOneControlMessage(protocol, timeoutMs);
  const err2 = getErrorFromMessage(okMsg);
  if (err2) throw err2;
  if (okMsg.type !== "ok") {
    // some servers send {debugPort} as first control message for ext host; accept it.
  }

  return { protocol, firstMessage: okMsg };
}

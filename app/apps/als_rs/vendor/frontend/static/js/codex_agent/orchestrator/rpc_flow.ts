import { getRpcRegistry } from '../rpc/registry.ts';

const _rpcRegistry = getRpcRegistry;
void _rpcRegistry;

type JsonObject = Record<string, unknown>;

interface PendingRpcEntry {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LegacyRpcRequestPayload extends JsonObject {
  method: string;
  params?: JsonObject;
  id?: number;
}

interface SendRpcOptions {
  notify?: boolean;
}

interface RpcFlowContext {
  waitForWs: () => Promise<boolean>;
  sioCall: (event: string, payload?: JsonObject, options?: JsonObject) => Promise<unknown>;
  getPending: () => Map<string | number, PendingRpcEntry>;
  getConversationId?: () => string | null | undefined;
}

export function bindRpcFlow(ctx: RpcFlowContext) {
  const {
    waitForWs,
    sioCall,
    getPending,
  } = ctx;

  let rpcId = 1;

  function nextRpcId(): number {
    const id = rpcId;
    rpcId += 1;
    return id;
  }

  async function sendRpc(
    method: string,
    params?: JsonObject,
    options: SendRpcOptions = {},
  ): Promise<unknown | null> {
    const payload: LegacyRpcRequestPayload = { method };
    if (params !== undefined) payload.params = params;
    if (options.notify) {
      await sioCall('rpc', payload);
      return null;
    }
    const id = nextRpcId();
    payload.id = id;
    await waitForWs();
    await sioCall('rpc', payload);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        getPending().delete(id);
        reject(new Error('rpc timeout'));
      }, 15000);
      getPending().set(id, { resolve, reject, timer });
    });
  }

  return {
    sendRpc,
  };
}

import { PINNED_RPC_IDS, PINNED_CODE_SERVER_VERSION, PINNED_CODE_SERVER_COMMIT } from "./pinned-rpc-ids.mjs";
export type RpcIdName = keyof typeof PINNED_RPC_IDS;
export type RpcIds = Readonly<Record<RpcIdName, number>>;

// No environment/config override: the managed build and this map ship together.
export function loadRpcIds(): { ids: RpcIds; source: string } {
  return {
    ids: PINNED_RPC_IDS,
    source: `pinned code-server ${PINNED_CODE_SERVER_VERSION} (${PINNED_CODE_SERVER_COMMIT})`,
  };
}

export declare const WBA_RPC_CODEC_MSGPACK_V1: "msgpack-v1";

export declare function encodeWbaRpcMessage(payload: unknown): Uint8Array;

export declare function decodeWbaRpcMessage(payload: unknown): unknown;

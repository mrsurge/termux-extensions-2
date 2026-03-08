export function buildVscodeApiRequestPayload(id, method, params) {
  return { jsonrpc: '2.0', id: id, method: String(method || ''), params: params || {} };
}

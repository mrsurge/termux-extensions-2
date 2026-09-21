// Shared by the browser and WBA: slow providers get their own budget, not the
// remainder of a shorter outer RPC deadline. Other language features are unchanged.
export function completionTimeouts(requestedProviderMs?: unknown) {
  const requested = Number(requestedProviderMs);
  const providerMs = Number.isFinite(requested) && requested > 0
    ? Math.max(1000, Math.min(105000, requested))
    : 30000;
  const preflightMs = 5000;
  // didChange acknowledgement + missing-provider wait + reply processing margin.
  // Keep this within runClientDocumentOperation's existing 120-second ceiling.
  const operationMs = providerMs + 2 * preflightMs + 5000;
  // Dispatch enters the gate twice: activation, then completion. Each admission
  // can queue for operationMs + 5000 before running. Cover both and transport;
  // these are worst-case ceilings, never added sleeps or provider runtime.
  const rpcMs = 2 * (2 * operationMs + 5000) + 5000;
  return { providerMs, preflightMs, operationMs, rpcMs };
}

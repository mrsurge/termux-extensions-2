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
  // Retain the established outer ceiling. Activation uses operationMs; the
  // second admission now only synchronizes text (5s + 5s margin), after which
  // providers run outside the gate. Both queues + sync + provider wait/reply
  // fit this conservative budget. These allowances never add sleeps.
  const rpcMs = 2 * (2 * operationMs + 5000) + 5000;
  return { providerMs, preflightMs, operationMs, rpcMs };
}

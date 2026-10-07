// One pending user intent. Failed/cancelled consent never executes its effect.
export function createGuardedNavigation({ needsConsent, confirm }) {
  let pending = null;
  return async function request(action) {
    if (pending) return false;
    const operation = (async () => {
      if (needsConsent() && !await confirm()) return false;
      await action();
      return true;
    })();
    pending = operation;
    try { return await operation; }
    finally { if (pending === operation) pending = null; }
  };
}

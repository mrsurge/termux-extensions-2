/** Coalesce invalidations without caching a disconnected/failed refresh. */
export function createContributionRefresher(
  isConnected: () => boolean,
  refresh: () => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  let queued = false;
  let pending: Promise<void> | null = null;
  return {
    request(): Promise<void> {
      queued = true;
      if (pending) return pending;
      pending = Promise.resolve().then(async () => {
        try {
          while (queued && isConnected()) {
            queued = false;
            await refresh();
          }
        } catch (error) {
          onError(error);
        } finally {
          // Clear ownership in the same continuation as the final queue check.
          // A later invalidation must not join an already-completed drain.
          pending = null;
        }
      });
      return pending;
    },
  };
}

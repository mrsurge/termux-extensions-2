import { isUnknownArray } from '../../rpc/value-types.ts';
type Row = Record<string, unknown> & { rel: string; identity: string; hunks: unknown[] };
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !isUnknownArray(value);
}

// Client-side projection mirror only; membership/identity belong to the backend.
export function createReviewProjection() {
  let project = '';
  let generation = -1;
  let epoch = '';
  let revision = -1;
  let entries = new Map<string, Row>();
  const retiredEpochs = new Set<string>();
  function reset(nextProject: string): void {
    project = nextProject; generation = -1; epoch = ''; revision = -1;
    entries = new Map(); retiredEpochs.clear();
  }
  return {
    reset,
    apply(value: unknown, currentProject: string): Row[] | null {
      if (currentProject !== project) reset(currentProject);
      if (!record(value) || value.complete !== true || value.projectRoot !== currentProject
        || !Number.isSafeInteger(value.projectGeneration) || !Number.isSafeInteger(value.revision)
        || typeof value.projectionId !== 'string' || !value.projectionId || !isUnknownArray(value.entries)) return null;
      const nextGeneration = value.projectGeneration as number;
      const nextRevision = value.revision as number;
      if (nextGeneration < 0 || nextRevision < 0) return null;
      if (retiredEpochs.has(value.projectionId)) return null;
      if (epoch === value.projectionId && (nextGeneration < generation || nextRevision < revision)) return null;
      const next = new Map<string, Row>();
      for (const item of value.entries) {
        if (!record(item) || typeof item.rel !== 'string' || !item.rel || typeof item.identity !== 'string'
          || !isUnknownArray(item.hunks) || next.has(item.rel)) return null;
        const old = entries.get(item.rel);
        next.set(item.rel, old?.identity === item.identity ? old : item as Row);
      }
      if (epoch && epoch !== value.projectionId) retiredEpochs.add(epoch);
      if (retiredEpochs.size > 32) retiredEpochs.delete(retiredEpochs.values().next().value!);
      epoch = value.projectionId; generation = nextGeneration; revision = nextRevision;
      entries = next; // Commit only a complete validated snapshot; omitted items evict.
      return [...entries.values()];
    },
  };
}

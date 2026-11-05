import { isUnknownArray } from '../../src/rpc/value-types.ts';

export type SecondaryAreaCloseFence = {
  projectPath: string;
  revision: number;
  projectGeneration: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !isUnknownArray(value)
    ? value as Record<string, unknown> : null;
}

/** Do not hide/dispose the renderer until the backend commits its membership close. */
export async function closeSecondaryArea(deps: {
  readState(): Promise<unknown>;
  closeMembership(fence: SecondaryAreaCloseFence): Promise<unknown>;
  closePresentation(): Promise<unknown>;
}): Promise<void> {
  const state = record(await deps.readState());
  const open = record(state?.openState);
  const project = state?.activeProject;
  const revision = open?.revision;
  const generation = open?.projectGeneration;
  if (typeof project !== 'string' || !project || open?.projectPath !== project
      || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
      || typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Updated editor state is required before closing the second editor');
  }
  await deps.closeMembership({ projectPath: project, revision, projectGeneration: generation });
  await deps.closePresentation();
}

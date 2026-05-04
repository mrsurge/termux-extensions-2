export function createBootSequenceDeps<TDeps extends Record<string, unknown>>(deps: TDeps): TDeps {
  return { ...deps };
}

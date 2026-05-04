export interface AppContext {
  rootEl: HTMLElement;
  api: unknown;
  host: unknown;
  state: Record<string, unknown>;
  elements: Record<string, HTMLElement | null>;
  services: Record<string, unknown>;
}

interface CreateAppContextParams {
  rootEl: HTMLElement;
  api: unknown;
  host: unknown;
}

export function createAppContext({ rootEl, api, host }: CreateAppContextParams): AppContext {
  return {
    rootEl,
    api,
    host,
    state: {},
    elements: {},
    services: {},
  };
}

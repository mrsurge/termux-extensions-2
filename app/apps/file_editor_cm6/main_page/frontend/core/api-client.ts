interface HostApiSurface {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body: unknown) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createApiClient(api: HostApiSurface) {
  async function apiGet(path: string): Promise<unknown> {
    const data = await api.get(path);
    if (!isRecord(data)) return data;
    return data.content ? data : (data.data || data);
  }

  async function apiPost(path: string, body: unknown): Promise<unknown> {
    try {
      const res = await api.post(path, body);
      return isRecord(res) ? (res.data || res || {}) : (res || {});
    } catch (error) {
      console.error(`[apiPost] Error calling ${path}:`, error);
      return {};
    }
  }

  return { apiGet, apiPost };
}

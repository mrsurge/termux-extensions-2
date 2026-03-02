// @ts-check

/**
 * @param {{ get: (path: string) => Promise<any>, post: (path: string, body: any) => Promise<any> }} api
 */
export function createApiClient(api) {
  async function apiGet(path) {
    const data = await api.get(path);
    return data.content ? data : (data.data || data);
  }

  async function apiPost(path, body) {
    try {
      const res = await api.post(path, body);
      return res?.data || res || {};
    } catch (error) {
      console.error(`[apiPost] Error calling ${path}:`, error);
      return {};
    }
  }

  return { apiGet, apiPost };
}

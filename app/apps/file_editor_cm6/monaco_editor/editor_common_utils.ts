interface LocationLike {
  protocol?: string;
  host?: string;
}

interface JsonEnvelopeLike {
  ok?: unknown;
  error?: unknown;
  detail?: unknown;
  data?: unknown;
}

function isJsonEnvelopeLike(value: unknown): value is JsonEnvelopeLike {
  return !!value && typeof value === 'object';
}

export function buildUiUrl(apiBase: string | null | undefined, relPath: string | null | undefined): string {
  const path = String(relPath || '').replace(/^\/+/, '');
  return `${String(apiBase || '')}/ui/${path}`;
}

export function wsUrlFromPath(locationObj: LocationLike | null | undefined, p: string | null | undefined): string | null {
  try {
    const proto = locationObj?.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = locationObj?.host || 'localhost';
    let pathOnly = String(p || '');
    if (!pathOnly.startsWith('/')) pathOnly = `/${pathOnly}`;
    return `${proto}//${host}${pathOnly}`;
  } catch (_) {
    return null;
  }
}

export async function fetchJsonWithBase(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  apiBase: string | null | undefined,
  path: string | null | undefined,
  options?: RequestInit,
): Promise<unknown> {
  const url = `${String(apiBase || '')}${String(path || '')}`;
  const response = await fetchImpl(url, options || { cache: 'no-store' });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch (_) {
    json = null;
  }
  const envelope = isJsonEnvelopeLike(json) ? json : null;
  if (!response.ok || envelope?.ok === false) {
    const msg =
      typeof envelope?.error === 'string'
        ? envelope.error
        : typeof envelope?.detail === 'string'
          ? envelope.detail
          : `HTTP ${response.status}`;
    throw new Error(msg);
  }
  if (envelope && 'data' in envelope && envelope.data != null) {
    return envelope.data;
  }
  return json;
}

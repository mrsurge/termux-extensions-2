// Shared, minimal HTTP boundary implemented by Node HTTP and Bun Fetch adapters.
export interface AdapterHttpRequest extends AsyncIterable<unknown, unknown, unknown> {
  url?: string | undefined;
  method?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}
export interface AdapterHttpResponse {
  writeHead(status: number, headers: Record<string, string | number>): void;
  end(body?: string | Uint8Array): void;
}
export type AdapterHttpHandler = (
  request: AdapterHttpRequest, response: AdapterHttpResponse,
) => Promise<void>;

export interface JobPoller {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}
export function createJobPoller(options: {
  baseUrl?: string;
  onUpdate(jobs: unknown): void;
  onError(error: unknown): void;
}): JobPoller;
export function cancelJob(id: string, fetcher?: undefined, baseUrl?: string): Promise<unknown>;
export function deleteJob(id: string, fetcher?: undefined, baseUrl?: string): Promise<unknown>;

export interface JobPoller {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}
export function createJobPoller(options: {
  onUpdate(jobs: unknown): void;
  onError(error: unknown): void;
}): JobPoller;
export function cancelJob(id: string): Promise<unknown>;
export function deleteJob(id: string): Promise<unknown>;

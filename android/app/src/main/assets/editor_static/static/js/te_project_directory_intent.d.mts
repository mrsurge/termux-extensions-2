export function openProjectDirectory(options: {
  directory: string;
  request(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  dialog: { confirm(message: string, options?: { title?: string; detail?: string }): Promise<boolean> };
}): Promise<boolean>;

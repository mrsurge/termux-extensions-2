import { openProjectDirectory } from '../../../../../static/js/te_project_directory_intent.mjs';

export async function consumeProjectLaunch(options: {
  search: string;
  connect(): Promise<unknown>;
  request(params: Record<string, unknown>): Promise<unknown>;
  confirm(message: string, options?: { title?: string; detail?: string }): Promise<boolean>;
  consume(): void;
}): Promise<void> {
  const directory = new URLSearchParams(options.search).get('project');
  if (!directory) return;
  // One navigation intent, not a permanent preference or reconnect replay.
  options.consume();
  await options.connect();
  await openProjectDirectory({ directory, dialog: { confirm: options.confirm }, request: async (params) => {
    const result = await options.request(params);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid project response');
    return result as Record<string, unknown>;
  } });
}

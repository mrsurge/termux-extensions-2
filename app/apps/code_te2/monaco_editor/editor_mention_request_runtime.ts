interface MentionSenderDeps {
  isConnected(): boolean;
  buildTargetedPayload(payload: Record<string, unknown>): Record<string, unknown>;
  request(payload: Record<string, unknown>): Promise<unknown>;
  toast(message: string): void;
}

/** All editor-origin mentions share acknowledged delivery and local feedback. */
export function createEditorMentionSender(deps: MentionSenderDeps) {
  return (payload: Record<string, unknown>): boolean => {
    if (!deps.isConnected()) {
      deps.toast('Editor connection unavailable');
      return false;
    }
    let targeted: Record<string, unknown>;
    try { targeted = deps.buildTargetedPayload(payload); }
    catch (error) {
      console.warn('[mention] no active agent presentation', error);
      deps.toast('No active agent conversation');
      return false;
    }
    void deps.request(targeted).then(result => {
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
        throw new Error('Mention rejected');
      }
      deps.toast('Mentioned in conversation');
    }).catch((error: unknown) => {
      console.warn('[mention] delivery failed', error);
      deps.toast('Failed to mention in conversation');
    });
    return true;
  };
}

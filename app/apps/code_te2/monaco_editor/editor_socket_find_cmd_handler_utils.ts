export interface FindCommandPayloadLike {
  action?: string;
}

function asFindCommandPayloadLike(value: unknown): FindCommandPayloadLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as FindCommandPayloadLike
    : null;
}

export function handleFindCommand(
  payload: unknown,
  editor: unknown,
  runFindCommandFn: (editor: unknown, action: string, onError: (error: unknown) => void) => void,
): void {
  const typedPayload = asFindCommandPayloadLike(payload);
  const action = typedPayload?.action ? String(typedPayload.action) : 'find';
  console.log('[Find] iframe received editor:find_cmd action=', action, 'editor=', !!editor);
  runFindCommandFn(editor, action, (error: unknown) => {
    console.error('[Find] _runFindCommand error:', error);
  });
}

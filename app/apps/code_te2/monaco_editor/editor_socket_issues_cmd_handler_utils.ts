import { isUnknownArray } from '../src/rpc/value-types.ts';
export interface IssuesCommandPayloadLike {
  action?: string;
}

function asIssuesCommandPayloadLike(value: unknown): IssuesCommandPayloadLike | null {
  return value != null && typeof value === 'object' && !isUnknownArray(value)
    ? value as IssuesCommandPayloadLike
    : null;
}

export function handleIssuesCommand(
  payload: unknown,
  editor: unknown,
  runIssuesCommandFn: (editor: unknown, action: string) => void,
): void {
  const typedPayload = asIssuesCommandPayloadLike(payload);
  const action = typedPayload?.action ? String(typedPayload.action) : '';
  if (!action) return;
  runIssuesCommandFn(editor, action);
}

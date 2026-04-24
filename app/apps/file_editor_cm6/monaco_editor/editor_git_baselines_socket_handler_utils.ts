export function handleGitBaselinesSocketEvent(
  payload: unknown,
  applyGitBaselinesFn: (payload: unknown) => void,
): void {
  applyGitBaselinesFn(payload);
}

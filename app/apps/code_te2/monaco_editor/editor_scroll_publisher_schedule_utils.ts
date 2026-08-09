export function scheduleScrollSend(
  setTimeoutFn: typeof setTimeout,
  sendFn: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  return setTimeoutFn(sendFn, delayMs);
}

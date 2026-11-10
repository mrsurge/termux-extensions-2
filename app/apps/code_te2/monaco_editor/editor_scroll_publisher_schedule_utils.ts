export function scheduleScrollSend(
  setTimeoutFn: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
  sendFn: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  return setTimeoutFn(sendFn, delayMs);
}

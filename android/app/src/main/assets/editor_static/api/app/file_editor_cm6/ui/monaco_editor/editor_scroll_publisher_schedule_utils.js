export function scheduleScrollSend(setTimeoutFn, sendFn, delayMs) {
  return setTimeoutFn(sendFn, delayMs);
}

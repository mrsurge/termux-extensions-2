export function shouldSendScrollImmediately(
  now: number,
  lastSentAt: number,
  thresholdMs: number,
): boolean {
  return (now - lastSentAt) > thresholdMs;
}

export function shouldSendScrollImmediately(now, lastSentAt, thresholdMs) {
  return (now - lastSentAt) > thresholdMs;
}

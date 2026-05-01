export function registerConsoleWorker(
  sock: MonacoRuntimeSocketLike | null | undefined,
  workerId: string,
  role: string,
): void {
  if (!sock || typeof sock.emit !== 'function') return;
  sock.emit('console:register', { workerId, role });
}

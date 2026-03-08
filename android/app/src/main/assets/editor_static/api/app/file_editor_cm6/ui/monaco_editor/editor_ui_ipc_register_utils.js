export function registerConsoleWorker(sock, workerId, role) {
  if (!sock) return;
  sock.emit('console:register', { workerId: workerId, role: role });
}

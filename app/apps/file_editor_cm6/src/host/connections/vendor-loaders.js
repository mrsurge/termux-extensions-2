// @ts-check

export function ensureSocketIoLoaded() {
  if (window.io) return Promise.resolve(window.io);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/static/vendor/socket.io.min.js';
    script.async = true;
    script.onload = () => resolve(window.io);
    script.onerror = () => reject(new Error('Failed to load Socket.IO client'));
    document.head.appendChild(script);
  });
}

export function ensureVConsoleLoaded() {
  if (window.VConsole) return Promise.resolve(window.VConsole);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js';
    script.async = true;
    script.onload = () => resolve(window.VConsole);
    script.onerror = () => reject(new Error('Failed to load vConsole'));
    document.head.appendChild(script);
  });
}

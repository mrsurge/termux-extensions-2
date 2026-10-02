import { chooseTerminalDestination } from './te_terminal_destination.mjs';

export function embeddedContext(search) {
  const params = new URLSearchParams(search);
  const hostId = params.get('te2_host_id') || '';
  if (!hostId) return null;
  const clientId = params.get('clientInstanceId') || '';
  const presentationId = params.get('presentationId') || '';
  if (!clientId || !presentationId) throw new Error('Sidebar presentation context is incomplete');
  return { clientId, hostId, presentationId };
}

export function createFileExplorerIntents({ api, location, dialog, randomId }) {
  async function dispatch(intent, payload) {
    const context = embeddedContext(location.search);
    if (!context) return false;
    await api.post('intent', { intent, context, payload });
    return true;
  }
  return {
    async openFile(path) {
      if (!await dispatch('document.open', { path })) {
        location.href = `/app/file_editor?file=${encodeURIComponent(path)}`;
      }
    },
    async openTerminal(directory) {
      if (!embeddedContext(location.search)) {
        location.href = `/app/terminal?cwd=${encodeURIComponent(directory)}&new_session=${randomId()}`;
        return;
      }
      const destination = await chooseTerminalDestination(dialog);
      if (destination) await dispatch('terminal.createSession', { directory, destination });
    },
  };
}

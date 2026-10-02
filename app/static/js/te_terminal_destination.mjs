export async function chooseTerminalDestination(dialog) {
  const result = await dialog.open({
    kind: 'surface', title: 'Open in Terminal', message: 'Start a new session in:',
    surface: { id: 'code-te2.terminal-destination' },
    actions: [
      { id: 'cancel', label: 'Cancel', role: 'cancel' },
      { id: 'sidebar', label: 'Sidebar', role: 'accept' },
      { id: 'drawer', label: 'Drawer', role: 'accept', primary: true },
    ],
    defaultAction: 'drawer', cancelAction: 'cancel',
  });
  return result.status === 'accepted' && (result.action === 'sidebar' || result.action === 'drawer')
    ? result.action : null;
}

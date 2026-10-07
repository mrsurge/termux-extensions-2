export async function chooseTerminalDestination(dialog, preferences) {
  let remembered = 'ask';
  try { if (preferences) remembered = await preferences.read(); }
  catch (error) {
    if (!preferences?.onError) throw error;
    preferences.onError(error);
  }
  if (remembered === 'drawer' || remembered === 'sidebar') return remembered;
  const result = await dialog.open({
    kind: 'surface', title: 'Open in Terminal', message: 'Start a new session in:',
    surface: { id: 'code-te2.terminal-destination' },
    fields: [{ key: 'remember', kind: 'checkbox', label: "Don't ask again on this client", value: false }],
    actions: [
      { id: 'cancel', label: 'Cancel', role: 'cancel' },
      { id: 'sidebar', label: 'Sidebar', role: 'accept' },
      { id: 'drawer', label: 'Drawer', role: 'accept', primary: true },
    ],
    defaultAction: 'drawer', cancelAction: 'cancel',
  });
  const destination = result.status === 'accepted' && (result.action === 'sidebar' || result.action === 'drawer')
    ? result.action : null;
  if (destination && result.values?.remember === true && preferences) {
    try { await preferences.write(destination); }
    catch (error) {
      if (!preferences.onError) throw error;
      preferences.onError(error);
    }
  }
  return destination;
}

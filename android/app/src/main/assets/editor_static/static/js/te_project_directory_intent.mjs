// Transport-neutral UI consent; project authority and tickets stay in Code TE2.
export async function openProjectDirectory({ directory, request, dialog }) {
  const prepared = await request({ action: 'prepare', directory });
  if (!prepared || prepared.ok !== true || typeof prepared.ticket !== 'string') {
    throw new Error(prepared?.reason || 'Project opening could not be prepared');
  }
  let accepted = prepared.requiresConfirmation !== true;
  try {
    if (!accepted) accepted = await dialog.confirm(
      'Switch projects? Unsaved draft changes could be lost if files change outside TE2.',
      { title: 'Open as Project', detail: prepared.path });
  } catch (error) {
    await request({ action: 'cancel', ticket: prepared.ticket }).catch(() => {});
    throw error;
  }
  const result = await request({ action: accepted ? 'commit' : 'cancel', ticket: prepared.ticket });
  if (!result || result.ok !== true) throw new Error(result?.reason || 'Project opening failed');
  return accepted;
}

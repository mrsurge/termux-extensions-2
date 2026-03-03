export function handleFindCommand(payload, editor, runFindCommandFn) {
  var action = payload && payload.action ? String(payload.action) : 'find';
  console.log('[Find] iframe received editor:find_cmd action=', action, 'editor=', !!editor);
  runFindCommandFn(editor, action, function (e) { console.error('[Find] _runFindCommand error:', e); });
}

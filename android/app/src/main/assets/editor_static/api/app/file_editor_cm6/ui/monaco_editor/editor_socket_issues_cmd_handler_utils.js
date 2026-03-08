export function handleIssuesCommand(payload, editor, runIssuesCommandFn) {
  var action = payload && payload.action ? String(payload.action) : '';
  if (!action) return;
  runIssuesCommandFn(editor, action);
}

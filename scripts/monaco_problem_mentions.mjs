// Build-time adapter for the pinned Monaco Problems peek widget. Keep vendor
// sources untouched and fail closed if upstream changes the integration points.
export function addProblemMentionAction(source) {
  function replaceOnce(before, after) {
    if (source.split(before).length !== 2) {
      throw new Error('Pinned Problems widget changed; review mention integration before building');
    }
    source = source.replace(before, after);
  }
  replaceOnce("import { getFlatActionBarActions }", "import { Action as Te2MentionAction } from '../../../../base/common/actions.js';\nimport { getFlatActionBarActions }");
  replaceOnce('        this._actionbarWidget.push(actions, { label: false, icon: true, index: 0 });', `        this._actionbarWidget.push(actions, { label: false, icon: true, index: 0 });
        this._te2MentionAction = new Te2MentionAction(
            'te2.problem.mention', 'Mention in conversation',
            'codicon codicon-comment-discussion', false, () => {
                const snapshot = this._te2MentionSnapshot;
                const model = this.editor.getModel();
                if (!snapshot || model !== snapshot.model || model.isDisposed()
                    || model.getVersionId() !== snapshot.version) return;
                const node = this.editor.getContainerDomNode();
                const EventType = node?.ownerDocument.defaultView?.CustomEvent;
                if (node && EventType) node.dispatchEvent(new EventType('te2:problem-mention', {
                    detail: snapshot,
                }));
            });
        this._te2MentionAction.tooltip = 'Mention in conversation';
        this._disposables.add(this._te2MentionAction);
        this._actionbarWidget.push(this._te2MentionAction, { label: false, icon: true, index: 0 });`);
  replaceOnce('    showAtMarker(marker, markerIdx, markerCount) {', `    _te2CaptureMention(marker) {
        const model = this.editor.getModel();
        this._te2MentionSnapshot = model ? {
            model, version: model.getVersionId(), marker: { ...marker },
        } : undefined;
        this._te2MentionAction.enabled = !!model;
    }
    showAtMarker(marker, markerIdx, markerCount) {
        this._te2CaptureMention(marker);`);
  replaceOnce("    updateMarker(marker) {\n        this._container.classList.remove('stale');", "    updateMarker(marker) {\n        this._te2CaptureMention(marker);\n        this._container.classList.remove('stale');");
  replaceOnce("    showStale() {\n        this._container.classList.add('stale');", "    showStale() {\n        this._te2MentionSnapshot = undefined;\n        this._te2MentionAction.enabled = false;\n        this._container.classList.add('stale');");
  return source;
}

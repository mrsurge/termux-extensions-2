// @ts-check

/**
 * @param {{
 *   bindMenuToggle: (el: HTMLElement, action: () => any) => void,
 *   els: {
 *     miToggleLines: HTMLElement,
 *     miToggleShading: HTMLElement,
 *     miToggleIndentGuides: HTMLElement,
 *     miToggleSyntax: HTMLElement,
 *     miToggleCloseBrackets: HTMLElement,
 *     miToggleAutocomplete: HTMLElement,
 *     miToggleInlayHints: HTMLElement,
 *     miToggleWrap: HTMLElement,
 *     miToggleColorPicker: HTMLElement,
 *     miToggleMinimap: HTMLElement,
 *     miToggleStickyScroll: HTMLElement,
 *   },
 *   getEditorViewState: () => any,
 *   updatePreference: (key: string, value: any) => Promise<boolean>,
 *   toast: (msg: string) => void,
 * }} deps
 */
export function installSimplePreferenceMenuActions(deps: any) {
  const t = deps.bindMenuToggle;
  const s = () => deps.getEditorViewState();

  t(deps.els.miToggleLines, async () => {
    const ok = await deps.updatePreference('showLineNumbers', !(s()?.showLineNumbers));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleShading, async () => {
    const ok = await deps.updatePreference('showShading', !(s()?.showShading));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleIndentGuides, async () => {
    const ok = await deps.updatePreference('showIndentGuides', !(s()?.showIndentGuides));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleSyntax, async () => {
    const ok = await deps.updatePreference('showSyntax', !(s()?.showSyntax));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleCloseBrackets, async () => {
    const ok = await deps.updatePreference('autoCloseBrackets', !(s()?.autoCloseBrackets));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleAutocomplete, async () => {
    const ok = await deps.updatePreference('autocompletion', !(s()?.autocompletion));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleInlayHints, async () => {
    const ok = await deps.updatePreference('showInlayHints', !(s()?.showInlayHints));
    if (!ok) deps.toast('Failed to update inlay hints preference');
  });
  t(deps.els.miToggleWrap, async () => {
    const ok = await deps.updatePreference('wordWrap', !(s()?.wordWrap));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleColorPicker, async () => {
    const ok = await deps.updatePreference('colorPicker', !(s()?.colorPicker));
    if (!ok) deps.toast('Failed to update color picker');
  });
  t(deps.els.miToggleMinimap, async () => {
    const ok = await deps.updatePreference('showMinimap', !(s()?.showMinimap));
    if (!ok) deps.toast('Failed to update preference');
  });
  t(deps.els.miToggleStickyScroll, async () => {
    const ok = await deps.updatePreference('stickyScroll', !(s()?.stickyScroll));
    if (!ok) deps.toast('Failed to update sticky scroll preference');
  });
}

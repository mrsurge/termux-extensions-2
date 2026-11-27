const key = 'code_te2:font-ligatures';
const changed = 'code-te2:font-ligatures-changed';

export function fontLigaturesEnabled(): boolean {
  try { return window.localStorage.getItem(key) === 'on'; } catch { return false; }
}

export function setFontLigatures(enabled: boolean): void {
  window.localStorage.setItem(key, enabled ? 'on' : 'off');
  window.dispatchEvent(new Event(changed));
}

export function observeFontLigatures(apply: (enabled: boolean) => void): () => void {
  const refresh = () => apply(fontLigaturesEnabled());
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && (event.key === key || event.key === null)) refresh();
  };
  window.addEventListener(changed, refresh);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(changed, refresh); window.removeEventListener('storage', onStorage); };
}

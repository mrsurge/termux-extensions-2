import type { ShortcutIcon } from './types.ts';
import { normStr } from './utils.ts';

export function agentIconUrlFromName(name: unknown): string {
  const safe = normStr(name);
  if (!safe) return '';
  return `/api/app/file_editor_cm6/agent_icons/${encodeURIComponent(safe)}`;
}

export function renderIconNode(icon: unknown, sizePx: number | null = 16, fallbackText = ''): HTMLElement {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'center';
  if (sizePx === null) {
    wrap.style.width = '100%';
    wrap.style.height = '100%';
  } else {
    wrap.style.width = `${sizePx}px`;
    wrap.style.height = `${sizePx}px`;
  }

  const i = icon && typeof icon === 'object' && !Array.isArray(icon) ? icon as ShortcutIcon : null;
  if (!i) {
    if (fallbackText) wrap.textContent = fallbackText;
    return wrap;
  }

  if (i.kind === 'emoji') {
    wrap.textContent = normStr(i.emoji);
    return wrap;
  }

  if (i.kind === 'text') {
    wrap.textContent = normStr(i.text);
    return wrap;
  }

  if (i.kind === 'asset') {
    const src = agentIconUrlFromName(i.name);
    if (!src) {
      if (fallbackText) wrap.textContent = fallbackText;
      return wrap;
    }
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    wrap.appendChild(img);
    return wrap;
  }

  if (i.kind === 'image') {
    const src = normStr(i.src || i.value);
    if (!src) {
      if (fallbackText) wrap.textContent = fallbackText;
      return wrap;
    }
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    wrap.appendChild(img);
    return wrap;
  }

  if (fallbackText) wrap.textContent = fallbackText;
  return wrap;
}

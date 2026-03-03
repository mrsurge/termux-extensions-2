// src/host/utils.js — Pure utility functions for path manipulation and language detection

export const HOME_DIR = '/data/data/com.termux/files/home';
export const HOME_PREFIX = `${HOME_DIR}/`;

export function simplifyAbsolute(path) {
  if (!path) return '/';
  const segments = [];
  const parts = String(path).split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (segments.length) segments.pop(); continue; }
    segments.push(part);
  }
  return '/' + segments.join('/');
}

export function toAbsolute(path, base = null, homeDir=HOME_DIR) {
  if (!path) return simplifyAbsolute(base || homeDir);
  let value = String(path).trim();
  if (!value) return simplifyAbsolute(base || homeDir);
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return simplifyAbsolute(`${homeDir}/${value.slice(2)}`);
  if (value.startsWith('/')) return simplifyAbsolute(value);
  const origin = toAbsolute(base || homeDir, null, homeDir);
  return simplifyAbsolute(`${origin.replace(/\/+$/, '')}/${value}`);
}

export function parentDir(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/' || abs === '') return '/';
  if (abs === HOME_DIR) return '/';
  const trimmed = abs.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return trimmed.slice(0, idx) || '/';
}

export function basename(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/') return '/';
  const parts = abs.split('/');
  return parts[parts.length - 1] || '/';
}

export function formatDisplayPath(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === HOME_DIR) return '~';
  if (abs.startsWith(HOME_PREFIX)) return `~/${abs.slice(HOME_PREFIX.length)}`;
  return abs;
}

export function formatDisplayDirectory(path) {
  const abs = toAbsolute(path || HOME_DIR);
  const dir = parentDir(abs);
  if (!dir || dir === abs) {
    return formatDisplayPath(abs);
  }
  return formatDisplayPath(dir);
}

export function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'css', less: 'css',
    html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown',
    py: 'python', pyw: 'python',
    kt: 'kotlin', kts: 'kotlin',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    ksh: 'shell', csh: 'shell', tcsh: 'shell',
    xml: 'xml', svg: 'xml',
  };
  return map[ext] || null;
}

export const RUNNABLE_EXTENSIONS = new Set(['.py', '.pyw', '.sh', '.bash', '.zsh', '.c', '.cc', '.cpp', '.cxx']);

export function isRunnableFile(path) {
  if (!path) return false;
  const normalized = String(path).toLowerCase().trim();
  const idx = normalized.lastIndexOf('.');
  if (idx === -1) return false;
  const ext = normalized.slice(idx);
  return RUNNABLE_EXTENSIONS.has(ext);
}

export function setMenuChecked(element, checked) {
  if (!element) return;
  element.classList.toggle('fe-menu-item-checked', !!checked);
  element.setAttribute('aria-checked', checked ? 'true' : 'false');
}

export const FONT_SCALE_PRESETS = {
  small: 0.70,
  medium: 0.85,
  large: 1.0
};

export function requireEl(selector, scope=document) {
  const el = scope.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

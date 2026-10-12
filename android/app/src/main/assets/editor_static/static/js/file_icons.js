// Complete existing Seti filename rules, without its SVG-inventory loader.
let definitionsPromise;
const iconRequests = new Map();
const LOGO_FAMILIES = new Set(['rust', 'javascript', 'typescript', 'python']);

function loadDefinitions() {
  return definitionsPromise ||= fetch('/static/vendor/seti-icons/definitions.json')
    .then(async response => {
      if (!response.ok) throw new Error('File icon mappings unavailable');
      return response.json();
    });
}

async function classifyFileName(fileName) {
  const defs = await loadDefinitions();
  if (!fileName) return defs.default?.[0] || 'default';
  if (Object.hasOwn(defs.files || {}, fileName)) return defs.files[fileName][0];
  let extension = fileName.slice(fileName.indexOf('.'));
  while (extension !== '') {
    const lookup = extension.toLowerCase() === '.mjs' ? '.js' : extension;
    if (Object.hasOwn(defs.extensions || {}, lookup)) return defs.extensions[lookup][0];
    extension = extension.slice(1);
    extension = extension.slice(extension.indexOf('.'));
  }
  for (const [partial, details] of defs.partials || []) {
    if (fileName.includes(partial)) return details[0];
  }
  return defs.default?.[0] || 'default';
}

function loadFamilySvg(family) {
  if (!/^[A-Za-z0-9_-]+$/.test(family) || !Object.hasOwn(FILE_TYPE_CODICONS, family)) return Promise.resolve(null);
  if (!iconRequests.has(family)) {
    iconRequests.set(family, (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`/static/vendor/seti-icons/individual/${family}.svg`, { signal: controller.signal });
        if (!response.ok || Number(response.headers.get('content-length')) > 65536) return null;
        const reader = response.body?.getReader();
        if (!reader) return null;
        const chunks = []; let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) { await reader.cancel(); return null; }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return svg.trimStart().startsWith('<svg ') ? svg : null;
      } catch { return null; }
      finally { clearTimeout(timer); }
    })());
  }
  return iconRequests.get(family);
}

// One presentation-provider seam. Classification stays shared with the Explorer;
// provider selection/preferences are intentionally not implemented by this trial.
const FILE_TYPE_CODICONS = {
  default: 'file', ignored: 'file', python: 'python', ruby: 'ruby',
  markdown: 'markdown', rmd: 'markdown', json: 'json',
  shell: 'terminal-bash', powershell: 'terminal-powershell', windows: 'terminal-cmd',
  audio: 'file-media', video: 'file-media', image: 'file-media', svg: 'file-media',
  favicon: 'file-media', illustrator: 'file-media', photoshop: 'file-media',
  zip: 'file-zip', wasm: 'file-binary', db: 'database', csv: 'table', xls: 'table',
  css: 'symbol-color', less: 'symbol-color', sass: 'symbol-color', stylus: 'symbol-color',
  config: 'settings-gear', tsconfig: 'settings-gear', yml: 'settings-gear',
  eslint: 'settings-gear', stylelint: 'settings-gear', babel: 'settings-gear',
  npm: 'package', npm_ignored: 'package', yarn: 'package', bower: 'package',
  docker: 'package', lock: 'lock', pdf: 'file-pdf', git: 'source-control',
  license: 'file-text', word: 'file-text', tex: 'file-text', argdown: 'file-text',
  info: 'info', todo: 'checklist', clock: 'clock', font: 'file-text',
  // Codicons has no language-logo glyph for these classifier families. Keep
  // every known family explicit rather than silently treating it as unknown.
  R: 'file-code', asm: 'file-code', bsl: 'file-code', c: 'file-code',
  'c-sharp': 'file-code', cake: 'file-code', cake_php: 'file-code',
  clojure: 'file-code', coffee: 'file-code', coldfusion: 'file-code',
  crystal: 'file-code', crystal_embedded: 'file-code', cpp: 'file-code',
  d: 'file-code', dart: 'file-code', ejs: 'file-code', elixir: 'file-code',
  elixir_script: 'file-code', elm: 'file-code', 'f-sharp': 'file-code',
  go: 'file-code', go2: 'file-code', grails: 'file-code', graphql: 'file-code',
  haml: 'file-code', haskell: 'file-code', haxe: 'file-code', hex: 'file-binary',
  html: 'file-code', html_erb: 'file-code', jade: 'file-code', java: 'file-code',
  javascript: 'file-code', jinja: 'file-code', julia: 'file-code',
  kotlin: 'file-code', liquid: 'file-code', livescript: 'file-code', lua: 'file-code',
  mdo: 'file-code', mustache: 'file-code', nunjucks: 'file-code', ocaml: 'file-code',
  odata: 'file-code', pddl: 'file-code', perl: 'file-code', php: 'file-code',
  prolog: 'file-code', pug: 'file-code', react: 'file-code', reasonml: 'file-code',
  rust: 'file-code', scala: 'file-code', slim: 'file-code', smarty: 'file-code',
  swift: 'file-code', twig: 'file-code', typescript: 'file-code', vala: 'file-code',
  vue: 'file-code', wat: 'file-code', xml: 'file-code',
  'code-climate': 'settings-gear', 'code-search': 'search',
  ethereum: 'package', firebase: 'cloud', firefox: 'browser', gradle: 'tools',
  grunt: 'tools', gulp: 'tools', happenings: 'calendar', heroku: 'cloud',
  ionic: 'package', jenkins: 'tools', karma: 'beaker', makefile: 'tools',
  maven: 'tools', plan: 'file-text', platformio: 'circuit-board', puppet: 'tools',
  rollup: 'tools', salesforce: 'cloud', sbt: 'tools', spring: 'package',
  sublime: 'settings-gear', terraform: 'cloud', webpack: 'tools', wgt: 'package',
};

export function ensureLoaded() { return loadDefinitions(); }

export async function getIcon(fileName) {
  const name = String(fileName || '').split(/[\\/]/).pop();
  const iconName = /\.(?:mjs|cjs|js|jsx)$/i.test(name) ? 'javascript'
    : /\.(?:py|pyc|pyi|ipynb|pyx|pxd|pxi)$/i.test(name) ? 'python'
    : /\.(?:ts|tsx|mts|cts)$/i.test(name) ? 'typescript'
    : await classifyFileName(name);
  const codicon = /\.(txt|log)$/i.test(name) ? 'file-text'
    : FILE_TYPE_CODICONS[iconName] || 'file-code';
  const color = 'var(--te-file-icon-color, #8293a8)';
  if (LOGO_FAMILIES.has(iconName) || codicon === 'file-code') {
    const svg = await loadFamilySvg(iconName);
    if (svg) return { iconName, svg, color };
  }
  return { iconName, codicon, color };
}

// Callers own connected/recycled-element fences. Preserve their sizing classes.
export function renderIcon(element, icon) {
  if (!icon) return false;
  if (icon.codicon && /^[a-z0-9-]+$/.test(icon.codicon)) {
    element.replaceChildren();
    for (const name of [...element.classList]) {
      if (name === 'codicon' || name.startsWith('codicon-')) element.classList.remove(name);
    }
    element.classList.add('codicon', `codicon-${icon.codicon}`);
    element.classList.remove('te-file-language-icon');
  } else if (icon.svg) {
    // Fixed vendored assets only: mask ignores source colors like ALS does.
    for (const name of [...element.classList]) {
      if (name === 'codicon' || name.startsWith('codicon-')) element.classList.remove(name);
    }
    const mask = element.ownerDocument.createElement('span');
    const svg = icon.svg.includes('xmlns=') ? icon.svg
      : icon.svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    mask.style.cssText = 'display:block;width:100%;height:100%;background-color:currentColor;';
    mask.style.mask = `${url} center / contain no-repeat`;
    mask.style.webkitMask = `${url} center / contain no-repeat`;
    element.replaceChildren(mask);
    element.classList.add('te-file-language-icon');
  } else return false;
  element.style.color = icon.color || '';
  return true;
}

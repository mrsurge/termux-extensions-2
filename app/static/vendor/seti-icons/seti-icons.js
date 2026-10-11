// app/static/vendor/seti-icons/seti-icons.js
// Browser-friendly wrapper for the MIT-licensed `seti-icons` mappings.
// Loads JSON once, then exposes async getIcon(fileName).

let _definitions = null;
let _icons = null;
let _loadPromise = null;
let _definitionsPromise = null;

function ensureDefinitionsLoaded() {
  if (!_definitionsPromise) {
    _definitionsPromise = fetch('/static/vendor/seti-icons/definitions.json')
      .then(r => { if (!r.ok) throw new Error('Failed to load file icon definitions'); return r.json(); })
      .then(defs => { _definitions = defs; });
  }
  return _definitionsPromise;
}

// Share the Explorer's filename rules without loading Seti SVGs or colors.
export async function getIconName(fileName) {
  await ensureDefinitionsLoaded();
  return getDetails(fileName)[0];
}

export const defaultTheme = {
  blue: '#268bd2',
  green: '#859900',
  red: '#dc322f',
  orange: '#cb4b16',
  yellow: '#b58900',
  purple: '#6c71c4',
  pink: '#d33682',
  white: '#eee8d5',
  grey: '#657b83',
  'grey-light': '#93a1a1',
  ignore: '#586e75',
};

export function ensureLoaded() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = Promise.all([
    ensureDefinitionsLoaded(),
    fetch('/static/vendor/seti-icons/icons.json').then((r) => r.json()),
  ])
    .then(([, icons]) => {
      _icons = icons;
    })
    .catch((err) => {
      console.warn('[seti-icons] Failed to load mappings:', err);
      _icons = null;
      throw err;
    });
  return _loadPromise;
}

function getDetails(fileName) {
  const defs = _definitions;
  if (!defs || !fileName) return defs?.default || ['default', 'white'];

  if (defs.files && Object.prototype.hasOwnProperty.call(defs.files, fileName)) {
    return defs.files[fileName];
  }

  let extension = fileName.slice(fileName.indexOf('.'));
  while (extension !== '') {
    // Seti's vendored table predates ES modules; share the JS icon and theme color.
    const lookup = extension.toLowerCase() === '.mjs' ? '.js' : extension;
    if (
      defs.extensions &&
      Object.prototype.hasOwnProperty.call(defs.extensions, lookup)
    ) {
      return defs.extensions[lookup];
    }
    // look for next "."
    extension = extension.slice(1);
    extension = extension.slice(extension.indexOf('.'));
  }

  for (const partial of defs.partials || []) {
    if (fileName.indexOf(partial[0]) > -1) {
      return partial[1];
    }
  }

  return defs.default || ['default', 'white'];
}

export async function getIcon(fileName, theme = defaultTheme) {
  if (!_definitions || !_icons) {
    await ensureLoaded();
  }
  const [iconName, colorKey] = getDetails(fileName);
  const svg = (_icons && _icons[iconName]) || (_icons && _icons.default) || '';
  const color = (theme && theme[colorKey]) || theme.white || null;
  return { svg, colorKey, color, iconName };
}

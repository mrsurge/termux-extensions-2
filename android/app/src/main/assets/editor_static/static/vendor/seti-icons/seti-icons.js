// app/static/vendor/seti-icons/seti-icons.js
// Browser-friendly wrapper for the MIT-licensed `seti-icons` mappings.
// Loads JSON once, then exposes async getIcon(fileName).

let _definitions = null;
let _icons = null;
let _loadPromise = null;

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
    fetch('/static/vendor/seti-icons/definitions.json').then((r) => r.json()),
    fetch('/static/vendor/seti-icons/icons.json').then((r) => r.json()),
  ])
    .then(([defs, icons]) => {
      _definitions = defs;
      _icons = icons;
    })
    .catch((err) => {
      console.warn('[seti-icons] Failed to load mappings:', err);
      _definitions = null;
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
    if (
      defs.extensions &&
      Object.prototype.hasOwnProperty.call(defs.extensions, extension)
    ) {
      return defs.extensions[extension];
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


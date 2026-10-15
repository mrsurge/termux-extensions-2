import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ stdin: { contents: `
  export { TokenTheme } from '../../static/vendor/monaco-editor-core/esm/vs/editor/common/languages/supports/tokenization.js';
  export { Color } from '../../static/vendor/monaco-editor-core/esm/vs/base/common/color.js';
  export { TokenMetadata } from '../../static/vendor/monaco-editor-core/esm/vs/editor/common/encodedTokenAttributes.js';
`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'esm' });
const { TokenTheme, Color, TokenMetadata } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const hex = value => value && Color.Format.CSS.formatHexA(value, true).toUpperCase();

test('TextMate alpha palette reindex is safe, index-preserving and repeatable', () => {
  const theme = TokenTheme.createFromRawTokenTheme([
    { token: '', foreground: 'BFBDB6', background: '0B0E14' },
    { token: 'keyword', foreground: 'FF8F40' },
  ], []);
  // Includes Based Ayu-style translucent entries and repeated RGB values.
  const palette = [undefined, '#BFBDB6', '#0B0E14', '#ACB6BF8C', '#FF8F40', '#BFBDB605', '#FF8F40', '#BFBDB60F'].map(value => value && Color.fromHex(value));
  for (let i = 0; i < 3; i++) {
    assert.doesNotThrow(() => theme.reindexToColorMap(palette));
    assert.deepEqual(Array.from(theme.getColorMap(), hex), palette.map(hex));
    assert.equal(TokenMetadata.getForeground(theme.match(1, 'keyword')), 4);
  }
});

test('adopting an identical-index palette still updates extra colors and alpha', () => {
  const theme = TokenTheme.createFromRawTokenTheme([{ token: '', foreground: 'FFFFFF', background: '000000' }], []);
  const palette = [undefined, '#FFFFFF', '#000000', '#FFFFFF80'].map(value => value && Color.fromHex(value));
  theme.reindexToColorMap(palette);
  assert.deepEqual(Array.from(theme.getColorMap(), hex), palette.map(hex));
});

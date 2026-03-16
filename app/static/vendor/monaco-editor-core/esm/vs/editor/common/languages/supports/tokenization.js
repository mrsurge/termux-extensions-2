/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Color } from '../../../../base/common/color.js';
export class ParsedTokenThemeRule {
    constructor(token, index, fontStyle, foreground, background) {
        this._parsedThemeRuleBrand = undefined;
        this.token = token;
        this.index = index;
        this.fontStyle = fontStyle;
        this.foreground = foreground;
        this.background = background;
    }
}
/**
 * Parse a raw theme into rules.
 */
export function parseTokenTheme(source) {
    if (!source || !Array.isArray(source)) {
        return [];
    }
    const result = [];
    let resultLen = 0;
    for (let i = 0, len = source.length; i < len; i++) {
        const entry = source[i];
        let fontStyle = -1 /* FontStyle.NotSet */;
        if (typeof entry.fontStyle === 'string') {
            fontStyle = 0 /* FontStyle.None */;
            const segments = entry.fontStyle.split(' ');
            for (let j = 0, lenJ = segments.length; j < lenJ; j++) {
                const segment = segments[j];
                switch (segment) {
                    case 'italic':
                        fontStyle = fontStyle | 1 /* FontStyle.Italic */;
                        break;
                    case 'bold':
                        fontStyle = fontStyle | 2 /* FontStyle.Bold */;
                        break;
                    case 'underline':
                        fontStyle = fontStyle | 4 /* FontStyle.Underline */;
                        break;
                    case 'strikethrough':
                        fontStyle = fontStyle | 8 /* FontStyle.Strikethrough */;
                        break;
                }
            }
        }
        let foreground = null;
        if (typeof entry.foreground === 'string') {
            foreground = entry.foreground;
        }
        let background = null;
        if (typeof entry.background === 'string') {
            background = entry.background;
        }
        result[resultLen++] = new ParsedTokenThemeRule(entry.token || '', i, fontStyle, foreground, background);
    }
    return result;
}
/**
 * Resolve rules (i.e. inheritance).
 */
function resolveParsedTokenThemeRules(parsedThemeRules, customTokenColors) {
    // Sort rules lexicographically, and then by index if necessary
    parsedThemeRules.sort((a, b) => {
        const r = strcmp(a.token, b.token);
        if (r !== 0) {
            return r;
        }
        return a.index - b.index;
    });
    // Determine defaults
    let defaultFontStyle = 0 /* FontStyle.None */;
    let defaultForeground = '000000';
    let defaultBackground = 'ffffff';
    while (parsedThemeRules.length >= 1 && parsedThemeRules[0].token === '') {
        const incomingDefaults = parsedThemeRules.shift();
        if (incomingDefaults.fontStyle !== -1 /* FontStyle.NotSet */) {
            defaultFontStyle = incomingDefaults.fontStyle;
        }
        if (incomingDefaults.foreground !== null) {
            defaultForeground = incomingDefaults.foreground;
        }
        if (incomingDefaults.background !== null) {
            defaultBackground = incomingDefaults.background;
        }
    }
    const colorMap = new ColorMap();
    // start with token colors from custom token themes
    for (const color of customTokenColors) {
        colorMap.getId(color);
    }
    const foregroundColorId = colorMap.getId(defaultForeground);
    const backgroundColorId = colorMap.getId(defaultBackground);
    const defaults = new ThemeTrieElementRule(defaultFontStyle, foregroundColorId, backgroundColorId);
    const root = new ThemeTrieElement(defaults);
    for (let i = 0, len = parsedThemeRules.length; i < len; i++) {
        const rule = parsedThemeRules[i];
        root.insert(rule.token, rule.fontStyle, colorMap.getId(rule.foreground), colorMap.getId(rule.background));
    }
    return new TokenTheme(colorMap, root);
}
const colorRegExp = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;
export class ColorMap {
    constructor() {
        this._lastColorId = 0;
        this._id2color = [];
        this._color2id = new Map();
    }
    getId(color) {
        if (color === null) {
            return 0;
        }
        const match = color.match(colorRegExp);
        if (!match) {
            throw new Error('Illegal value for token color: ' + color);
        }
        color = match[1].toUpperCase();
        let value = this._color2id.get(color);
        if (value) {
            return value;
        }
        value = ++this._lastColorId;
        this._color2id.set(color, value);
        this._id2color[value] = Color.fromHex('#' + color);
        return value;
    }
    getColorMap() {
        return this._id2color.slice(0);
    }
}
export class TokenTheme {
    static createFromRawTokenTheme(source, customTokenColors) {
        return this.createFromParsedTokenTheme(parseTokenTheme(source), customTokenColors);
    }
    static createFromParsedTokenTheme(source, customTokenColors) {
        return resolveParsedTokenThemeRules(source, customTokenColors);
    }
    constructor(colorMap, root) {
        this._colorMap = colorMap;
        this._root = root;
        this._cache = new Map();
    }
    getColorMap() {
        return this._colorMap.getColorMap();
    }
    _match(token) {
        return this._root.match(token);
    }
    match(languageId, token) {
        // The cache contains the metadata without the language bits set.
        let result = this._cache.get(token);
        if (typeof result === 'undefined') {
            const rule = this._match(token);
            const standardToken = toStandardTokenType(token);
            result = (rule.metadata
                | (standardToken << 8 /* MetadataConsts.TOKEN_TYPE_OFFSET */)) >>> 0;
            this._cache.set(token, result);
        }
        return (result
            | (languageId << 0 /* MetadataConsts.LANGUAGEID_OFFSET */)) >>> 0;
    }
    /**
     * TE2: Reindex the entire rule trie so that foreground/background color
     * indices match a new authoritative color map (e.g. the TextMate palette).
     * After this call, match() returns indices that correspond directly to the
     * CSS .mtk* rules generated from the same palette — no runtime translation.
     *
     * @param newColorMap Color[] — the authoritative palette (index 0 = null).
     */
    reindexToColorMap(newColorMap) {
        if (!newColorMap || newColorMap.length < 2) {
            return;
        }
        // Build hex→newIndex reverse lookup from the incoming palette.
        const newHexToIdx = new Map();
        for (let i = 1; i < newColorMap.length; i++) {
            const c = newColorMap[i];
            if (!c) continue;
            const hex = c.toString().toUpperCase().replace('#', '');
            // Normalise 6-char uppercase hex (strip alpha if present)
            const norm = hex.length >= 6 ? hex.substring(0, 6) : hex;
            if (!newHexToIdx.has(norm)) {
                newHexToIdx.set(norm, i);
            }
        }
        // Build oldIndex→hex from current colorMap.
        const oldColors = this._colorMap.getColorMap(); // Color[]
        const translation = new Array(oldColors.length);
        translation[0] = 0;
        let changed = 0;
        for (let j = 1; j < oldColors.length; j++) {
            if (!oldColors[j]) { translation[j] = j; continue; }
            const hex = oldColors[j].toString().toUpperCase().replace('#', '');
            const norm = hex.length >= 6 ? hex.substring(0, 6) : hex;
            const mapped = newHexToIdx.get(norm);
            if (mapped !== undefined) {
                translation[j] = mapped;
                if (mapped !== j) changed++;
            } else {
                // Color not in new palette — find nearest by RGB distance.
                translation[j] = this._findNearestIndex(norm, newColorMap);
                changed++;
            }
        }
        if (changed === 0) {
            return; // Palettes already agree.
        }
        // Walk the trie and rewrite every rule's foreground + background.
        TokenTheme._reindexNode(this._root, translation);
        // Replace internal ColorMap with one built from the new palette.
        const cm = new ColorMap();
        for (let k = 1; k < newColorMap.length; k++) {
            if (!newColorMap[k]) continue;
            const hex = newColorMap[k].toString().toUpperCase().replace('#', '');
            const norm = hex.length >= 6 ? hex.substring(0, 6) : hex;
            cm.getId(norm);
        }
        this._colorMap = cm;
        this._cache.clear();
    }
    _findNearestIndex(hexNorm, palette) {
        const r0 = parseInt(hexNorm.substring(0, 2), 16);
        const g0 = parseInt(hexNorm.substring(2, 4), 16);
        const b0 = parseInt(hexNorm.substring(4, 6), 16);
        let bestIdx = 1;
        let bestDist = Infinity;
        for (let i = 1; i < palette.length; i++) {
            if (!palette[i]) continue;
            const h = palette[i].toString().toUpperCase().replace('#', '');
            const r = parseInt(h.substring(0, 2), 16);
            const g = parseInt(h.substring(2, 4), 16);
            const b = parseInt(h.substring(4, 6), 16);
            const d = (r0 - r) ** 2 + (g0 - g) ** 2 + (b0 - b) ** 2;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
            if (d === 0) break;
        }
        return bestIdx;
    }
    static _reindexNode(node, translation) {
        const rule = node._mainRule;
        let fg = rule._foreground;
        let bg = rule._background;
        if (fg > 0 && fg < translation.length) fg = translation[fg];
        if (bg > 0 && bg < translation.length) bg = translation[bg];
        rule._foreground = fg;
        rule._background = bg;
        rule.metadata = ((rule._fontStyle << 11 /* MetadataConsts.FONT_STYLE_OFFSET */)
            | (fg << 15 /* MetadataConsts.FOREGROUND_OFFSET */)
            | (bg << 24 /* MetadataConsts.BACKGROUND_OFFSET */)) >>> 0;
        for (const child of node._children.values()) {
            TokenTheme._reindexNode(child, translation);
        }
    }
}
const STANDARD_TOKEN_TYPE_REGEXP = /\b(comment|string|regex|regexp)\b/;
export function toStandardTokenType(tokenType) {
    const m = tokenType.match(STANDARD_TOKEN_TYPE_REGEXP);
    if (!m) {
        return 0 /* StandardTokenType.Other */;
    }
    switch (m[1]) {
        case 'comment':
            return 1 /* StandardTokenType.Comment */;
        case 'string':
            return 2 /* StandardTokenType.String */;
        case 'regex':
            return 3 /* StandardTokenType.RegEx */;
        case 'regexp':
            return 3 /* StandardTokenType.RegEx */;
    }
    throw new Error('Unexpected match for standard token type!');
}
export function strcmp(a, b) {
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}
export class ThemeTrieElementRule {
    constructor(fontStyle, foreground, background) {
        this._themeTrieElementRuleBrand = undefined;
        this._fontStyle = fontStyle;
        this._foreground = foreground;
        this._background = background;
        this.metadata = ((this._fontStyle << 11 /* MetadataConsts.FONT_STYLE_OFFSET */)
            | (this._foreground << 15 /* MetadataConsts.FOREGROUND_OFFSET */)
            | (this._background << 24 /* MetadataConsts.BACKGROUND_OFFSET */)) >>> 0;
    }
    clone() {
        return new ThemeTrieElementRule(this._fontStyle, this._foreground, this._background);
    }
    acceptOverwrite(fontStyle, foreground, background) {
        if (fontStyle !== -1 /* FontStyle.NotSet */) {
            this._fontStyle = fontStyle;
        }
        if (foreground !== 0 /* ColorId.None */) {
            this._foreground = foreground;
        }
        if (background !== 0 /* ColorId.None */) {
            this._background = background;
        }
        this.metadata = ((this._fontStyle << 11 /* MetadataConsts.FONT_STYLE_OFFSET */)
            | (this._foreground << 15 /* MetadataConsts.FOREGROUND_OFFSET */)
            | (this._background << 24 /* MetadataConsts.BACKGROUND_OFFSET */)) >>> 0;
    }
}
export class ThemeTrieElement {
    constructor(mainRule) {
        this._themeTrieElementBrand = undefined;
        this._mainRule = mainRule;
        this._children = new Map();
    }
    match(token) {
        if (token === '') {
            return this._mainRule;
        }
        const dotIndex = token.indexOf('.');
        let head;
        let tail;
        if (dotIndex === -1) {
            head = token;
            tail = '';
        }
        else {
            head = token.substring(0, dotIndex);
            tail = token.substring(dotIndex + 1);
        }
        const child = this._children.get(head);
        if (typeof child !== 'undefined') {
            return child.match(tail);
        }
        return this._mainRule;
    }
    insert(token, fontStyle, foreground, background) {
        if (token === '') {
            // Merge into the main rule
            this._mainRule.acceptOverwrite(fontStyle, foreground, background);
            return;
        }
        const dotIndex = token.indexOf('.');
        let head;
        let tail;
        if (dotIndex === -1) {
            head = token;
            tail = '';
        }
        else {
            head = token.substring(0, dotIndex);
            tail = token.substring(dotIndex + 1);
        }
        let child = this._children.get(head);
        if (typeof child === 'undefined') {
            child = new ThemeTrieElement(this._mainRule.clone());
            this._children.set(head, child);
        }
        child.insert(tail, fontStyle, foreground, background);
    }
}
export function generateTokensCSSForColorMap(colorMap) {
    const rules = [];
    for (let i = 1, len = colorMap.length; i < len; i++) {
        const color = colorMap[i];
        rules[i] = `.mtk${i} { color: ${color}; }`;
    }
    rules.push('.mtki { font-style: italic; }');
    rules.push('.mtkb { font-weight: bold; }');
    rules.push('.mtku { text-decoration: underline; text-underline-position: under; }');
    rules.push('.mtks { text-decoration: line-through; }');
    rules.push('.mtks.mtku { text-decoration: underline line-through; text-underline-position: under; }');
    return rules.join('\n');
}
//# sourceMappingURL=tokenization.js.map
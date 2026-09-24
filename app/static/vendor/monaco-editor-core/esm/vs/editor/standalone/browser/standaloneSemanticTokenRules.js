/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Color } from '../../../base/common/color.js';
// Extracted from VS Code's tokenClassificationRegistry selector scoring. The
// standalone editor has no extension-point registry; its one built-in supertype
// is the deprecated `member` classification, which inherits from `method`.
export function parseStandaloneSemanticTokenRules(colors) {
    const rules = [];
    const selectorPattern = /^(\w+[-_\w+]*|\*)(\.\w+[-_\w+]*)*(?::\w+[-_\w+]*)?$/;
    for (const [key, setting] of Object.entries(colors ?? {})) {
        if (!selectorPattern.test(key)) {
            continue;
        }
        try {
            const [classifier, language] = key.split(':');
            const [selectorType, ...selectorModifiers] = classifier.split('.');
            const data = typeof setting === 'string' ? { foreground: setting } : setting;
            const style = {};
            if (data.foreground) {
                style.foreground = Color.fromHex(data.foreground);
            }
            if (data.fontStyle !== undefined) {
                style.bold = style.italic = style.underline = style.strikethrough = false;
                for (const match of data.fontStyle.matchAll(/italic|bold|underline|strikethrough/g)) {
                    style[match[0]] = true;
                }
            }
            else {
                style.bold = data.bold;
                style.italic = data.italic;
                style.underline = data.underline;
                style.strikethrough = data.strikethrough;
            }
            rules.push({
                style,
                match(type, modifiers, modelLanguage) {
                    if (language !== undefined && language !== modelLanguage) {
                        return -1;
                    }
                    let score = language !== undefined ? 10 : 0;
                    if (selectorType !== '*') {
                        const level = type === selectorType ? 0 : type === 'member' && selectorType === 'method' ? 1 : -1;
                        if (level < 0) {
                            return -1;
                        }
                        score += 100 - level;
                    }
                    for (const modifier of selectorModifiers) {
                        if (!modifiers.includes(modifier)) {
                            return -1;
                        }
                    }
                    return score + selectorModifiers.length * 100;
                }
            });
        }
        catch {
            // An invalid rule must not prevent loading the remainder of the theme.
        }
    }
    return rules;
}
//# sourceMappingURL=standaloneSemanticTokenRules.js.map
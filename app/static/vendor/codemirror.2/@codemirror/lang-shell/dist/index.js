/* Shim for @codemirror/lang-shell: provides `shell()` via legacy-modes */
import {StreamLanguage} from '../language/dist/index.js';
import {shell as shellLegacy} from '../legacy-modes/mode/shell.js';
export function shell() { return StreamLanguage.define(shellLegacy); }
export default shell;

import { StreamLanguage } from '../language/dist/index.js';
import { shell as shellMode } from '../legacy-modes/mode/shell.js';
export function shell(){ return StreamLanguage.define(shellMode); }
export default function(){ return StreamLanguage.define(shellMode); }

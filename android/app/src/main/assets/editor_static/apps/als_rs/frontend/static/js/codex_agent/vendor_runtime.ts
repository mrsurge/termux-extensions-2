import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import diffModule from 'highlightjs-diff';
import MarkdownIt from 'markdown-it';
import { io } from 'socket.io-client';
import * as msgpackParser from 'socket.io-msgpack-parser';
import Tribute from 'tributejs';
import highlightThemeCss from 'highlight.js/styles/github-dark.min.css';
import tributeCss from 'tributejs/dist/tribute.css';

type SocketOptions = Record<string, unknown>;
type HighlightLanguageDefinition = Parameters<typeof hljs.registerLanguage>[1];

type VendorGlobal = typeof globalThis & {
  AGENT_LOG_SOCKETIO_SERIALIZER?: unknown;
  SocketIoMsgpackParser?: typeof msgpackParser;
  Tribute?: typeof Tribute;
  agentLogSocketIoOptions?: (options: Readonly<SocketOptions>) => SocketOptions;
  hljs?: typeof hljs;
  io?: typeof io;
  markdownit?: typeof MarkdownIt;
};

const runtimeGlobal = globalThis as VendorGlobal;
const diffModuleRuntime = diffModule as unknown as (
  HighlightLanguageDefinition | { default?: HighlightLanguageDefinition }
);
const diffLanguage = typeof diffModuleRuntime === 'function'
  ? diffModuleRuntime
  : diffModuleRuntime.default;

if (typeof diffLanguage !== 'function') {
  throw new TypeError('highlightjs-diff did not export a language definition');
}

function installStyle(id: string, cssText: string): void {
  if (!cssText || typeof document === 'undefined' || document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
}

function serializerMode(): string {
  return String(runtimeGlobal.AGENT_LOG_SOCKETIO_SERIALIZER || 'msgpack').trim().toLowerCase();
}

function msgpackSocketParser(): typeof msgpackParser | null {
  if (serializerMode() !== 'msgpack') return null;
  const parser = runtimeGlobal.SocketIoMsgpackParser;
  if (parser && typeof parser.Encoder === 'function' && typeof parser.Decoder === 'function') {
    return parser;
  }
  console.warn('[socketio] msgpack requested but SocketIoMsgpackParser is unavailable');
  return null;
}

hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('json', json);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('diff', diffLanguage);

runtimeGlobal.hljs = hljs;
runtimeGlobal.io = io;
runtimeGlobal.markdownit = MarkdownIt;
runtimeGlobal.SocketIoMsgpackParser = msgpackParser;
runtimeGlobal.Tribute = Tribute;
runtimeGlobal.agentLogSocketIoOptions = (options: Readonly<SocketOptions>): SocketOptions => {
  const next: SocketOptions = { ...options };
  const parser = msgpackSocketParser();
  if (parser) next.parser = parser;
  return next;
};

installStyle('vendor-highlight-github-dark', highlightThemeCss);
installStyle('vendor-tribute', tributeCss);

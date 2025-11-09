import {EditorState, Compartment, Transaction} from '@codemirror/state';
import {EditorView, keymap, highlightActiveLine, drawSelection, lineNumbers, Decoration, ViewPlugin} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle} from '@codemirror/language';
import {searchKeymap, highlightSelectionMatches} from '@codemirror/search';
import {autocompletion, closeBrackets} from '@codemirror/autocomplete';
import {oneDark} from '@codemirror/theme-one-dark';

import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {html} from '@codemirror/lang-html';
import {markdown} from '@codemirror/lang-markdown';
import {shell as shellMode} from '@codemirror/legacy-modes/mode/shell';

import {MergeView, unifiedMergeView} from '@codemirror/merge';
import {diffWords} from 'diff';

// 10+ extra themes
import {githubDark, githubLight} from '@uiw/codemirror-theme-github';
import {vscodeDark, vscodeLight} from '@uiw/codemirror-theme-vscode';
import {xcodeDark, xcodeLight} from '@uiw/codemirror-theme-xcode';
import {solarizedDark, solarizedLight} from '@uiw/codemirror-theme-solarized';
import {nord} from '@uiw/codemirror-theme-nord';
import {dracula} from '@uiw/codemirror-theme-dracula';
import {okaidia} from '@uiw/codemirror-theme-okaidia';
import {sublime} from '@uiw/codemirror-theme-sublime';
import {androidstudio} from '@uiw/codemirror-theme-androidstudio';
import {darcula} from '@uiw/codemirror-theme-darcula';
import {basicDark, basicLight} from '@uiw/codemirror-theme-basic';

const langComp = new Compartment();
const wrapComp = new Compartment();
const themeComp = new Compartment();
const tabComp = new Compartment();

function langExt(n){
  n=(n||'').toLowerCase();
  if (n==='js'||n==='javascript') return javascript();
  if (n==='py'||n==='python') return python();
  if (n==='html') return html();
  if (n==='md'||n==='markdown') return markdown();
  if (n==='sh'||n==='shell') return shellMode();
  return [];
}

function themeByName(n){
  n=(n||'').toLowerCase();
  switch(n){
    case 'onedark': return oneDark;
    case 'github-dark': return githubDark;
    case 'github-light': return githubLight;
    case 'vscode-dark': return vscodeDark;
    case 'vscode-light': return vscodeLight;
    case 'xcode-dark': return xcodeDark;
    case 'xcode-light': return xcodeLight;
    case 'solarized-dark': return solarizedDark;
    case 'solarized-light': return solarizedLight;
    case 'nord': return nord;
    case 'dracula': return dracula;
    case 'okaidia': return okaidia;
    case 'sublime': return sublime;
    case 'androidstudio': return androidstudio;
    case 'darcula': return darcula;
    case 'basic-dark': return basicDark;
    case 'basic-light': return basicLight;
    default: return []; // rely on defaultHighlightStyle below
  }
}

function baseExtensions(){
  return [
    lineNumbers(),
    drawSelection(),
    highlightActiveLine(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    autocompletion(),
    closeBrackets(),
    foldGutter(),
    syntaxHighlighting(defaultHighlightStyle),
  ];
}

// inline word-level diff decorations
function inlineDiffExtension(){
  let baseText = null;
  const markAdd = Decoration.mark({class:'cm-inline-add'});
  const markDel = Decoration.mark({class:'cm-inline-del'});
  const plugin = ViewPlugin.fromClass(class {
    constructor(view){ this.decorations = Decoration.none; this.update(view); }
    update(view){
      if (!baseText){ this.decorations = Decoration.none; return; }
      const now = view.state.doc.toString();
      const parts = diffWords(baseText, now, {newlineIsToken:true});
      const ranges = []; let pos = 0;
      for (const p of parts){
        const len = p.value.length;
        if (p.removed){ ranges.push(markDel.range(pos, pos)); }
        else if (p.added){ ranges.push(markAdd.range(pos, pos+len)); pos += len; }
        else { pos += len; }
      }
      this.decorations = Decoration.set(ranges.sort((a,b)=>a.from-b.from));
    }
  }, {decorations:v=>v.decorations});

  if (!document.getElementById('cm-inline-diff-style')){
    const s=document.createElement('style'); s.id='cm-inline-diff-style';
    s.textContent='.cm-inline-add{background:rgba(80,200,120,.35);border-radius:2px}.cm-inline-del{border-bottom:2px solid rgba(220,80,80,.85)}';
    document.head.appendChild(s);
  }
  return {
    extension:[plugin],
    setBase(t, view){ baseText = t ?? null; if (view) view.dispatch({annotations: Transaction.userEvent.of('refresh')}); }
  };
}

export function createEditor({el, value='', language='plaintext', theme=null, tabSize=2, wordWrap=false}={}){
  const parent = typeof el==='string' ? document.querySelector(el) : el;
  if (!parent) throw new Error('CM6: container not found');

  const diff = inlineDiffExtension();

  const state = EditorState.create({
    doc: value,
    extensions: [
      ...baseExtensions(),
      langComp.of(langExt(language)),
      themeComp.of(themeByName(theme)),
      tabComp.of(EditorState.tabSize.of(tabSize)),
      wrapComp.of(wordWrap ? EditorView.lineWrapping : []),
      diff.extension,
    ],
  });

  const view = new EditorView({state, parent});

  return {
    view,
    get value(){ return view.state.doc.toString(); },
    setValue(t){ view.dispatch({changes:{from:0,to:view.state.doc.length,insert:t}}); },
    setLanguage(n){ view.dispatch({effects: langComp.reconfigure(langExt(n))}); },
    setTheme(n){ view.dispatch({effects: themeComp.reconfigure(themeByName(n))}); },
    setTabSize(n){ view.dispatch({effects: tabComp.reconfigure(EditorState.tabSize.of(n))}); },
    setWordWrap(on){ view.dispatch({effects: wrapComp.reconfigure(on ? EditorView.lineWrapping : [])}); },
    setDiffBase(t){ diff.setBase(t, view); },
  };
}

export function createUnifiedDiff({el, a='', b=''}={}){
  const parent = typeof el==='string' ? document.querySelector(el) : el;
  if (!parent) throw new Error('CM6: container not found');
  return unifiedMergeView({ parent, a, b });
}

export function createMergeView({el, a='', b=''}={}){
  const parent = typeof el==='string' ? document.querySelector(el) : el;
  if (!parent) throw new Error('CM6: container not found');
  return new MergeView({ parent, a, b });
}

window.CM6 = { createEditor, createUnifiedDiff, createMergeView };

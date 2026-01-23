(function(b,k){typeof exports=="object"&&typeof module<"u"?k(exports):typeof define=="function"&&define.amd?define(["exports"],k):(b=typeof globalThis<"u"?globalThis:b||self,k(b["monaco-touch-selection"]={}))})(this,(function(b){"use strict";var z=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectAll="selectAll",e.Undo="undo",e.Redo="redo",e.Close="close",e))(z||{});const Q=(e,a)=>({startLineNumber:a.lineNumber,startColumn:a.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),Z=(e,a)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:a.lineNumber,endColumn:a.column}),ee=(e,a,d)=>{const w=e.getScrollTop(),E=e.getScrollHeight(),v=e.getLayoutInfo().height,S=Math.max(0,E-v),N=w>0,O=w<S,L=e.getTargetAtClientPoint(a.clientX,a.clientY-d),i=e.getTargetAtClientPoint(a.clientX,a.clientY+d);if(L===null&&i!==null&&N){const s=Math.max(0,w-d);e.setScrollTop(s,0)}else if(L!==null&&i===null&&O){const s=Math.min(S,w+d);e.setScrollTop(s,0)}},te=(e,a,d)=>{const w=e.getScrollLeft(),E=e.getScrollWidth(),v=e.getLayoutInfo().width,S=Math.max(0,E-v),N=w>0,O=w<S,L=e.getTargetAtClientPoint(a.clientX-d,a.clientY),i=e.getTargetAtClientPoint(a.clientX+d,a.clientY);if(L===null&&i!==null&&N){const s=Math.max(0,w-d);e.setScrollLeft(s,0)}else if(L!==null&&i===null&&O){const s=Math.min(S,w+d);e.setScrollLeft(s,0)}},ne=(e,a)=>{const{tools:d,selectionSyncTimeout:w=300,toolActionErrorHandler:E=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=a??{};if(!e)throw new Error("editor not existed");const v=e.getDomNode();if(!v||!(v instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const S=v.querySelector(".overflow-guard");if(!S||!(S instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const N=v.querySelector(".monaco-editor .margin");let O=0;N&&N instanceof HTMLElement&&(O=N.offsetWidth);let L=!1,i=null,s=null,u=null;const oe=()=>{i&&(L||(L=!0,i.classList.add("show")))},W=()=>{i&&L&&(L=!1,i.classList.remove("show"))};let A=!1,r=null;const _=()=>{r&&(A||(A=!0,r.classList.add("show")))},C=()=>{r&&A&&(A=!1,r.classList.remove("show"))};let X=new ResizeObserver(()=>{W(),C();const t=e.getSelection();t&&$(t)});X.observe(v),e.onDidDispose(()=>{X?.disconnect(),X=null,i?.remove(),s?.remove(),u?.remove(),r?.remove(),i=null,s=null,u=null,r=null});const se=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},le=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await E(`copy fail: ${t}`,t),!1}},ie=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await E("cut",t),!1}},re=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await E("paste",t),!1}},ce=()=>{e.trigger("keyboard","undo",null)},ae=()=>{e.trigger("keyboard","redo",null)},q="translateX(-50%) translateY(25%) rotate(45deg)",ue="translateX(-100%) rotate(90deg)",de="",K=t=>{if(!s||!u)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},o={lineNumber:t.endLineNumber,column:t.endColumn},y=e.getScrollLeft(),H=e.getScrolledVisiblePosition(n),R=e.getScrolledVisiblePosition(o);if(!H||!R)return;const V=e.getTopForPosition(n.lineNumber,n.column),Y=e.getTopForPosition(o.lineNumber,o.column),c=H.left+y-O,P=V,f=R.left+y-O,x=Y;s.style.opacity="1",u.style.opacity="1",s.style.transform=`translateX(${c}px) translateY(${P}px)`,u.style.transform=`translateX(${f}px) translateY(${x}px)`,c===f&&P===x?(s.bottomCursor.style.transform=q,u.bottomCursor.style.transform=q):(s.bottomCursor.style.transform=ue,u.bottomCursor.style.transform=de)};let U=0,G;const $=t=>{if(clearTimeout(G),!s||!u)return;const n=Date.now();if(n-U<w){U=n,s.style.opacity="0",u.style.opacity="0",G=window.setTimeout(()=>{K(t)},w);return}else U=n,K(t)},J=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const o=document.createElement("div");o.classList.add("bottom-cursor"),t.appendChild(o);const y=t;return y.textCursor=n,y.bottomCursor=o,y},fe=()=>{i=document.createElement("div"),i.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),s=J(t),i.appendChild(t);const n=document.createElement("div");n.classList.add("right"),u=J(n),i.appendChild(n);const __E=globalThis.monaco&&globalThis.monaco.editor&&globalThis.monaco.editor.EditorOption;const __FS=__E&&__E.fontSize||52;const __LH=__E&&__E.lineHeight||67;let o=e.getOption(__LH),y=e.getOption(__FS);const H=c=>{s&&(s.textCursor.style.height=`${c}px`,s.bottomCursor.style.top=`${c}px`,s.bottomCursor.style.marginTop="0"),u&&(u.textCursor.style.height=`${c}px`,u.bottomCursor.style.top=`${c}px`,u.bottomCursor.style.marginTop="0")};H(o),e.onDidChangeConfiguration(c=>{o=e.getOption(__LH),H(o),c.hasChanged(__FS)&&(y=e.getOption(__FS))}),S.append(i),e.onDidScrollChange(c=>{i&&(i.style.top=`-${c.scrollTop}px`,i.style.left=`-${c.scrollLeft}px`)});const R=(c,P)=>{const f=T=>{if(T&&r&&s&&u){_();const M=s.getBoundingClientRect(),m=u.getBoundingClientRect(),F=Math.pow(T.clientX-(M.left+M.width/2),2)+Math.pow(T.clientY-(M.top+M.height/2),2),j=Math.pow(T.clientX-(m.left+m.width/2),2)+Math.pow(T.clientY-(m.top+m.height/2),2),I=F<=j?M:m,p=v.getBoundingClientRect(),l=r.getBoundingClientRect();let h=I.left-l.width/2;h+l.width>p.width+p.left&&(h=p.width+p.left-l.width),h<0&&(h=0);let g=I.top-l.height;if(g+l.height>p.height+p.top&&(g=p.height+p.top-l.height),g<0&&(g=I.top+o),window.visualViewport){const D=window.visualViewport.width+window.visualViewport.offsetLeft-l.width,B=window.visualViewport.height+window.visualViewport.offsetTop-l.height;h<window.visualViewport.offsetLeft?h=window.visualViewport.offsetLeft:h>D&&(h=D),g<window.visualViewport.offsetTop?g=window.visualViewport.offsetTop:g>B&&(g=B)}else{const D=document.body.clientWidth+document.documentElement.offsetLeft-l.width,B=document.body.clientHeight+document.documentElement.offsetTop-l.height;h<document.documentElement.offsetLeft?h=document.documentElement.offsetLeft:h>D&&(h=D),g<document.body.offsetTop?g=document.body.offsetTop:g>B&&(g=B)}r.style.transform=`translateX(${h}px) translateY(${g}px)`}};let x=0;c.addEventListener("touchstart",T=>{const M=e.getSelection();if(!M)return;let m=T.changedTouches[0]??T.touches[0];const F=M.isEmpty();let by=0;try{const ap=c.classList.contains("left")?{lineNumber:M.startLineNumber,column:M.startColumn}:{lineNumber:M.endLineNumber,column:M.endColumn};const ac=e.getScrolledVisiblePosition(ap);if(ac){const bb=v.getBoundingClientRect();by=bb.top+ac.top+ac.height/2-m.clientY;}}catch(_e){}let j=setInterval(()=>{ee(e,m,o),te(e,m,y);const l=e.getTargetAtClientPoint(m.clientX,m.clientY+by);l&&l.position&&(F?e.setPosition(l.position):e.setSelection(P(M,l.position)))},50);const I=l=>{l.preventDefault(),m=l.changedTouches[0]??l.touches[0]},p=l=>{clearTimeout(j),!(Date.now()-x>100)&&(l.preventDefault(),m=l.changedTouches[0]??l.touches[0],I(l),r&&e.getSelection()!==null&&f(m),document.removeEventListener("touchmove",I),document.removeEventListener("touchend",p),document.removeEventListener("touchcancel",p))};x=Date.now(),document.addEventListener("touchmove",I,{passive:!1}),document.addEventListener("touchend",p),document.addEventListener("touchcancel",p)},{passive:!0})};R(s,Q),R(u,Z);const V=c=>{let P=0;c.addEventListener("touchstart",()=>{P=Date.now()},{passive:!0}),c.addEventListener("touchend",()=>{if(Date.now()-P>1e3)return;const f=e.getSelection();if(!f||f?.startColumn!==f.endColumn||f.startLineNumber!==f.endLineNumber)return;const x=e.getModel();if(!x)return;const T=x.getWordAtPosition(f.getStartPosition());T&&(e.setSelection({startLineNumber:f.startLineNumber,startColumn:T.startColumn,endLineNumber:f.endLineNumber,endColumn:T.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};V(s.textCursor),V(u.textCursor);const Y=e.getSelection();Y&&$(Y)};e.onDidChangeCursorSelection(t=>{C(),setTimeout(()=>{$(t.selection)},0)}),fe();const me=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await le()&&C()}}],["cut",{name:"cut",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M7 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    <path d="M17 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    <path d="M9.15 14.85l8.85 -10.85" />
    <path d="M6 4l8.85 10.85" />
</svg>`,action:async()=>{await ie()&&C()}}],["paste",{name:"paste",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h3m9 -9v-5a2 2 0 0 0 -2 -2h-2" />
    <path d="M13 17v-1a1 1 0 0 1 1 -1h1m3 0h1a1 1 0 0 1 1 1v1m0 3v1a1 1 0 0 1 -1 1h-1m-3 0h-1a1 1 0 0 1 -1 -1v-1" />
    <path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" />
</svg>`,action:async()=>{await re()&&C()}}],["undo",{name:"undo",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M9 14l-4 -4l4 -4"/>
    <path d="M5 10h11a4 4 0 1 1 0 8h-1"/>
</svg>`,action:()=>{ce(),_()}}],["redo",{name:"redo",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M15 14l4 -4l-4 -4"/>
    <path d="M19 10h-11a4 4 0 1 0 0 8h1"/>
</svg>`,action:()=>{ae(),_()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{se(),_()}}],["close",{name:"close",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M18 6l-12 12" />
    <path d="M6 6l12 12" />
</svg>`,action:()=>(C(),!0)}]]);if(d===void 0)return n.values();if(typeof d=="function"){const o=d({editor:e,selectorMenu:t,defaultTools:n,openMenu:_,closeMenu:C});return o===void 0?n.values():o}return n.values()};(()=>{r=document.createElement("div"),r.classList.add("monaco-editor-touch-selector-menu");for(const t of me(r)){const n=document.createElement("div");if(n.classList.add("menu-item"),typeof t.innerHTML=="function"){const o=t.innerHTML();typeof o=="string"?n.innerHTML=o:n.appendChild(o)}else typeof t.innerHTML=="string"?n.innerHTML=t.innerHTML:n.appendChild(t.innerHTML);n.addEventListener("touchend",async()=>{try{await t.action()}catch(o){await E(t.name,o)}}),r.appendChild(n)}r.addEventListener("touchstart",t=>{t.preventDefault()},{passive:!1}),r.addEventListener("touchmove",t=>{t.preventDefault()},{passive:!1}),r.addEventListener("touchend",t=>{t.preventDefault()},{passive:!1}),document.documentElement.append(r)})(),v.addEventListener("touchstart",()=>{oe()},{passive:!0}),e.onDidBlurEditorWidget(()=>{W(),C()}),v.addEventListener("click",t=>{t.stopPropagation()})};b.DefaultToolName=z,b.editorTouchSelectionHelp=ne,Object.defineProperty(b,Symbol.toStringTag,{value:"Module"})}));


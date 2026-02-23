(function(H,V){typeof exports=="object"&&typeof module<"u"?V(exports):typeof define=="function"&&define.amd?define(["exports"],V):(H=typeof globalThis<"u"?globalThis:H||self,V(H["monaco-touch-selection"]={}))})(this,(function(H){"use strict";var q=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.Hover="hover",e.Undo="undo",e.Redo="redo",e.Close="close",e))(q||{});const te=(e,u)=>({startLineNumber:u.lineNumber,startColumn:u.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),ne=(e,u)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:u.lineNumber,endColumn:u.column}),oe=(e,u,p)=>{const L=e.getScrollTop(),O=e.getScrollHeight(),I=e.getLayoutInfo().height,E=Math.max(0,O-I),B=L>0,g=L<E,C=e.getTargetAtClientPoint(u.clientX,u.clientY-p),x=e.getTargetAtClientPoint(u.clientX,u.clientY+p);if(C===null&&x!==null&&B){const S=Math.max(0,L-p);e.setScrollTop(S,0)}else if(C!==null&&x===null&&g){const S=Math.min(E,L+p);e.setScrollTop(S,0)}},se=(e,u,p)=>{const L=e.getScrollLeft(),O=e.getScrollWidth(),I=e.getLayoutInfo().width,E=Math.max(0,O-I),B=L>0,g=L<E,C=e.getTargetAtClientPoint(u.clientX-p,u.clientY),x=e.getTargetAtClientPoint(u.clientX+p,u.clientY);if(C===null&&x!==null&&B){const S=Math.max(0,L-p);e.setScrollLeft(S,0)}else if(C!==null&&x===null&&g){const S=Math.min(E,L+p);e.setScrollLeft(S,0)}},le=(e,u)=>{const{tools:p,selectionSyncTimeout:L=300,toolActionErrorHandler:O=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=u??{};if(!e)throw new Error("editor not existed");const I=globalThis.monaco?.editor?.EditorOption,E=I?.fontSize??52,B=I?.lineHeight??67,g=e.getDomNode();if(!g||!(g instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const C=g.querySelector(".overflow-guard");if(!C||!(C instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const x=g.querySelector(".monaco-editor .margin");let S=0;x&&x instanceof HTMLElement&&(S=x.offsetWidth);let D=!1,m=null,i=null,r=null;const ie=()=>{m&&(D||(D=!0,m.classList.add("show")))},G=()=>{m&&D&&(D=!1,m.classList.remove("show"))};let X=!1,c=null;const R=()=>{c&&(X||(X=!0,c.classList.add("show")))},b=()=>{c&&X&&(X=!1,c.classList.remove("show"))};let j=new ResizeObserver(()=>{G(),b();const t=e.getSelection();t&&W(t)});j.observe(g),e.onDidDispose(()=>{j?.disconnect(),j=null,m?.remove(),i?.remove(),r?.remove(),c?.remove(),m=null,i=null,r=null,c=null});const re=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},ce=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await O(`copy fail: ${t}`,t),!1}},ae=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await O("cut",t),!1}},ue=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await O("paste",t),!1}},de=()=>{e.trigger("keyboard","undo",null)},me=()=>{e.trigger("keyboard","redo",null)},J="translateX(-50%) translateY(25%) rotate(45deg)",fe="translateX(-100%) rotate(90deg)",he="",Q=t=>{if(!i||!r)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},o={lineNumber:t.endLineNumber,column:t.endColumn},d=e.getScrollLeft(),M=e.getScrolledVisiblePosition(n),Y=e.getScrolledVisiblePosition(o);if(!M||!Y)return;const F=e.getTopForPosition(n.lineNumber,n.column),U=e.getTopForPosition(o.lineNumber,o.column),a=M.left+d-S,A=F,v=Y.left+d-S,_=U;i.style.opacity="1",r.style.opacity="1",i.style.transform=`translateX(${a}px) translateY(${A}px)`,r.style.transform=`translateX(${v}px) translateY(${_}px)`,a===v&&A===_?(i.bottomCursor.style.transform=J,r.bottomCursor.style.transform=J):(i.bottomCursor.style.transform=fe,r.bottomCursor.style.transform=he)};let z=0,Z;const W=t=>{if(clearTimeout(Z),!i||!r)return;const n=Date.now();if(n-z<L){z=n,i.style.opacity="0",r.style.opacity="0",Z=window.setTimeout(()=>{Q(t)},L);return}else z=n,Q(t)},ee=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const o=document.createElement("div");o.classList.add("bottom-cursor"),t.appendChild(o);const d=t;return d.textCursor=n,d.bottomCursor=o,d},pe=()=>{m=document.createElement("div"),m.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),i=ee(t),m.appendChild(t);const n=document.createElement("div");n.classList.add("right"),r=ee(n),m.appendChild(n);let o=e.getOption(B),d=e.getOption(E);const M=a=>{i&&(i.textCursor.style.height=`${a}px`,i.bottomCursor.style.top=`${a}px`,i.bottomCursor.style.marginTop="0"),r&&(r.textCursor.style.height=`${a}px`,r.bottomCursor.style.top=`${a}px`,r.bottomCursor.style.marginTop="0")};M(o),e.onDidChangeConfiguration(a=>{o=e.getOption(B),M(o),a.hasChanged(E)&&(d=e.getOption(E))}),C.append(m),e.onDidScrollChange(a=>{m&&(m.style.top=`-${a.scrollTop}px`,m.style.left=`-${a.scrollLeft}px`)});const Y=(a,A)=>{const v=T=>{if(T&&c&&i&&r){R();const w=i.getBoundingClientRect(),f=r.getBoundingClientRect(),K=Math.pow(T.clientX-(w.left+w.width/2),2)+Math.pow(T.clientY-(w.top+w.height/2),2),$=Math.pow(T.clientX-(f.left+f.width/2),2)+Math.pow(T.clientY-(f.top+f.height/2),2),N=K<=$?w:f,y=g.getBoundingClientRect(),h=c.getBoundingClientRect();let l=N.left-h.width/2;l+h.width>y.width+y.left&&(l=y.width+y.left-h.width),l<0&&(l=0);let s=N.top-h.height;if(s+h.height>y.height+y.top&&(s=y.height+y.top-h.height),s<0&&(s=N.top+o),window.visualViewport){const P=window.visualViewport.width+window.visualViewport.offsetLeft-h.width,k=window.visualViewport.height+window.visualViewport.offsetTop-h.height;l<window.visualViewport.offsetLeft?l=window.visualViewport.offsetLeft:l>P&&(l=P),s<window.visualViewport.offsetTop?s=window.visualViewport.offsetTop:s>k&&(s=k)}else{const P=document.body.clientWidth+document.documentElement.offsetLeft-h.width,k=document.body.clientHeight+document.documentElement.offsetTop-h.height;l<document.documentElement.offsetLeft?l=document.documentElement.offsetLeft:l>P&&(l=P),s<document.body.offsetTop?s=document.body.offsetTop:s>k&&(s=k)}c.style.transform=`translateX(${l}px) translateY(${s}px)`}};let _=0;a.addEventListener("touchstart",T=>{const w=e.getSelection();if(!w)return;let f=T.changedTouches[0]??T.touches[0];const K=w.isEmpty();let $=0;try{const s=a.classList.contains("left")?{lineNumber:w.startLineNumber,column:w.startColumn}:{lineNumber:w.endLineNumber,column:w.endColumn},P=e.getScrolledVisiblePosition(s);P&&($=g.getBoundingClientRect().top+P.top+P.height/2-f.clientY)}catch{}let N=null;const y=()=>{N===null&&(N=setInterval(()=>{oe(e,f,o),se(e,f,d);const s=e.getTargetAtClientPoint(f.clientX,f.clientY+$-o*1.5);s&&s.position&&(K?e.setPosition(s.position):e.setSelection(A(w,s.position)))},50))},h=s=>{s.preventDefault(),f=s.changedTouches[0]??s.touches[0],y()},l=s=>{if(N!==null&&clearInterval(N),N=null,Date.now()-_>100){document.removeEventListener("touchmove",h),document.removeEventListener("touchend",l),document.removeEventListener("touchcancel",l);return}s.preventDefault(),f=s.changedTouches[0]??s.touches[0],c&&e.getSelection()!==null&&v(f),document.removeEventListener("touchmove",h),document.removeEventListener("touchend",l),document.removeEventListener("touchcancel",l)};_=Date.now(),document.addEventListener("touchmove",h,{passive:!1}),document.addEventListener("touchend",l),document.addEventListener("touchcancel",l)},{passive:!0})};Y(i,te),Y(r,ne);const F=a=>{let A=0;a.addEventListener("touchstart",()=>{A=Date.now()},{passive:!0}),a.addEventListener("touchend",()=>{if(Date.now()-A>1e3)return;const v=e.getSelection();if(!v||v?.startColumn!==v.endColumn||v.startLineNumber!==v.endLineNumber)return;const _=e.getModel();if(!_)return;const T=_.getWordAtPosition(v.getStartPosition());T&&(e.setSelection({startLineNumber:v.startLineNumber,startColumn:T.startColumn,endLineNumber:v.endLineNumber,endColumn:T.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};F(i.textCursor),F(r.textCursor);const U=e.getSelection();U&&W(U)};e.onDidChangeCursorSelection(t=>{b(),setTimeout(()=>{W(t.selection)},0)}),pe();const ge=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await ce()&&b()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await ae()&&b()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await ue()&&b()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{de(),R()}}],["redo",{name:"redo",innerHTML:`
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
</svg>`,action:()=>{me(),R()}}],["selectWord",{name:"select",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M5 3h2m4 0h2m4 0h2M3 7v2m18-2v2M3 13v2m18-2v2M5 21h2m4 0h2m4 0h2"/>
</svg>`,action:()=>{const o=e.getSelection();if(!o)return;const d=e.getModel();if(!d)return;const M=d.getWordAtPosition(o.getStartPosition());M&&(e.setSelection({startLineNumber:o.startLineNumber,startColumn:M.startColumn,endLineNumber:o.endLineNumber,endColumn:M.endColumn}),setTimeout(()=>{e.focus()})),R()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{re(),R()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{b();const o=e.getSelection();if(o&&o.getStartPosition)try{e.setPosition(o.getStartPosition())}catch{}const d=e.getAction("editor.action.showHover");return d?d.run():e.trigger("touch","editor.action.showHover",null),!0}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(b(),!0)}]]);if(p===void 0)return n.values();if(typeof p=="function"){const o=p({editor:e,selectorMenu:t,defaultTools:n,openMenu:R,closeMenu:b});return o===void 0?n.values():o}return n.values()};(()=>{c=document.createElement("div"),c.classList.add("monaco-editor-touch-selector-menu");for(const t of ge(c)){const n=document.createElement("div");if(n.classList.add("menu-item"),typeof t.innerHTML=="function"){const o=t.innerHTML();typeof o=="string"?n.innerHTML=o:n.appendChild(o)}else typeof t.innerHTML=="string"?n.innerHTML=t.innerHTML:n.appendChild(t.innerHTML);n.addEventListener("touchend",async()=>{try{await t.action()}catch(o){await O(t.name,o)}}),c.appendChild(n)}c.addEventListener("touchstart",t=>{t.preventDefault()},{passive:!1}),c.addEventListener("touchmove",t=>{t.preventDefault()},{passive:!1}),c.addEventListener("touchend",t=>{t.preventDefault()},{passive:!1}),document.documentElement.append(c)})(),g.addEventListener("touchstart",()=>{ie()},{passive:!0}),e.onDidBlurEditorWidget(()=>{G(),b()}),g.addEventListener("click",t=>{t.stopPropagation()})};H.DefaultToolName=q,H.editorTouchSelectionHelp=le,Object.defineProperty(H,Symbol.toStringTag,{value:"Module"})}));

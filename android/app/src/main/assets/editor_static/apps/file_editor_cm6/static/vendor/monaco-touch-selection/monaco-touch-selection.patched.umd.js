(function(I,D){typeof exports=="object"&&typeof module<"u"?D(exports):typeof define=="function"&&define.amd?define(["exports"],D):(I=typeof globalThis<"u"?globalThis:I||self,D(I["monaco-touch-selection"]={}))})(this,(function(I){"use strict";var G=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.Hover="hover",e.Find="find",e.ReadOnly="readOnly",e.Undo="undo",e.Redo="redo",e.Close="close",e))(G||{});const oe=(e,f)=>({startLineNumber:f.lineNumber,startColumn:f.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),se=(e,f)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:f.lineNumber,endColumn:f.column}),le=(e,f,v)=>{const y=e.getScrollTop(),A=e.getScrollHeight(),R=e.getLayoutInfo().height,O=Math.max(0,A-R),k=y>0,m=y<O,N=e.getTargetAtClientPoint(f.clientX,f.clientY-v),H=e.getTargetAtClientPoint(f.clientX,f.clientY+v);if(N===null&&H!==null&&k){const C=Math.max(0,y-v);e.setScrollTop(C,0)}else if(N!==null&&H===null&&m){const C=Math.min(O,y+v);e.setScrollTop(C,0)}},ie=(e,f,v)=>{const y=e.getScrollLeft(),A=e.getScrollWidth(),R=e.getLayoutInfo().width,O=Math.max(0,A-R),k=y>0,m=y<O,N=e.getTargetAtClientPoint(f.clientX-v,f.clientY),H=e.getTargetAtClientPoint(f.clientX+v,f.clientY);if(N===null&&H!==null&&k){const C=Math.max(0,y-v);e.setScrollLeft(C,0)}else if(N!==null&&H===null&&m){const C=Math.min(O,y+v);e.setScrollLeft(C,0)}},ce=(e,f)=>{const{tools:v,selectionSyncTimeout:y=300,toolActionErrorHandler:A=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=f??{};if(!e)throw new Error("editor not existed");const R=globalThis.monaco?.editor?.EditorOption,O=R?.fontSize??52,k=R?.lineHeight??67,m=e.getDomNode();if(!m||!(m instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const N=m.querySelector(".overflow-guard");if(!N||!(N instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const H=m.querySelector(".monaco-editor .margin");let C=0;H&&H instanceof HTMLElement&&(C=H.offsetWidth);let $=!1,p=null,u=null,d=null;const re=()=>{p&&($||($=!0,p.classList.add("show")))},J=()=>{p&&$&&($=!1,p.classList.remove("show"))};let X=!1,i=null;const Q=[];let U=!1;const V=()=>{if(i){for(const t of Q){const n=t.fn();t.el.innerHTML=typeof n=="string"?n:"",typeof n!="string"&&t.el.appendChild(n)}X||(X=!0,i.classList.add("show"))}},x=()=>{i&&X&&(U||(X=!1,i.classList.remove("show")))};let j=new ResizeObserver(()=>{J(),x();const t=e.getSelection();t&&K(t)});j.observe(m),e.onDidDispose(()=>{j?.disconnect(),j=null,p?.remove(),u?.remove(),d?.remove(),i?.remove(),p=null,u=null,d=null,i=null});const ae=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},ue=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await A(`copy fail: ${t}`,t),!1}},de=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await A("cut",t),!1}},fe=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await A("paste",t),!1}},me=()=>{e.trigger("keyboard","undo",null)},he=()=>{e.trigger("keyboard","redo",null)},Z="translateX(-50%) translateY(25%) rotate(45deg)",pe="translateX(-100%) rotate(90deg)",ge="",ee=t=>{if(!u||!d)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},o={lineNumber:t.endLineNumber,column:t.endColumn},s=e.getScrollLeft(),r=e.getScrolledVisiblePosition(n),h=e.getScrolledVisiblePosition(o);if(!r||!h)return;const S=e.getTopForPosition(n.lineNumber,n.column),E=e.getTopForPosition(o.lineNumber,o.column),c=r.left+s-C,Y=S,L=h.left+s-C,B=E;u.style.opacity="1",d.style.opacity="1",u.style.transform=`translateX(${c}px) translateY(${Y}px)`,d.style.transform=`translateX(${L}px) translateY(${B}px)`,c===L&&Y===B?(u.bottomCursor.style.transform=Z,d.bottomCursor.style.transform=Z):(u.bottomCursor.style.transform=pe,d.bottomCursor.style.transform=ge)};let W=0,te;const K=t=>{if(clearTimeout(te),!u||!d)return;const n=Date.now();if(n-W<y){W=n,u.style.opacity="0",d.style.opacity="0",te=window.setTimeout(()=>{ee(t)},y);return}else W=n,ee(t)},ne=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const o=document.createElement("div");o.classList.add("bottom-cursor"),t.appendChild(o);const s=t;return s.textCursor=n,s.bottomCursor=o,s},we=()=>{p=document.createElement("div"),p.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),u=ne(t),p.appendChild(t);const n=document.createElement("div");n.classList.add("right"),d=ne(n),p.appendChild(n);let o=e.getOption(k),s=e.getOption(O);const r=c=>{u&&(u.textCursor.style.height=`${c}px`,u.bottomCursor.style.top=`${c}px`,u.bottomCursor.style.marginTop="0"),d&&(d.textCursor.style.height=`${c}px`,d.bottomCursor.style.top=`${c}px`,d.bottomCursor.style.marginTop="0")};r(o),e.onDidChangeConfiguration(c=>{o=e.getOption(k),r(o),c.hasChanged(O)&&(s=e.getOption(O))}),N.append(p),e.onDidScrollChange(c=>{p&&(p.style.top=`-${c.scrollTop}px`,p.style.left=`-${c.scrollLeft}px`)});const h=(c,Y)=>{const L=M=>{if(M&&i&&u&&d){V();const T=u.getBoundingClientRect(),g=d.getBoundingClientRect(),q=Math.pow(M.clientX-(T.left+T.width/2),2)+Math.pow(M.clientY-(T.top+T.height/2),2),F=Math.pow(M.clientX-(g.left+g.width/2),2)+Math.pow(M.clientY-(g.top+g.height/2),2),P=q<=F?T:g,b=m.getBoundingClientRect(),w=i.getBoundingClientRect();let a=P.left-w.width/2;a+w.width>b.width+b.left&&(a=b.width+b.left-w.width),a<0&&(a=0);let l=P.top-w.height;if(l+w.height>b.height+b.top&&(l=b.height+b.top-w.height),l<0&&(l=P.top+o),window.visualViewport){const _=window.visualViewport.width+window.visualViewport.offsetLeft-w.width,z=window.visualViewport.height+window.visualViewport.offsetTop-w.height;a<window.visualViewport.offsetLeft?a=window.visualViewport.offsetLeft:a>_&&(a=_),l<window.visualViewport.offsetTop?l=window.visualViewport.offsetTop:l>z&&(l=z)}else{const _=document.body.clientWidth+document.documentElement.offsetLeft-w.width,z=document.body.clientHeight+document.documentElement.offsetTop-w.height;a<document.documentElement.offsetLeft?a=document.documentElement.offsetLeft:a>_&&(a=_),l<document.body.offsetTop?l=document.body.offsetTop:l>z&&(l=z)}i.style.transform=`translateX(${a}px) translateY(${l}px)`}};let B=0;c.addEventListener("touchstart",M=>{const T=e.getSelection();if(!T)return;let g=M.changedTouches[0]??M.touches[0];const q=T.isEmpty();let F=0;try{const l=c.classList.contains("left")?{lineNumber:T.startLineNumber,column:T.startColumn}:{lineNumber:T.endLineNumber,column:T.endColumn},_=e.getScrolledVisiblePosition(l);_&&(F=m.getBoundingClientRect().top+_.top+_.height/2-g.clientY)}catch{}let P=null;const b=()=>{P===null&&(P=setInterval(()=>{le(e,g,o),ie(e,g,s);const l=e.getTargetAtClientPoint(g.clientX,g.clientY+F-o*1.5);l&&l.position&&(q?e.setPosition(l.position):e.setSelection(Y(T,l.position)))},50))},w=l=>{l.preventDefault(),g=l.changedTouches[0]??l.touches[0],b()},a=l=>{if(P!==null&&clearInterval(P),P=null,Date.now()-B>100){document.removeEventListener("touchmove",w),document.removeEventListener("touchend",a),document.removeEventListener("touchcancel",a);return}l.preventDefault(),g=l.changedTouches[0]??l.touches[0],i&&e.getSelection()!==null&&L(g),document.removeEventListener("touchmove",w),document.removeEventListener("touchend",a),document.removeEventListener("touchcancel",a)};B=Date.now(),document.addEventListener("touchmove",w,{passive:!1}),document.addEventListener("touchend",a),document.addEventListener("touchcancel",a)},{passive:!0})};h(u,oe),h(d,se);const S=c=>{let Y=0;c.addEventListener("touchstart",()=>{Y=Date.now()},{passive:!0}),c.addEventListener("touchend",()=>{if(Date.now()-Y>1e3)return;const L=e.getSelection();if(!L||L?.startColumn!==L.endColumn||L.startLineNumber!==L.endLineNumber)return;const B=e.getModel();if(!B)return;const M=B.getWordAtPosition(L.getStartPosition());M&&(e.setSelection({startLineNumber:L.startLineNumber,startColumn:M.startColumn,endLineNumber:L.endLineNumber,endColumn:M.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};S(u.textCursor),S(d.textCursor);const E=e.getSelection();E&&K(E)};e.onDidChangeCursorSelection(t=>{x(),setTimeout(()=>{K(t.selection)},0)}),we();const ve=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await ue()&&x()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await de()&&x()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await fe()&&x()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{me(),V()}}],["redo",{name:"redo",innerHTML:`
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
</svg>`,action:()=>{he(),V()}}],["selectWord",{name:"select",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M5 3h2m4 0h2m4 0h2M3 7v2m18-2v2M3 13v2m18-2v2M5 21h2m4 0h2m4 0h2"/>
</svg>`,action:()=>{const o=e.getSelection();if(!o)return;const s=e.getModel();if(!s)return;const r=s.getWordAtPosition(o.getStartPosition());r&&(e.setSelection({startLineNumber:o.startLineNumber,startColumn:r.startColumn,endLineNumber:o.endLineNumber,endColumn:r.endColumn}),setTimeout(()=>{e.focus()})),V()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{ae(),V()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{x();const o=e.getSelection();if(o&&o.getStartPosition)try{e.setPosition(o.getStartPosition())}catch{}const s=e.getAction("editor.action.showHover");return s?s.run():e.trigger("touch","editor.action.showHover",null),!0}}],["find",{name:"find",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🔎</span>',action:()=>{x();const o=e.getAction("actions.find");o&&o.run?o.run():e.trigger("touch-menu","actions.find",null)}}],["readOnly",{name:"read only",innerHTML:()=>`<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 100 100" style="fill: ${e.getOption(R?.readOnly??89)?"#4fc3f7":"currentColor"}; stroke: none;"><path d="M84.4,24.3H38l7,7h39.4c0.8,0,1.5,0.7,1.5,1.5v38.5c0,0.2-0.1,0.5-0.2,0.7l5,5c1.4-1.5,2.2-3.5,2.2-5.6V32.8C92.9,28.2,89.1,24.3,84.4,24.3z"/><path d="M66.9,53.3c0,1.9,1.6,3.5,3.5,3.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4C68.5,49.8,66.9,51.3,66.9,53.3z"/><path d="M34.2,53.3c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4C32.7,56.8,34.2,55.2,34.2,53.3z"/><path d="M60.4,45.5c1.9,0,3.5-1.6,3.5-3.5s-1.6-3.5-3.5-3.5H56c-1.1,0-2,0.5-2.6,1.2l5.8,5.8H60.4z"/><path d="M74.8,45.5c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5H74.8z"/><path d="M26.3,45.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5C22.8,43.9,24.4,45.5,26.3,45.5z"/><path d="M85.2,81.3l-8.4-8.4L70.8,67l0,0c0,0,0,0,0,0l-5.6-5.6l-4.6-4.6l0,0l-6.4-6.4l-6-6v0L23.3,19.5v0l-1.8-1.8c-1.4-1.4-3.6-1.4-4.9,0c-1.4,1.4-1.4,3.6,0,4.9l1.7,1.7h-1.5c-4.7,0-8.5,3.8-8.5,8.5v38.5c0,4.7,3.8,8.5,8.5,8.5h57l6.4,6.4c0.7,0.7,1.6,1,2.5,1c0.9,0,1.8-0.3,2.5-1c1.2-1.2,1.3-3,0.5-4.4C85.5,81.7,85.3,81.5,85.2,81.3z M16.8,72.8c-0.8,0-1.5-0.7-1.5-1.5V32.8c0-0.8,0.7-1.5,1.5-1.5h8.5l18.4,18.4l0,0h-2.6c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4c1.4,0,2.6-0.8,3.2-2l6.6,6.6H33.1c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5h29.3l4.5,4.5H16.8z"/></svg>`,action:()=>{const o=e.getOption(R?.readOnly??89);if(e.updateOptions({readOnly:!o}),o)try{const s=e.getDomNode(),r=s?.querySelector("textarea.inputarea")??s?.querySelector("textarea");r&&r.blur()}catch{}V()}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(x(),!0)}]]);if(v===void 0)return n.values();if(typeof v=="function"){const o=v({editor:e,selectorMenu:t,defaultTools:n,openMenu:V,closeMenu:x});return o===void 0?n.values():o}return n.values()};(()=>{i=document.createElement("div"),i.classList.add("monaco-editor-touch-selector-menu");for(const t of ve(i)){const n=document.createElement("div");if(n.classList.add("menu-item"),typeof t.innerHTML=="function"){const s=t.innerHTML();typeof s=="string"?n.innerHTML=s:n.appendChild(s),Q.push({el:n,fn:t.innerHTML})}else typeof t.innerHTML=="string"?n.innerHTML=t.innerHTML:n.appendChild(t.innerHTML);const o=async()=>{try{await t.action()}catch(s){await A(t.name,s)}};n.addEventListener("touchend",o),n.addEventListener("click",o),i.appendChild(n)}i.addEventListener("touchstart",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchmove",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchend",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("mousedown",t=>{t.preventDefault()}),document.addEventListener("mousedown",t=>{!X||!i||i.contains(t.target)||(X=!1,i.classList.remove("show"))}),document.documentElement.append(i)})(),m.addEventListener("touchstart",()=>{re()},{passive:!0}),e.onDidBlurEditorWidget(()=>{J(),x()}),m.addEventListener("click",t=>{t.stopPropagation()}),m.addEventListener("contextmenu",t=>{if(t.preventDefault(),t.stopPropagation(),!i)return;U=!0;const n=e.getSelection();if(!(n&&!n.isEmpty())){const E=e.getTargetAtClientPoint(t.clientX,t.clientY);E&&E.position&&e.setPosition(E.position)}V();const s=m.getBoundingClientRect(),r=i.getBoundingClientRect();let h=t.clientX-r.width/2;h+r.width>s.width+s.left&&(h=s.width+s.left-r.width),h<0&&(h=0);let S=t.clientY-r.height-10;if(S<0&&(S=t.clientY+10),window.visualViewport){const E=window.visualViewport.width+window.visualViewport.offsetLeft-r.width,c=window.visualViewport.height+window.visualViewport.offsetTop-r.height;h<window.visualViewport.offsetLeft?h=window.visualViewport.offsetLeft:h>E&&(h=E),S<window.visualViewport.offsetTop?S=window.visualViewport.offsetTop:S>c&&(S=c)}i.style.transform=`translateX(${h}px) translateY(${S}px)`,setTimeout(()=>{U=!1},0)})};I.DefaultToolName=G,I.editorTouchSelectionHelp=ce,Object.defineProperty(I,Symbol.toStringTag,{value:"Module"})}));

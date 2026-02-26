(function(I,D){typeof exports=="object"&&typeof module<"u"?D(exports):typeof define=="function"&&define.amd?define(["exports"],D):(I=typeof globalThis<"u"?globalThis:I||self,D(I["monaco-touch-selection"]={}))})(this,(function(I){"use strict";var G=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.Hover="hover",e.ReadOnly="readOnly",e.Undo="undo",e.Redo="redo",e.Close="close",e))(G||{});const oe=(e,d)=>({startLineNumber:d.lineNumber,startColumn:d.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),se=(e,d)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:d.lineNumber,endColumn:d.column}),le=(e,d,v)=>{const y=e.getScrollTop(),A=e.getScrollHeight(),R=e.getLayoutInfo().height,b=Math.max(0,A-R),k=y>0,m=y<b,O=e.getTargetAtClientPoint(d.clientX,d.clientY-v),N=e.getTargetAtClientPoint(d.clientX,d.clientY+v);if(O===null&&N!==null&&k){const C=Math.max(0,y-v);e.setScrollTop(C,0)}else if(O!==null&&N===null&&m){const C=Math.min(b,y+v);e.setScrollTop(C,0)}},ie=(e,d,v)=>{const y=e.getScrollLeft(),A=e.getScrollWidth(),R=e.getLayoutInfo().width,b=Math.max(0,A-R),k=y>0,m=y<b,O=e.getTargetAtClientPoint(d.clientX-v,d.clientY),N=e.getTargetAtClientPoint(d.clientX+v,d.clientY);if(O===null&&N!==null&&k){const C=Math.max(0,y-v);e.setScrollLeft(C,0)}else if(O!==null&&N===null&&m){const C=Math.min(b,y+v);e.setScrollLeft(C,0)}},ce=(e,d)=>{const{tools:v,selectionSyncTimeout:y=300,toolActionErrorHandler:A=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=d??{};if(!e)throw new Error("editor not existed");const R=globalThis.monaco?.editor?.EditorOption,b=R?.fontSize??52,k=R?.lineHeight??67,m=e.getDomNode();if(!m||!(m instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const O=m.querySelector(".overflow-guard");if(!O||!(O instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const N=m.querySelector(".monaco-editor .margin");let C=0;N&&N instanceof HTMLElement&&(C=N.offsetWidth);let $=!1,p=null,a=null,u=null;const re=()=>{p&&($||($=!0,p.classList.add("show")))},J=()=>{p&&$&&($=!1,p.classList.remove("show"))};let X=!1,i=null;const Q=[];let U=!1;const V=()=>{if(i){for(const t of Q){const n=t.fn();t.el.innerHTML=typeof n=="string"?n:"",typeof n!="string"&&t.el.appendChild(n)}X||(X=!0,i.classList.add("show"))}},P=()=>{i&&X&&(U||(X=!1,i.classList.remove("show")))};let j=new ResizeObserver(()=>{J(),P();const t=e.getSelection();t&&K(t)});j.observe(m),e.onDidDispose(()=>{j?.disconnect(),j=null,p?.remove(),a?.remove(),u?.remove(),i?.remove(),p=null,a=null,u=null,i=null});const ae=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},ue=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await A(`copy fail: ${t}`,t),!1}},de=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await A("cut",t),!1}},fe=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await A("paste",t),!1}},me=()=>{e.trigger("keyboard","undo",null)},he=()=>{e.trigger("keyboard","redo",null)},Z="translateX(-50%) translateY(25%) rotate(45deg)",pe="translateX(-100%) rotate(90deg)",ge="",ee=t=>{if(!a||!u)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},o={lineNumber:t.endLineNumber,column:t.endColumn},l=e.getScrollLeft(),f=e.getScrolledVisiblePosition(n),h=e.getScrolledVisiblePosition(o);if(!f||!h)return;const S=e.getTopForPosition(n.lineNumber,n.column),E=e.getTopForPosition(o.lineNumber,o.column),c=f.left+l-C,Y=S,L=h.left+l-C,B=E;a.style.opacity="1",u.style.opacity="1",a.style.transform=`translateX(${c}px) translateY(${Y}px)`,u.style.transform=`translateX(${L}px) translateY(${B}px)`,c===L&&Y===B?(a.bottomCursor.style.transform=Z,u.bottomCursor.style.transform=Z):(a.bottomCursor.style.transform=pe,u.bottomCursor.style.transform=ge)};let W=0,te;const K=t=>{if(clearTimeout(te),!a||!u)return;const n=Date.now();if(n-W<y){W=n,a.style.opacity="0",u.style.opacity="0",te=window.setTimeout(()=>{ee(t)},y);return}else W=n,ee(t)},ne=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const o=document.createElement("div");o.classList.add("bottom-cursor"),t.appendChild(o);const l=t;return l.textCursor=n,l.bottomCursor=o,l},we=()=>{p=document.createElement("div"),p.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),a=ne(t),p.appendChild(t);const n=document.createElement("div");n.classList.add("right"),u=ne(n),p.appendChild(n);let o=e.getOption(k),l=e.getOption(b);const f=c=>{a&&(a.textCursor.style.height=`${c}px`,a.bottomCursor.style.top=`${c}px`,a.bottomCursor.style.marginTop="0"),u&&(u.textCursor.style.height=`${c}px`,u.bottomCursor.style.top=`${c}px`,u.bottomCursor.style.marginTop="0")};f(o),e.onDidChangeConfiguration(c=>{o=e.getOption(k),f(o),c.hasChanged(b)&&(l=e.getOption(b))}),O.append(p),e.onDidScrollChange(c=>{p&&(p.style.top=`-${c.scrollTop}px`,p.style.left=`-${c.scrollLeft}px`)});const h=(c,Y)=>{const L=M=>{if(M&&i&&a&&u){V();const T=a.getBoundingClientRect(),g=u.getBoundingClientRect(),q=Math.pow(M.clientX-(T.left+T.width/2),2)+Math.pow(M.clientY-(T.top+T.height/2),2),F=Math.pow(M.clientX-(g.left+g.width/2),2)+Math.pow(M.clientY-(g.top+g.height/2),2),H=q<=F?T:g,x=m.getBoundingClientRect(),w=i.getBoundingClientRect();let r=H.left-w.width/2;r+w.width>x.width+x.left&&(r=x.width+x.left-w.width),r<0&&(r=0);let s=H.top-w.height;if(s+w.height>x.height+x.top&&(s=x.height+x.top-w.height),s<0&&(s=H.top+o),window.visualViewport){const _=window.visualViewport.width+window.visualViewport.offsetLeft-w.width,z=window.visualViewport.height+window.visualViewport.offsetTop-w.height;r<window.visualViewport.offsetLeft?r=window.visualViewport.offsetLeft:r>_&&(r=_),s<window.visualViewport.offsetTop?s=window.visualViewport.offsetTop:s>z&&(s=z)}else{const _=document.body.clientWidth+document.documentElement.offsetLeft-w.width,z=document.body.clientHeight+document.documentElement.offsetTop-w.height;r<document.documentElement.offsetLeft?r=document.documentElement.offsetLeft:r>_&&(r=_),s<document.body.offsetTop?s=document.body.offsetTop:s>z&&(s=z)}i.style.transform=`translateX(${r}px) translateY(${s}px)`}};let B=0;c.addEventListener("touchstart",M=>{const T=e.getSelection();if(!T)return;let g=M.changedTouches[0]??M.touches[0];const q=T.isEmpty();let F=0;try{const s=c.classList.contains("left")?{lineNumber:T.startLineNumber,column:T.startColumn}:{lineNumber:T.endLineNumber,column:T.endColumn},_=e.getScrolledVisiblePosition(s);_&&(F=m.getBoundingClientRect().top+_.top+_.height/2-g.clientY)}catch{}let H=null;const x=()=>{H===null&&(H=setInterval(()=>{le(e,g,o),ie(e,g,l);const s=e.getTargetAtClientPoint(g.clientX,g.clientY+F-o*1.5);s&&s.position&&(q?e.setPosition(s.position):e.setSelection(Y(T,s.position)))},50))},w=s=>{s.preventDefault(),g=s.changedTouches[0]??s.touches[0],x()},r=s=>{if(H!==null&&clearInterval(H),H=null,Date.now()-B>100){document.removeEventListener("touchmove",w),document.removeEventListener("touchend",r),document.removeEventListener("touchcancel",r);return}s.preventDefault(),g=s.changedTouches[0]??s.touches[0],i&&e.getSelection()!==null&&L(g),document.removeEventListener("touchmove",w),document.removeEventListener("touchend",r),document.removeEventListener("touchcancel",r)};B=Date.now(),document.addEventListener("touchmove",w,{passive:!1}),document.addEventListener("touchend",r),document.addEventListener("touchcancel",r)},{passive:!0})};h(a,oe),h(u,se);const S=c=>{let Y=0;c.addEventListener("touchstart",()=>{Y=Date.now()},{passive:!0}),c.addEventListener("touchend",()=>{if(Date.now()-Y>1e3)return;const L=e.getSelection();if(!L||L?.startColumn!==L.endColumn||L.startLineNumber!==L.endLineNumber)return;const B=e.getModel();if(!B)return;const M=B.getWordAtPosition(L.getStartPosition());M&&(e.setSelection({startLineNumber:L.startLineNumber,startColumn:M.startColumn,endLineNumber:L.endLineNumber,endColumn:M.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};S(a.textCursor),S(u.textCursor);const E=e.getSelection();E&&K(E)};e.onDidChangeCursorSelection(t=>{P(),setTimeout(()=>{K(t.selection)},0)}),we();const ve=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await ue()&&P()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await de()&&P()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await fe()&&P()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{const o=e.getSelection();if(!o)return;const l=e.getModel();if(!l)return;const f=l.getWordAtPosition(o.getStartPosition());f&&(e.setSelection({startLineNumber:o.startLineNumber,startColumn:f.startColumn,endLineNumber:o.endLineNumber,endColumn:f.endColumn}),setTimeout(()=>{e.focus()})),V()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{ae(),V()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{P();const o=e.getSelection();if(o&&o.getStartPosition)try{e.setPosition(o.getStartPosition())}catch{}const l=e.getAction("editor.action.showHover");return l?l.run():e.trigger("touch","editor.action.showHover",null),!0}}],["readOnly",{name:"read only",innerHTML:()=>`<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 100 100" style="fill: ${e.getOption(R?.readOnly??89)?"#4fc3f7":"currentColor"}; stroke: none;"><path d="M84.4,24.3H38l7,7h39.4c0.8,0,1.5,0.7,1.5,1.5v38.5c0,0.2-0.1,0.5-0.2,0.7l5,5c1.4-1.5,2.2-3.5,2.2-5.6V32.8C92.9,28.2,89.1,24.3,84.4,24.3z"/><path d="M66.9,53.3c0,1.9,1.6,3.5,3.5,3.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4C68.5,49.8,66.9,51.3,66.9,53.3z"/><path d="M34.2,53.3c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4C32.7,56.8,34.2,55.2,34.2,53.3z"/><path d="M60.4,45.5c1.9,0,3.5-1.6,3.5-3.5s-1.6-3.5-3.5-3.5H56c-1.1,0-2,0.5-2.6,1.2l5.8,5.8H60.4z"/><path d="M74.8,45.5c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5H74.8z"/><path d="M26.3,45.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5C22.8,43.9,24.4,45.5,26.3,45.5z"/><path d="M85.2,81.3l-8.4-8.4L70.8,67l0,0c0,0,0,0,0,0l-5.6-5.6l-4.6-4.6l0,0l-6.4-6.4l-6-6v0L23.3,19.5v0l-1.8-1.8c-1.4-1.4-3.6-1.4-4.9,0c-1.4,1.4-1.4,3.6,0,4.9l1.7,1.7h-1.5c-4.7,0-8.5,3.8-8.5,8.5v38.5c0,4.7,3.8,8.5,8.5,8.5h57l6.4,6.4c0.7,0.7,1.6,1,2.5,1c0.9,0,1.8-0.3,2.5-1c1.2-1.2,1.3-3,0.5-4.4C85.5,81.7,85.3,81.5,85.2,81.3z M16.8,72.8c-0.8,0-1.5-0.7-1.5-1.5V32.8c0-0.8,0.7-1.5,1.5-1.5h8.5l18.4,18.4l0,0h-2.6c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4c1.4,0,2.6-0.8,3.2-2l6.6,6.6H33.1c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5h29.3l4.5,4.5H16.8z"/></svg>`,action:()=>{const o=e.getOption(R?.readOnly??89);e.updateOptions({readOnly:!o}),V()}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(P(),!0)}]]);if(v===void 0)return n.values();if(typeof v=="function"){const o=v({editor:e,selectorMenu:t,defaultTools:n,openMenu:V,closeMenu:P});return o===void 0?n.values():o}return n.values()};(()=>{i=document.createElement("div"),i.classList.add("monaco-editor-touch-selector-menu");for(const t of ve(i)){const n=document.createElement("div");if(n.classList.add("menu-item"),typeof t.innerHTML=="function"){const l=t.innerHTML();typeof l=="string"?n.innerHTML=l:n.appendChild(l),Q.push({el:n,fn:t.innerHTML})}else typeof t.innerHTML=="string"?n.innerHTML=t.innerHTML:n.appendChild(t.innerHTML);const o=async()=>{try{await t.action()}catch(l){await A(t.name,l)}};n.addEventListener("touchend",o),n.addEventListener("click",o),i.appendChild(n)}i.addEventListener("touchstart",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchmove",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchend",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("mousedown",t=>{t.preventDefault()}),document.addEventListener("mousedown",t=>{!X||!i||i.contains(t.target)||(X=!1,i.classList.remove("show"))}),document.documentElement.append(i)})(),m.addEventListener("touchstart",()=>{re()},{passive:!0}),e.onDidBlurEditorWidget(()=>{J(),P()}),m.addEventListener("click",t=>{t.stopPropagation()}),m.addEventListener("contextmenu",t=>{if(t.preventDefault(),t.stopPropagation(),!i)return;U=!0;const n=e.getSelection();if(!(n&&!n.isEmpty())){const E=e.getTargetAtClientPoint(t.clientX,t.clientY);E&&E.position&&e.setPosition(E.position)}V();const l=m.getBoundingClientRect(),f=i.getBoundingClientRect();let h=t.clientX-f.width/2;h+f.width>l.width+l.left&&(h=l.width+l.left-f.width),h<0&&(h=0);let S=t.clientY-f.height-10;if(S<0&&(S=t.clientY+10),window.visualViewport){const E=window.visualViewport.width+window.visualViewport.offsetLeft-f.width,c=window.visualViewport.height+window.visualViewport.offsetTop-f.height;h<window.visualViewport.offsetLeft?h=window.visualViewport.offsetLeft:h>E&&(h=E),S<window.visualViewport.offsetTop?S=window.visualViewport.offsetTop:S>c&&(S=c)}i.style.transform=`translateX(${h}px) translateY(${S}px)`,setTimeout(()=>{U=!1},0)})};I.DefaultToolName=G,I.editorTouchSelectionHelp=ce,Object.defineProperty(I,Symbol.toStringTag,{value:"Module"})}));

(function(V,z){typeof exports=="object"&&typeof module<"u"?z(exports):typeof define=="function"&&define.amd?define(["exports"],z):(V=typeof globalThis<"u"?globalThis:V||self,z(V["monaco-touch-selection"]={}))})(this,(function(V){"use strict";var q=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.Hover="hover",e.ReadOnly="readOnly",e.Undo="undo",e.Redo="redo",e.Close="close",e))(q||{});const ne=(e,f)=>({startLineNumber:f.lineNumber,startColumn:f.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),oe=(e,f)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:f.lineNumber,endColumn:f.column}),se=(e,f,w)=>{const y=e.getScrollTop(),H=e.getScrollHeight(),_=e.getLayoutInfo().height,E=Math.max(0,H-_),k=y>0,m=y<E,x=e.getTargetAtClientPoint(f.clientX,f.clientY-w),b=e.getTargetAtClientPoint(f.clientX,f.clientY+w);if(x===null&&b!==null&&k){const S=Math.max(0,y-w);e.setScrollTop(S,0)}else if(x!==null&&b===null&&m){const S=Math.min(E,y+w);e.setScrollTop(S,0)}},le=(e,f,w)=>{const y=e.getScrollLeft(),H=e.getScrollWidth(),_=e.getLayoutInfo().width,E=Math.max(0,H-_),k=y>0,m=y<E,x=e.getTargetAtClientPoint(f.clientX-w,f.clientY),b=e.getTargetAtClientPoint(f.clientX+w,f.clientY);if(x===null&&b!==null&&k){const S=Math.max(0,y-w);e.setScrollLeft(S,0)}else if(x!==null&&b===null&&m){const S=Math.min(E,y+w);e.setScrollLeft(S,0)}},ie=(e,f)=>{const{tools:w,selectionSyncTimeout:y=300,toolActionErrorHandler:H=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=f??{};if(!e)throw new Error("editor not existed");const _=globalThis.monaco?.editor?.EditorOption,E=_?.fontSize??52,k=_?.lineHeight??67,m=e.getDomNode();if(!m||!(m instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const x=m.querySelector(".overflow-guard");if(!x||!(x instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const b=m.querySelector(".monaco-editor .margin");let S=0;b&&b instanceof HTMLElement&&(S=b.offsetWidth);let D=!1,h=null,a=null,u=null;const ce=()=>{h&&(D||(D=!0,h.classList.add("show")))},G=()=>{h&&D&&(D=!1,h.classList.remove("show"))};let $=!1,i=null;const J=[],A=()=>{if(i){for(const t of J){const n=t.fn();t.el.innerHTML=typeof n=="string"?n:"",typeof n!="string"&&t.el.appendChild(n)}$||($=!0,i.classList.add("show"))}},O=()=>{i&&$&&($=!1,i.classList.remove("show"))};let U=new ResizeObserver(()=>{G(),O();const t=e.getSelection();t&&W(t)});U.observe(m),e.onDidDispose(()=>{U?.disconnect(),U=null,h?.remove(),a?.remove(),u?.remove(),i?.remove(),h=null,a=null,u=null,i=null});const re=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},ae=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await H(`copy fail: ${t}`,t),!1}},ue=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await H("cut",t),!1}},de=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await H("paste",t),!1}},fe=()=>{e.trigger("keyboard","undo",null)},me=()=>{e.trigger("keyboard","redo",null)},Q="translateX(-50%) translateY(25%) rotate(45deg)",he="translateX(-100%) rotate(90deg)",pe="",Z=t=>{if(!a||!u)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},o={lineNumber:t.endLineNumber,column:t.endColumn},l=e.getScrollLeft(),c=e.getScrolledVisiblePosition(n),v=e.getScrolledVisiblePosition(o);if(!c||!v)return;const B=e.getTopForPosition(n.lineNumber,n.column),I=e.getTopForPosition(o.lineNumber,o.column),d=c.left+l-S,Y=B,L=v.left+l-S,R=I;a.style.opacity="1",u.style.opacity="1",a.style.transform=`translateX(${d}px) translateY(${Y}px)`,u.style.transform=`translateX(${L}px) translateY(${R}px)`,d===L&&Y===R?(a.bottomCursor.style.transform=Q,u.bottomCursor.style.transform=Q):(a.bottomCursor.style.transform=he,u.bottomCursor.style.transform=pe)};let j=0,ee;const W=t=>{if(clearTimeout(ee),!a||!u)return;const n=Date.now();if(n-j<y){j=n,a.style.opacity="0",u.style.opacity="0",ee=window.setTimeout(()=>{Z(t)},y);return}else j=n,Z(t)},te=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const o=document.createElement("div");o.classList.add("bottom-cursor"),t.appendChild(o);const l=t;return l.textCursor=n,l.bottomCursor=o,l},ge=()=>{h=document.createElement("div"),h.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),a=te(t),h.appendChild(t);const n=document.createElement("div");n.classList.add("right"),u=te(n),h.appendChild(n);let o=e.getOption(k),l=e.getOption(E);const c=d=>{a&&(a.textCursor.style.height=`${d}px`,a.bottomCursor.style.top=`${d}px`,a.bottomCursor.style.marginTop="0"),u&&(u.textCursor.style.height=`${d}px`,u.bottomCursor.style.top=`${d}px`,u.bottomCursor.style.marginTop="0")};c(o),e.onDidChangeConfiguration(d=>{o=e.getOption(k),c(o),d.hasChanged(E)&&(l=e.getOption(E))}),x.append(h),e.onDidScrollChange(d=>{h&&(h.style.top=`-${d.scrollTop}px`,h.style.left=`-${d.scrollLeft}px`)});const v=(d,Y)=>{const L=M=>{if(M&&i&&a&&u){A();const T=a.getBoundingClientRect(),p=u.getBoundingClientRect(),K=Math.pow(M.clientX-(T.left+T.width/2),2)+Math.pow(M.clientY-(T.top+T.height/2),2),F=Math.pow(M.clientX-(p.left+p.width/2),2)+Math.pow(M.clientY-(p.top+p.height/2),2),N=K<=F?T:p,C=m.getBoundingClientRect(),g=i.getBoundingClientRect();let r=N.left-g.width/2;r+g.width>C.width+C.left&&(r=C.width+C.left-g.width),r<0&&(r=0);let s=N.top-g.height;if(s+g.height>C.height+C.top&&(s=C.height+C.top-g.height),s<0&&(s=N.top+o),window.visualViewport){const P=window.visualViewport.width+window.visualViewport.offsetLeft-g.width,X=window.visualViewport.height+window.visualViewport.offsetTop-g.height;r<window.visualViewport.offsetLeft?r=window.visualViewport.offsetLeft:r>P&&(r=P),s<window.visualViewport.offsetTop?s=window.visualViewport.offsetTop:s>X&&(s=X)}else{const P=document.body.clientWidth+document.documentElement.offsetLeft-g.width,X=document.body.clientHeight+document.documentElement.offsetTop-g.height;r<document.documentElement.offsetLeft?r=document.documentElement.offsetLeft:r>P&&(r=P),s<document.body.offsetTop?s=document.body.offsetTop:s>X&&(s=X)}i.style.transform=`translateX(${r}px) translateY(${s}px)`}};let R=0;d.addEventListener("touchstart",M=>{const T=e.getSelection();if(!T)return;let p=M.changedTouches[0]??M.touches[0];const K=T.isEmpty();let F=0;try{const s=d.classList.contains("left")?{lineNumber:T.startLineNumber,column:T.startColumn}:{lineNumber:T.endLineNumber,column:T.endColumn},P=e.getScrolledVisiblePosition(s);P&&(F=m.getBoundingClientRect().top+P.top+P.height/2-p.clientY)}catch{}let N=null;const C=()=>{N===null&&(N=setInterval(()=>{se(e,p,o),le(e,p,l);const s=e.getTargetAtClientPoint(p.clientX,p.clientY+F-o*1.5);s&&s.position&&(K?e.setPosition(s.position):e.setSelection(Y(T,s.position)))},50))},g=s=>{s.preventDefault(),p=s.changedTouches[0]??s.touches[0],C()},r=s=>{if(N!==null&&clearInterval(N),N=null,Date.now()-R>100){document.removeEventListener("touchmove",g),document.removeEventListener("touchend",r),document.removeEventListener("touchcancel",r);return}s.preventDefault(),p=s.changedTouches[0]??s.touches[0],i&&e.getSelection()!==null&&L(p),document.removeEventListener("touchmove",g),document.removeEventListener("touchend",r),document.removeEventListener("touchcancel",r)};R=Date.now(),document.addEventListener("touchmove",g,{passive:!1}),document.addEventListener("touchend",r),document.addEventListener("touchcancel",r)},{passive:!0})};v(a,ne),v(u,oe);const B=d=>{let Y=0;d.addEventListener("touchstart",()=>{Y=Date.now()},{passive:!0}),d.addEventListener("touchend",()=>{if(Date.now()-Y>1e3)return;const L=e.getSelection();if(!L||L?.startColumn!==L.endColumn||L.startLineNumber!==L.endLineNumber)return;const R=e.getModel();if(!R)return;const M=R.getWordAtPosition(L.getStartPosition());M&&(e.setSelection({startLineNumber:L.startLineNumber,startColumn:M.startColumn,endLineNumber:L.endLineNumber,endColumn:M.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};B(a.textCursor),B(u.textCursor);const I=e.getSelection();I&&W(I)};e.onDidChangeCursorSelection(t=>{O(),setTimeout(()=>{W(t.selection)},0)}),ge();const we=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await ae()&&O()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await ue()&&O()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await de()&&O()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{fe(),A()}}],["redo",{name:"redo",innerHTML:`
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
</svg>`,action:()=>{me(),A()}}],["selectWord",{name:"select",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M5 3h2m4 0h2m4 0h2M3 7v2m18-2v2M3 13v2m18-2v2M5 21h2m4 0h2m4 0h2"/>
</svg>`,action:()=>{const o=e.getSelection();if(!o)return;const l=e.getModel();if(!l)return;const c=l.getWordAtPosition(o.getStartPosition());c&&(e.setSelection({startLineNumber:o.startLineNumber,startColumn:c.startColumn,endLineNumber:o.endLineNumber,endColumn:c.endColumn}),setTimeout(()=>{e.focus()})),A()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{re(),A()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{O();const o=e.getSelection();if(o&&o.getStartPosition)try{e.setPosition(o.getStartPosition())}catch{}const l=e.getAction("editor.action.showHover");return l?l.run():e.trigger("touch","editor.action.showHover",null),!0}}],["readOnly",{name:"read only",innerHTML:()=>`<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 100 100" style="fill: ${e.getOption(_?.readOnly??89)?"#4fc3f7":"currentColor"}; stroke: none;"><path d="M84.4,24.3H38l7,7h39.4c0.8,0,1.5,0.7,1.5,1.5v38.5c0,0.2-0.1,0.5-0.2,0.7l5,5c1.4-1.5,2.2-3.5,2.2-5.6V32.8C92.9,28.2,89.1,24.3,84.4,24.3z"/><path d="M66.9,53.3c0,1.9,1.6,3.5,3.5,3.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4C68.5,49.8,66.9,51.3,66.9,53.3z"/><path d="M34.2,53.3c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4C32.7,56.8,34.2,55.2,34.2,53.3z"/><path d="M60.4,45.5c1.9,0,3.5-1.6,3.5-3.5s-1.6-3.5-3.5-3.5H56c-1.1,0-2,0.5-2.6,1.2l5.8,5.8H60.4z"/><path d="M74.8,45.5c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5H74.8z"/><path d="M26.3,45.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5C22.8,43.9,24.4,45.5,26.3,45.5z"/><path d="M85.2,81.3l-8.4-8.4L70.8,67l0,0c0,0,0,0,0,0l-5.6-5.6l-4.6-4.6l0,0l-6.4-6.4l-6-6v0L23.3,19.5v0l-1.8-1.8c-1.4-1.4-3.6-1.4-4.9,0c-1.4,1.4-1.4,3.6,0,4.9l1.7,1.7h-1.5c-4.7,0-8.5,3.8-8.5,8.5v38.5c0,4.7,3.8,8.5,8.5,8.5h57l6.4,6.4c0.7,0.7,1.6,1,2.5,1c0.9,0,1.8-0.3,2.5-1c1.2-1.2,1.3-3,0.5-4.4C85.5,81.7,85.3,81.5,85.2,81.3z M16.8,72.8c-0.8,0-1.5-0.7-1.5-1.5V32.8c0-0.8,0.7-1.5,1.5-1.5h8.5l18.4,18.4l0,0h-2.6c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4c1.4,0,2.6-0.8,3.2-2l6.6,6.6H33.1c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5h29.3l4.5,4.5H16.8z"/></svg>`,action:()=>{const o=e.getOption(_?.readOnly??89);e.updateOptions({readOnly:!o}),A()}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(O(),!0)}]]);if(w===void 0)return n.values();if(typeof w=="function"){const o=w({editor:e,selectorMenu:t,defaultTools:n,openMenu:A,closeMenu:O});return o===void 0?n.values():o}return n.values()};(()=>{i=document.createElement("div"),i.classList.add("monaco-editor-touch-selector-menu");for(const t of we(i)){const n=document.createElement("div");if(n.classList.add("menu-item"),typeof t.innerHTML=="function"){const l=t.innerHTML();typeof l=="string"?n.innerHTML=l:n.appendChild(l),J.push({el:n,fn:t.innerHTML})}else typeof t.innerHTML=="string"?n.innerHTML=t.innerHTML:n.appendChild(t.innerHTML);const o=async()=>{try{await t.action()}catch(l){await H(t.name,l)}};n.addEventListener("touchend",o),n.addEventListener("click",o),i.appendChild(n)}i.addEventListener("touchstart",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchmove",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchend",t=>{t.preventDefault()},{passive:!1}),document.documentElement.append(i)})(),m.addEventListener("touchstart",()=>{ce()},{passive:!0}),e.onDidBlurEditorWidget(()=>{G(),O()}),m.addEventListener("click",t=>{t.stopPropagation()}),m.addEventListener("contextmenu",t=>{if(t.preventDefault(),t.stopPropagation(),!i)return;const n=e.getTargetAtClientPoint(t.clientX,t.clientY);n&&n.position&&e.setPosition(n.position),A();const o=m.getBoundingClientRect(),l=i.getBoundingClientRect();let c=t.clientX-l.width/2;c+l.width>o.width+o.left&&(c=o.width+o.left-l.width),c<0&&(c=0);let v=t.clientY-l.height-10;if(v<0&&(v=t.clientY+10),window.visualViewport){const B=window.visualViewport.width+window.visualViewport.offsetLeft-l.width,I=window.visualViewport.height+window.visualViewport.offsetTop-l.height;c<window.visualViewport.offsetLeft?c=window.visualViewport.offsetLeft:c>B&&(c=B),v<window.visualViewport.offsetTop?v=window.visualViewport.offsetTop:v>I&&(v=I)}i.style.transform=`translateX(${c}px) translateY(${v}px)`})};V.DefaultToolName=q,V.editorTouchSelectionHelp=ie,Object.defineProperty(V,Symbol.toStringTag,{value:"Module"})}));

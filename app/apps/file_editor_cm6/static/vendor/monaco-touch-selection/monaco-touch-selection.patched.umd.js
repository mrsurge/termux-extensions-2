(function(A,D){typeof exports=="object"&&typeof module<"u"?D(exports):typeof define=="function"&&define.amd?define(["exports"],D):(A=typeof globalThis<"u"?globalThis:A||self,D(A["monaco-touch-selection"]={}))})(this,(function(A){"use strict";var q=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.Hover="hover",e.Undo="undo",e.Redo="redo",e.Close="close",e))(q||{});const te=(e,f)=>({startLineNumber:f.lineNumber,startColumn:f.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),ne=(e,f)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:f.lineNumber,endColumn:f.column}),oe=(e,f,w)=>{const S=e.getScrollTop(),_=e.getScrollHeight(),Y=e.getLayoutInfo().height,C=Math.max(0,_-Y),X=S>0,m=S<C,x=e.getTargetAtClientPoint(f.clientX,f.clientY-w),b=e.getTargetAtClientPoint(f.clientX,f.clientY+w);if(x===null&&b!==null&&X){const M=Math.max(0,S-w);e.setScrollTop(M,0)}else if(x!==null&&b===null&&m){const M=Math.min(C,S+w);e.setScrollTop(M,0)}},se=(e,f,w)=>{const S=e.getScrollLeft(),_=e.getScrollWidth(),Y=e.getLayoutInfo().width,C=Math.max(0,_-Y),X=S>0,m=S<C,x=e.getTargetAtClientPoint(f.clientX-w,f.clientY),b=e.getTargetAtClientPoint(f.clientX+w,f.clientY);if(x===null&&b!==null&&X){const M=Math.max(0,S-w);e.setScrollLeft(M,0)}else if(x!==null&&b===null&&m){const M=Math.min(C,S+w);e.setScrollLeft(M,0)}},le=(e,f)=>{const{tools:w,selectionSyncTimeout:S=300,toolActionErrorHandler:_=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=f??{};if(!e)throw new Error("editor not existed");const Y=globalThis.monaco?.editor?.EditorOption,C=Y?.fontSize??52,X=Y?.lineHeight??67,m=e.getDomNode();if(!m||!(m instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const x=m.querySelector(".overflow-guard");if(!x||!(x instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const b=m.querySelector(".monaco-editor .margin");let M=0;b&&b instanceof HTMLElement&&(M=b.offsetWidth);let $=!1,h=null,a=null,u=null;const ie=()=>{h&&($||($=!0,h.classList.add("show")))},G=()=>{h&&$&&($=!1,h.classList.remove("show"))};let F=!1,i=null;const R=()=>{i&&(F||(F=!0,i.classList.add("show")))},N=()=>{i&&F&&(F=!1,i.classList.remove("show"))};let j=new ResizeObserver(()=>{G(),N();const t=e.getSelection();t&&W(t)});j.observe(m),e.onDidDispose(()=>{j?.disconnect(),j=null,h?.remove(),a?.remove(),u?.remove(),i?.remove(),h=null,a=null,u=null,i=null});const re=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},ce=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await _(`copy fail: ${t}`,t),!1}},ae=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await _("cut",t),!1}},ue=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await _("paste",t),!1}},de=()=>{e.trigger("keyboard","undo",null)},fe=()=>{e.trigger("keyboard","redo",null)},J="translateX(-50%) translateY(25%) rotate(45deg)",me="translateX(-100%) rotate(90deg)",he="",Q=t=>{if(!a||!u)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},o={lineNumber:t.endLineNumber,column:t.endColumn},l=e.getScrollLeft(),r=e.getScrolledVisiblePosition(n),v=e.getScrolledVisiblePosition(o);if(!r||!v)return;const V=e.getTopForPosition(n.lineNumber,n.column),B=e.getTopForPosition(o.lineNumber,o.column),d=r.left+l-M,I=V,L=v.left+l-M,H=B;a.style.opacity="1",u.style.opacity="1",a.style.transform=`translateX(${d}px) translateY(${I}px)`,u.style.transform=`translateX(${L}px) translateY(${H}px)`,d===L&&I===H?(a.bottomCursor.style.transform=J,u.bottomCursor.style.transform=J):(a.bottomCursor.style.transform=me,u.bottomCursor.style.transform=he)};let z=0,Z;const W=t=>{if(clearTimeout(Z),!a||!u)return;const n=Date.now();if(n-z<S){z=n,a.style.opacity="0",u.style.opacity="0",Z=window.setTimeout(()=>{Q(t)},S);return}else z=n,Q(t)},ee=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const o=document.createElement("div");o.classList.add("bottom-cursor"),t.appendChild(o);const l=t;return l.textCursor=n,l.bottomCursor=o,l},pe=()=>{h=document.createElement("div"),h.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),a=ee(t),h.appendChild(t);const n=document.createElement("div");n.classList.add("right"),u=ee(n),h.appendChild(n);let o=e.getOption(X),l=e.getOption(C);const r=d=>{a&&(a.textCursor.style.height=`${d}px`,a.bottomCursor.style.top=`${d}px`,a.bottomCursor.style.marginTop="0"),u&&(u.textCursor.style.height=`${d}px`,u.bottomCursor.style.top=`${d}px`,u.bottomCursor.style.marginTop="0")};r(o),e.onDidChangeConfiguration(d=>{o=e.getOption(X),r(o),d.hasChanged(C)&&(l=e.getOption(C))}),x.append(h),e.onDidScrollChange(d=>{h&&(h.style.top=`-${d.scrollTop}px`,h.style.left=`-${d.scrollLeft}px`)});const v=(d,I)=>{const L=y=>{if(y&&i&&a&&u){R();const T=a.getBoundingClientRect(),p=u.getBoundingClientRect(),K=Math.pow(y.clientX-(T.left+T.width/2),2)+Math.pow(y.clientY-(T.top+T.height/2),2),U=Math.pow(y.clientX-(p.left+p.width/2),2)+Math.pow(y.clientY-(p.top+p.height/2),2),P=K<=U?T:p,E=m.getBoundingClientRect(),g=i.getBoundingClientRect();let c=P.left-g.width/2;c+g.width>E.width+E.left&&(c=E.width+E.left-g.width),c<0&&(c=0);let s=P.top-g.height;if(s+g.height>E.height+E.top&&(s=E.height+E.top-g.height),s<0&&(s=P.top+o),window.visualViewport){const O=window.visualViewport.width+window.visualViewport.offsetLeft-g.width,k=window.visualViewport.height+window.visualViewport.offsetTop-g.height;c<window.visualViewport.offsetLeft?c=window.visualViewport.offsetLeft:c>O&&(c=O),s<window.visualViewport.offsetTop?s=window.visualViewport.offsetTop:s>k&&(s=k)}else{const O=document.body.clientWidth+document.documentElement.offsetLeft-g.width,k=document.body.clientHeight+document.documentElement.offsetTop-g.height;c<document.documentElement.offsetLeft?c=document.documentElement.offsetLeft:c>O&&(c=O),s<document.body.offsetTop?s=document.body.offsetTop:s>k&&(s=k)}i.style.transform=`translateX(${c}px) translateY(${s}px)`}};let H=0;d.addEventListener("touchstart",y=>{const T=e.getSelection();if(!T)return;let p=y.changedTouches[0]??y.touches[0];const K=T.isEmpty();let U=0;try{const s=d.classList.contains("left")?{lineNumber:T.startLineNumber,column:T.startColumn}:{lineNumber:T.endLineNumber,column:T.endColumn},O=e.getScrolledVisiblePosition(s);O&&(U=m.getBoundingClientRect().top+O.top+O.height/2-p.clientY)}catch{}let P=null;const E=()=>{P===null&&(P=setInterval(()=>{oe(e,p,o),se(e,p,l);const s=e.getTargetAtClientPoint(p.clientX,p.clientY+U-o*1.5);s&&s.position&&(K?e.setPosition(s.position):e.setSelection(I(T,s.position)))},50))},g=s=>{s.preventDefault(),p=s.changedTouches[0]??s.touches[0],E()},c=s=>{if(P!==null&&clearInterval(P),P=null,Date.now()-H>100){document.removeEventListener("touchmove",g),document.removeEventListener("touchend",c),document.removeEventListener("touchcancel",c);return}s.preventDefault(),p=s.changedTouches[0]??s.touches[0],i&&e.getSelection()!==null&&L(p),document.removeEventListener("touchmove",g),document.removeEventListener("touchend",c),document.removeEventListener("touchcancel",c)};H=Date.now(),document.addEventListener("touchmove",g,{passive:!1}),document.addEventListener("touchend",c),document.addEventListener("touchcancel",c)},{passive:!0})};v(a,te),v(u,ne);const V=d=>{let I=0;d.addEventListener("touchstart",()=>{I=Date.now()},{passive:!0}),d.addEventListener("touchend",()=>{if(Date.now()-I>1e3)return;const L=e.getSelection();if(!L||L?.startColumn!==L.endColumn||L.startLineNumber!==L.endLineNumber)return;const H=e.getModel();if(!H)return;const y=H.getWordAtPosition(L.getStartPosition());y&&(e.setSelection({startLineNumber:L.startLineNumber,startColumn:y.startColumn,endLineNumber:L.endLineNumber,endColumn:y.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};V(a.textCursor),V(u.textCursor);const B=e.getSelection();B&&W(B)};e.onDidChangeCursorSelection(t=>{N(),setTimeout(()=>{W(t.selection)},0)}),pe();const ge=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await ce()&&N()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await ae()&&N()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await ue()&&N()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{fe(),R()}}],["selectWord",{name:"select",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M5 3h2m4 0h2m4 0h2M3 7v2m18-2v2M3 13v2m18-2v2M5 21h2m4 0h2m4 0h2"/>
</svg>`,action:()=>{const o=e.getSelection();if(!o)return;const l=e.getModel();if(!l)return;const r=l.getWordAtPosition(o.getStartPosition());r&&(e.setSelection({startLineNumber:o.startLineNumber,startColumn:r.startColumn,endLineNumber:o.endLineNumber,endColumn:r.endColumn}),setTimeout(()=>{e.focus()})),R()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{re(),R()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{N();const o=e.getSelection();if(o&&o.getStartPosition)try{e.setPosition(o.getStartPosition())}catch{}const l=e.getAction("editor.action.showHover");return l?l.run():e.trigger("touch","editor.action.showHover",null),!0}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(N(),!0)}]]);if(w===void 0)return n.values();if(typeof w=="function"){const o=w({editor:e,selectorMenu:t,defaultTools:n,openMenu:R,closeMenu:N});return o===void 0?n.values():o}return n.values()};(()=>{i=document.createElement("div"),i.classList.add("monaco-editor-touch-selector-menu");for(const t of ge(i)){const n=document.createElement("div");if(n.classList.add("menu-item"),typeof t.innerHTML=="function"){const o=t.innerHTML();typeof o=="string"?n.innerHTML=o:n.appendChild(o)}else typeof t.innerHTML=="string"?n.innerHTML=t.innerHTML:n.appendChild(t.innerHTML);n.addEventListener("touchend",async()=>{try{await t.action()}catch(o){await _(t.name,o)}}),i.appendChild(n)}i.addEventListener("touchstart",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchmove",t=>{t.preventDefault()},{passive:!1}),i.addEventListener("touchend",t=>{t.preventDefault()},{passive:!1}),document.documentElement.append(i)})(),m.addEventListener("touchstart",()=>{ie()},{passive:!0}),e.onDidBlurEditorWidget(()=>{G(),N()}),m.addEventListener("click",t=>{t.stopPropagation()}),m.addEventListener("contextmenu",t=>{if(t.preventDefault(),t.stopPropagation(),!i)return;const n=e.getTargetAtClientPoint(t.clientX,t.clientY);n&&n.position&&e.setPosition(n.position),R();const o=m.getBoundingClientRect(),l=i.getBoundingClientRect();let r=t.clientX-l.width/2;r+l.width>o.width+o.left&&(r=o.width+o.left-l.width),r<0&&(r=0);let v=t.clientY-l.height-10;if(v<0&&(v=t.clientY+10),window.visualViewport){const V=window.visualViewport.width+window.visualViewport.offsetLeft-l.width,B=window.visualViewport.height+window.visualViewport.offsetTop-l.height;r<window.visualViewport.offsetLeft?r=window.visualViewport.offsetLeft:r>V&&(r=V),v<window.visualViewport.offsetTop?v=window.visualViewport.offsetTop:v>B&&(v=B)}i.style.transform=`translateX(${r}px) translateY(${v}px)`})};A.DefaultToolName=q,A.editorTouchSelectionHelp=le,Object.defineProperty(A,Symbol.toStringTag,{value:"Module"})}));

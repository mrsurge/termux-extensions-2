(function(X,G){typeof exports=="object"&&typeof module<"u"?G(exports):typeof define=="function"&&define.amd?define(["exports"],G):(X=typeof globalThis<"u"?globalThis:X||self,G(X["monaco-touch-selection"]={}))})(this,(function(X){"use strict";var ce=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.GrowSelectionLeft="growSelectionLeft",e.GrowSelectionRight="growSelectionRight",e.Hover="hover",e.Find="find",e.Mention="mention",e.ReadOnly="readOnly",e.Undo="undo",e.Redo="redo",e.Close="close",e))(ce||{});const he=(e,w)=>({startLineNumber:w.lineNumber,startColumn:w.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),ge=(e,w)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:w.lineNumber,endColumn:w.column}),pe=(e,w,T)=>{const x=e.getScrollTop(),k=e.getScrollHeight(),I=e.getLayoutInfo().height,A=Math.max(0,k-I),D=x>0,M=x<A,R=e.getTargetAtClientPoint(w.clientX,w.clientY-T),_=e.getTargetAtClientPoint(w.clientX,w.clientY+T);if(R===null&&_!==null&&D){const N=Math.max(0,x-T);e.setScrollTop(N,0)}else if(R!==null&&_===null&&M){const N=Math.min(A,x+T);e.setScrollTop(N,0)}},we=(e,w,T)=>{const x=e.getScrollLeft(),k=e.getScrollWidth(),I=e.getLayoutInfo().width,A=Math.max(0,k-I),D=x>0,M=x<A,R=e.getTargetAtClientPoint(w.clientX-T,w.clientY),_=e.getTargetAtClientPoint(w.clientX+T,w.clientY);if(R===null&&_!==null&&D){const N=Math.max(0,x-T);e.setScrollLeft(N,0)}else if(R!==null&&_===null&&M){const N=Math.min(A,x+T);e.setScrollLeft(N,0)}},ve=(e,w)=>{const{tools:T,selectionSyncTimeout:x=300,toolActionErrorHandler:k=(t,o)=>{console.error(`tool ${t} cause error: `,o)}}=w??{};if(!e)throw new Error("editor not existed");const I=globalThis.monaco?.editor?.EditorOption,A=I?.fontSize??52,D=I?.lineHeight??67,M=e.getDomNode();if(!M||!(M instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const R=M.querySelector(".overflow-guard");if(!R||!(R instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const _=M.querySelector(".monaco-editor .margin");let N=0;_&&_ instanceof HTMLElement&&(N=_.offsetWidth);let J=!1,S=null,d=null,f=null;const Le=()=>{S&&(J||(J=!0,S.classList.add("show")))},re=()=>{S&&J&&(J=!1,S.classList.remove("show"))};let F=!1,h=null,p=null;const ie=[];let j=!1,$=null;const Q=()=>{const t=$;$=null,t?.(),j=!1},ae=()=>Q(),ue=()=>{document.hidden&&Q()};window.addEventListener("blur",ae),document.addEventListener("visibilitychange",ue);const B=()=>{if(!(!h||!p)){for(const t of ie){const o=t.fn();t.el.innerHTML=typeof o=="string"?o:"",typeof o!="string"&&t.el.appendChild(o)}F||(F=!0,h.classList.add("show"),p.classList.add("show"))}},P=()=>{!h||!p||F&&(j||(F=!1,h.classList.remove("show"),p.classList.remove("show")))},me=(t,o,s)=>{if(!h||!p)return;B();const n=h.getBoundingClientRect(),l=p.getBoundingClientRect(),r=6,a=Math.max(n.width,l.width),C=n.height+r+l.height,c=window.visualViewport?.offsetLeft??document.documentElement.offsetLeft,b=window.visualViewport?.offsetTop??document.body.offsetTop,v=window.visualViewport?window.visualViewport.offsetLeft+window.visualViewport.width:document.documentElement.offsetLeft+document.body.clientWidth,g=window.visualViewport?window.visualViewport.offsetTop+window.visualViewport.height:document.body.offsetTop+document.body.clientHeight,u=c,i=b,O=v,H=g,L=(V,U,K)=>Math.min(Math.max(V,U),Math.max(U,K)),Y=L(t-a/2,u,O-a);let E=o-C;E<i&&(E=s),E=L(E,i,H-C);const W=Y+(a-l.width)/2,z=Y+(a-n.width)/2;p.style.transform=`translateX(${W}px) translateY(${E}px)`,h.style.transform=`translateX(${z}px) translateY(${E+l.height+r}px)`};let te=new ResizeObserver(()=>{re(),P();const t=e.getSelection();t&&se(t)});te.observe(M),e.onDidDispose(()=>{Q(),window.removeEventListener("blur",ae),document.removeEventListener("visibilitychange",ue),te?.disconnect(),te=null,S?.remove(),d?.remove(),f?.remove(),h?.remove(),p?.remove(),S=null,d=null,f=null,h=null,p=null});const Me=()=>{e.focus();const t=e.getModel();if(t){const o=t.getFullModelRange();e.setSelection(o)}},Se=t=>{const o=e.getModel();if(!o)return t;if(t.column>1)return{lineNumber:t.lineNumber,column:t.column-1};if(t.lineNumber>1){const s=t.lineNumber-1;return{lineNumber:s,column:o.getLineMaxColumn(s)}}return t},ye=t=>{const o=e.getModel();if(!o)return t;const s=o.getLineMaxColumn(t.lineNumber);return t.column<s?{lineNumber:t.lineNumber,column:t.column+1}:t.lineNumber<o.getLineCount()?{lineNumber:t.lineNumber+1,column:1}:t},Te=()=>{const t=e.getSelection();if(!t)return;const o=t.getStartPosition(),s=Se(o);e.setSelection({startLineNumber:s.lineNumber,startColumn:s.column,endLineNumber:t.endLineNumber,endColumn:t.endColumn})},Ce=()=>{const t=e.getSelection();if(!t)return;const o=t.getEndPosition(),s=ye(o);e.setSelection({startLineNumber:t.startLineNumber,startColumn:t.startColumn,endLineNumber:s.lineNumber,endColumn:s.column})},be=(t,o)=>{const s=e.getTargetAtClientPoint(t,o);if(!s?.position)return null;const n=e.getModel();if(!n)return s.position;const l=s.position.lineNumber,r=n.getLineMaxColumn(l),a=e.getLayoutInfo(),C=M.getBoundingClientRect(),c=t-C.left-a.contentLeft+e.getScrollLeft();try{const b=C.left+a.contentLeft,v=b+Math.max(1,a.contentWidth)-1,g=e.getTargetAtClientPoint(b,o)?.position,u=e.getTargetAtClientPoint(v,o)?.position;if(g?.lineNumber!==l||u?.lineNumber!==l)return s.position;let i=Math.min(g.column,u.column,s.position.column),O=Math.max(g.column,u.column,s.position.column);for(i=Math.max(1,i),O=Math.min(r,O);i<O;){const z=Math.floor((i+O)/2),V=e.getOffsetForColumn(l,z);if(V<0)return s.position;V<c?i=z+1:O=z}const H=i,L=Math.max(1,H-1),Y=e.getOffsetForColumn(l,H),E=e.getOffsetForColumn(l,L);if(Y<0||E<0)return s.position;const W=Math.abs(c-E)<=Math.abs(Y-c)?L:H;return{lineNumber:l,column:W}}catch{return s.position}},xe=async()=>{try{const t=e.getSelection();if(!t)return!1;const o=e.getModel()?.getValueInRange(t);return o?(await navigator.clipboard.writeText(o),!0):!1}catch(t){return await k(`copy fail: ${t}`,t),!1}},Ee=async()=>{try{const t=e.getSelection();if(!t)return!1;const o=e.getModel()?.getValueInRange(t);return o?(await navigator.clipboard.writeText(o),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await k("cut",t),!1}},Ne=async()=>{try{const t=e.getSelection();if(!t)return!1;const o=await navigator.clipboard.readText();return o.length===0?!1:(e.executeEdits("paste",[{range:t,text:o}]),!0)}catch(t){return await k("paste",t),!1}},Pe=()=>{e.trigger("keyboard","undo",null)},Oe=()=>{e.trigger("keyboard","redo",null)},de="translateX(-50%) translateY(25%) rotate(45deg)",He="translateX(-100%) rotate(90deg)",Ae="",ne=t=>{if(!d||!f)return;const o={lineNumber:t.startLineNumber,column:t.startColumn},s={lineNumber:t.endLineNumber,column:t.endColumn},n=e.getScrollLeft(),l=e.getScrolledVisiblePosition(o),r=e.getScrolledVisiblePosition(s);if(!l||!r)return;const a=e.getTopForPosition(o.lineNumber,o.column),C=e.getTopForPosition(s.lineNumber,s.column),c=l.left+n-N,b=a,v=r.left+n-N,g=C;d.style.opacity="1",f.style.opacity="1",d.style.transform=`translateX(${c}px) translateY(${b}px)`,f.style.transform=`translateX(${v}px) translateY(${g}px)`,c===v&&b===g?(d.bottomCursor.style.transform=de,f.bottomCursor.style.transform=de):(d.bottomCursor.style.transform=He,f.bottomCursor.style.transform=Ae)};let oe=0,Z;const se=t=>{if(clearTimeout(Z),!d||!f)return;const o=Date.now();if(o-oe<x){oe=o,d.style.opacity="0",f.style.opacity="0",Z=window.setTimeout(()=>{ne(t)},x);return}else oe=o,ne(t)},fe=t=>{t.classList.add("selector");const o=document.createElement("div");o.classList.add("text-cursor"),t.appendChild(o);const s=document.createElement("div");s.classList.add("bottom-cursor"),t.appendChild(s);const n=t;return n.textCursor=o,n.bottomCursor=s,n},Re=()=>{S=document.createElement("div"),S.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),d=fe(t),S.appendChild(t);const o=document.createElement("div");o.classList.add("right"),f=fe(o),S.appendChild(o);let s=e.getOption(D),n=e.getOption(A);const l=c=>{d&&(d.textCursor.style.height=`${c}px`,d.bottomCursor.style.top=`${c}px`,d.bottomCursor.style.marginTop="0"),f&&(f.textCursor.style.height=`${c}px`,f.bottomCursor.style.top=`${c}px`,f.bottomCursor.style.marginTop="0")};l(s),e.onDidChangeConfiguration(c=>{s=e.getOption(D),l(s),c.hasChanged(A)&&(n=e.getOption(A))}),R.append(S),e.onDidScrollChange(c=>{S&&(S.style.top=`-${c.scrollTop}px`,S.style.left=`-${c.scrollLeft}px`)});const r=(c,b)=>{const v=g=>{if(g&&d&&f){const u=d.getBoundingClientRect(),i=f.getBoundingClientRect(),O=Math.pow(g.clientX-(u.left+u.width/2),2)+Math.pow(g.clientY-(u.top+u.height/2),2),H=Math.pow(g.clientX-(i.left+i.width/2),2)+Math.pow(g.clientY-(i.top+i.height/2),2),L=O<=H?u:i;me(L.left+L.width/2,L.top,L.bottom+s)}};c.addEventListener("touchstart",g=>{const u=e.getSelection();if(!u)return;let i=g.changedTouches[0]??g.touches[0];if(!i)return;Q(),j=!0,clearTimeout(Z),Z=void 0,d&&(d.style.opacity="0"),f&&(f.style.opacity="0");const O=u.isEmpty();let H=0;try{const m=c.classList.contains("left")?{lineNumber:u.startLineNumber,column:u.startColumn}:{lineNumber:u.endLineNumber,column:u.endColumn},y=e.getScrolledVisiblePosition(m);y&&(H=M.getBoundingClientRect().top+y.top+y.height/2-i.clientY)}catch{}let L=null,Y=!1;const E=()=>{const m=be(i.clientX,i.clientY+H-s*1.5);if(m)if(O){const y=e.getPosition();if(y?.lineNumber===m.lineNumber&&y.column===m.column)return;e.setPosition(m)}else{const y=b(u,m),q=e.getSelection();if(q?.startLineNumber===y.startLineNumber&&q.startColumn===y.startColumn&&q.endLineNumber===y.endLineNumber&&q.endColumn===y.endColumn)return;e.setSelection(y)}},W=()=>{pe(e,i,s),we(e,i,n),E()},z=()=>{L===null&&(W(),L=setInterval(W,50))},V=m=>{m.preventDefault(),i=m.changedTouches[0]??m.touches[0]??i,Y=!0,z()};let U=!1;const K=()=>{if(U)return;U=!0,L!==null&&clearInterval(L),L=null,document.removeEventListener("touchmove",V),document.removeEventListener("touchend",ee),document.removeEventListener("touchcancel",ee),$===K&&($=null);const m=e.getSelection();m&&ne(m)},ee=m=>{m.type!=="touchcancel"&&m.preventDefault(),i=m.changedTouches[0]??m.touches[0]??i,Y&&E(),K();const y=e.getSelection();m.type!=="touchcancel"&&h&&y!==null&&v(i),setTimeout(()=>{j=!1},0)};$=K,document.addEventListener("touchmove",V,{passive:!1}),document.addEventListener("touchend",ee),document.addEventListener("touchcancel",ee)},{passive:!0})};r(d,he),r(f,ge);const a=c=>{let b=0;c.addEventListener("touchstart",()=>{b=Date.now()},{passive:!0}),c.addEventListener("touchend",()=>{if(Date.now()-b>1e3)return;const v=e.getSelection();if(!v||v?.startColumn!==v.endColumn||v.startLineNumber!==v.endLineNumber)return;const g=e.getModel();if(!g)return;const u=g.getWordAtPosition(v.getStartPosition());u&&(e.setSelection({startLineNumber:v.startLineNumber,startColumn:u.startColumn,endLineNumber:v.endLineNumber,endColumn:u.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};a(d.textCursor),a(f.textCursor);const C=e.getSelection();C&&se(C)};e.onDidChangeCursorSelection(t=>{P(),!$&&setTimeout(()=>{se(t.selection)},0)}),Re();const le=new Map([["growSelectionLeft",{name:"grow selection left",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 7 16 l -4 -4 l 4 -4 M 5 12 h 7"/>
</svg>`,action:()=>{Te(),B()}}],["growSelectionRight",{name:"grow selection right",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 22 6 v 12 M 17 16 l 4 -4 l -4 -4 M 12 12 h 7"/>
</svg>`,action:()=>{Ce(),B()}}]]),_e=t=>{const o=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await xe()&&P()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await Ee()&&P()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await Ne()&&P()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{Pe(),B()}}],["redo",{name:"redo",innerHTML:`
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
</svg>`,action:()=>{Oe(),B()}}],["selectWord",{name:"select",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M5 3h2m4 0h2m4 0h2M3 7v2m18-2v2M3 13v2m18-2v2M5 21h2m4 0h2m4 0h2"/>
</svg>`,action:()=>{const n=e.getSelection();if(!n)return;const l=e.getModel();if(!l)return;const r=l.getWordAtPosition(n.getStartPosition());r&&(e.setSelection({startLineNumber:n.startLineNumber,startColumn:r.startColumn,endLineNumber:n.endLineNumber,endColumn:r.endColumn}),setTimeout(()=>{e.focus()})),B()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{Me(),B()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{P();const n=e.getSelection();if(n&&n.getStartPosition)try{e.setPosition(n.getStartPosition())}catch{}const l=e.getAction("editor.action.showHover");return l?l.run():e.trigger("touch","editor.action.showHover",null),!0}}],["find",{name:"find",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🔎</span>',action:()=>{P();const n=e.getAction("actions.find");n&&n.run?n.run():e.trigger("touch-menu","actions.find",null)}}],["readOnly",{name:"read only",innerHTML:()=>`<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 100 100" style="fill: ${e.getOption(I?.readOnly??89)?"#4fc3f7":"currentColor"}; stroke: none;"><path d="M84.4,24.3H38l7,7h39.4c0.8,0,1.5,0.7,1.5,1.5v38.5c0,0.2-0.1,0.5-0.2,0.7l5,5c1.4-1.5,2.2-3.5,2.2-5.6V32.8C92.9,28.2,89.1,24.3,84.4,24.3z"/><path d="M66.9,53.3c0,1.9,1.6,3.5,3.5,3.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4C68.5,49.8,66.9,51.3,66.9,53.3z"/><path d="M34.2,53.3c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4C32.7,56.8,34.2,55.2,34.2,53.3z"/><path d="M60.4,45.5c1.9,0,3.5-1.6,3.5-3.5s-1.6-3.5-3.5-3.5H56c-1.1,0-2,0.5-2.6,1.2l5.8,5.8H60.4z"/><path d="M74.8,45.5c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5H74.8z"/><path d="M26.3,45.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5C22.8,43.9,24.4,45.5,26.3,45.5z"/><path d="M85.2,81.3l-8.4-8.4L70.8,67l0,0c0,0,0,0,0,0l-5.6-5.6l-4.6-4.6l0,0l-6.4-6.4l-6-6v0L23.3,19.5v0l-1.8-1.8c-1.4-1.4-3.6-1.4-4.9,0c-1.4,1.4-1.4,3.6,0,4.9l1.7,1.7h-1.5c-4.7,0-8.5,3.8-8.5,8.5v38.5c0,4.7,3.8,8.5,8.5,8.5h57l6.4,6.4c0.7,0.7,1.6,1,2.5,1c0.9,0,1.8-0.3,2.5-1c1.2-1.2,1.3-3,0.5-4.4C85.5,81.7,85.3,81.5,85.2,81.3z M16.8,72.8c-0.8,0-1.5-0.7-1.5-1.5V32.8c0-0.8,0.7-1.5,1.5-1.5h8.5l18.4,18.4l0,0h-2.6c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4c1.4,0,2.6-0.8,3.2-2l6.6,6.6H33.1c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5h29.3l4.5,4.5H16.8z"/></svg>`,action:()=>{const n=e.getOption(I?.readOnly??89);if(e.updateOptions({readOnly:!n}),n)try{const l=e.getDomNode(),r=l?.querySelector("textarea.inputarea")??l?.querySelector("textarea");r&&r.blur()}catch{}B()}}],["mention",{name:"mention",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">💬</span>',action:()=>{P();try{const n=e.getDomNode();n&&n.dispatchEvent(new CustomEvent("te2:mention-request",{bubbles:!1}))}catch{}return!0}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(P(),!0)}]]);for(const[n,l]of le)o.set(n,l);const s=()=>Array.from(o).filter(([n])=>!le.has(n)).map(([,n])=>n);if(T===void 0)return s();if(typeof T=="function"){const n=T({editor:e,selectorMenu:t,defaultTools:o,openMenu:B,closeMenu:P});return n===void 0?s():n}return s()};(()=>{h=document.createElement("div"),h.classList.add("monaco-editor-touch-selector-menu"),p=document.createElement("div"),p.classList.add("monaco-editor-touch-selector-menu","selection-adjustment");const t=(s,n,l)=>{for(const r of n){const a=document.createElement("div");if(a.classList.add("menu-item"),a.title=r.name,typeof r.innerHTML=="function"){const c=r.innerHTML();typeof c=="string"?a.innerHTML=c:a.appendChild(c),l&&ie.push({el:a,fn:r.innerHTML})}else typeof r.innerHTML=="string"?a.innerHTML=r.innerHTML:a.appendChild(r.innerHTML);const C=async()=>{try{await r.action()}catch(c){await k(r.name,c)}};a.addEventListener("touchend",C),a.addEventListener("click",C),s.appendChild(a)}};t(h,_e(h),!0),t(p,le.values(),!1);const o=s=>{s.addEventListener("touchstart",n=>{n.preventDefault()},{passive:!1}),s.addEventListener("touchmove",n=>{n.preventDefault()},{passive:!1}),s.addEventListener("touchend",n=>{n.preventDefault()},{passive:!1}),s.addEventListener("mousedown",n=>{n.preventDefault()})};o(h),o(p),document.addEventListener("mousedown",s=>{!F||!h||!p||h.contains(s.target)||p.contains(s.target)||(F=!1,h.classList.remove("show"),p.classList.remove("show"))}),document.documentElement.append(h,p)})(),M.addEventListener("touchstart",()=>{Le()},{passive:!0}),e.onDidBlurEditorWidget(()=>{re(),P()}),M.addEventListener("click",t=>{t.stopPropagation()}),M.addEventListener("contextmenu",t=>{if(t.preventDefault(),t.stopPropagation(),!h||!p)return;j=!0;const o=e.getSelection();if(!(o&&!o.isEmpty())){const n=e.getTargetAtClientPoint(t.clientX,t.clientY);n&&n.position&&e.setPosition(n.position)}me(t.clientX,t.clientY-10,t.clientY+10),setTimeout(()=>{j=!1},0)})};X.DefaultToolName=ce,X.editorTouchSelectionHelp=ve,Object.defineProperty(X,Symbol.toStringTag,{value:"Module"})}));

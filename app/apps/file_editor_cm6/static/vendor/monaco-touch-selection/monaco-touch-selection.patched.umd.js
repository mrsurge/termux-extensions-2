(function(I,Z){typeof exports=="object"&&typeof module<"u"?Z(exports):typeof define=="function"&&define.amd?define(["exports"],Z):(I=typeof globalThis<"u"?globalThis:I||self,Z(I["monaco-touch-selection"]={}))})(this,(function(I){"use strict";var me=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.GrowSelectionLeft="growSelectionLeft",e.GrowSelectionRight="growSelectionRight",e.ShrinkSelectionLeft="shrinkSelectionLeft",e.ShrinkSelectionRight="shrinkSelectionRight",e.Hover="hover",e.Find="find",e.Mention="mention",e.ReadOnly="readOnly",e.Undo="undo",e.Redo="redo",e.Close="close",e))(me||{});const Ce=(e,v)=>({startLineNumber:v.lineNumber,startColumn:v.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),ye=(e,v)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:v.lineNumber,endColumn:v.column}),be=(e,v,C)=>{const b=e.getScrollTop(),_=e.getScrollHeight(),B=e.getLayoutInfo().height,P=Math.max(0,_-B),j=b>0,M=b<P,A=e.getTargetAtClientPoint(v.clientX,v.clientY-C),R=e.getTargetAtClientPoint(v.clientX,v.clientY+C);if(A===null&&R!==null&&j){const E=Math.max(0,b-C);e.setScrollTop(E,0)}else if(A!==null&&R===null&&M){const E=Math.min(P,b+C);e.setScrollTop(E,0)}},Ee=(e,v,C)=>{const b=e.getScrollLeft(),_=e.getScrollWidth(),B=e.getLayoutInfo().width,P=Math.max(0,_-B),j=b>0,M=b<P,A=e.getTargetAtClientPoint(v.clientX-C,v.clientY),R=e.getTargetAtClientPoint(v.clientX+C,v.clientY);if(A===null&&R!==null&&j){const E=Math.max(0,b-C);e.setScrollLeft(E,0)}else if(A!==null&&R===null&&M){const E=Math.min(P,b+C);e.setScrollLeft(E,0)}},xe=(e,v)=>{const{tools:C,selectionSyncTimeout:b=300,toolActionErrorHandler:_=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=v??{};if(!e)throw new Error("editor not existed");const B=globalThis.monaco?.editor?.EditorOption,P=B?.fontSize??52,j=B?.lineHeight??67,M=e.getDomNode();if(!M||!(M instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const A=M.querySelector(".overflow-guard");if(!A||!(A instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const R=M.querySelector(".monaco-editor .margin");let E=0;R&&R instanceof HTMLElement&&(E=R.offsetWidth);let ee=!1,S=null,d=null,f=null;const Ne=()=>{S&&(ee||(ee=!0,S.classList.add("show")))},de=()=>{S&&ee&&(ee=!1,S.classList.remove("show"))};let V=!1,g=null,D=null,$=null,U=null,K=null,q=null,G=null,fe=0;const he=[];let F=!1,W=null;const te=()=>{const t=W;W=null,t?.(),F=!1},ge=()=>te(),pe=()=>{document.hidden&&te()};window.addEventListener("blur",ge),document.addEventListener("visibilitychange",pe);const x=()=>{if(g){for(const t of he){const n=t.fn();t.el.innerHTML=typeof n=="string"?n:"",typeof n!="string"&&t.el.appendChild(n)}V||(V=!0,g.classList.add("show"))}},N=()=>{g&&V&&(F||(V=!1,g.classList.remove("show")))},ve=(t,n,s,o)=>{if(!g)return;g.classList.toggle("touch-mode",o),x();const l=g.getBoundingClientRect(),c=l.width,y=l.height,p=window.visualViewport?.offsetLeft??document.documentElement.offsetLeft,i=window.visualViewport?.offsetTop??document.body.offsetTop,w=window.visualViewport?window.visualViewport.offsetLeft+window.visualViewport.width:document.documentElement.offsetLeft+document.body.clientWidth,u=window.visualViewport?window.visualViewport.offsetTop+window.visualViewport.height:document.body.offsetTop+document.body.clientHeight,h=p,a=i,r=w,k=u,O=(Y,z,X)=>Math.min(Math.max(Y,z),Math.max(z,X)),L=O(t-c/2,h,r-c);let H=n-y;H<a&&(H=s),H=O(H,a,k-y),g.style.transform=`translateX(${L}px) translateY(${H}px)`};let le=new ResizeObserver(()=>{de(),N();const t=e.getSelection();t&&re(t)});le.observe(M),e.onDidDispose(()=>{te(),window.removeEventListener("blur",ge),document.removeEventListener("visibilitychange",pe),G&&(document.removeEventListener("mousedown",G),G=null),le?.disconnect(),le=null,S?.remove(),d?.remove(),f?.remove(),g?.remove(),S=null,d=null,f=null,g=null,D=null,$=null,U=null,K=null,q=null});const ke=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},we=t=>{const n=e.getModel();if(!n)return t;if(t.column>1)return{lineNumber:t.lineNumber,column:t.column-1};if(t.lineNumber>1){const s=t.lineNumber-1;return{lineNumber:s,column:n.getLineMaxColumn(s)}}return t},Le=t=>{const n=e.getModel();if(!n)return t;const s=n.getLineMaxColumn(t.lineNumber);return t.column<s?{lineNumber:t.lineNumber,column:t.column+1}:t.lineNumber<n.getLineCount()?{lineNumber:t.lineNumber+1,column:1}:t},Oe=()=>{const t=e.getSelection();if(!t)return;const n=t.getStartPosition(),s=we(n);e.setSelection({startLineNumber:s.lineNumber,startColumn:s.column,endLineNumber:t.endLineNumber,endColumn:t.endColumn})},He=()=>{const t=e.getSelection();if(!t)return;const n=t.getEndPosition(),s=Le(n);e.setSelection({startLineNumber:t.startLineNumber,startColumn:t.startColumn,endLineNumber:s.lineNumber,endColumn:s.column})},Pe=()=>{const t=e.getSelection();if(!t||t.isEmpty())return;const n=Le(t.getStartPosition());e.setSelection({startLineNumber:n.lineNumber,startColumn:n.column,endLineNumber:t.endLineNumber,endColumn:t.endColumn})},Ae=()=>{const t=e.getSelection();if(!t||t.isEmpty())return;const n=we(t.getEndPosition());e.setSelection({startLineNumber:t.startLineNumber,startColumn:t.startColumn,endLineNumber:n.lineNumber,endColumn:n.column})},Re=(t,n)=>{const s=e.getTargetAtClientPoint(t,n);if(!s?.position)return null;const o=e.getModel();if(!o)return s.position;const l=s.position.lineNumber,c=o.getLineMaxColumn(l),y=e.getLayoutInfo(),p=M.getBoundingClientRect(),i=t-p.left-y.contentLeft+e.getScrollLeft();try{const w=p.left+y.contentLeft,u=w+Math.max(1,y.contentWidth)-1,h=e.getTargetAtClientPoint(w,n)?.position,a=e.getTargetAtClientPoint(u,n)?.position;if(h?.lineNumber!==l||a?.lineNumber!==l)return s.position;let r=Math.min(h.column,a.column,s.position.column),k=Math.max(h.column,a.column,s.position.column);for(r=Math.max(1,r),k=Math.min(c,k);r<k;){const X=Math.floor((r+k)/2),J=e.getOffsetForColumn(l,X);if(J<0)return s.position;J<i?r=X+1:k=X}const O=r,L=Math.max(1,O-1),H=e.getOffsetForColumn(l,O),Y=e.getOffsetForColumn(l,L);if(H<0||Y<0)return s.position;const z=Math.abs(i-Y)<=Math.abs(H-i)?L:O;return{lineNumber:l,column:z}}catch{return s.position}},_e=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await _(`copy fail: ${t}`,t),!1}},Be=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await _("cut",t),!1}},Ie=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await _("paste",t),!1}},De=()=>{e.trigger("keyboard","undo",null)},Ye=()=>{e.trigger("keyboard","redo",null)},Me="translateX(-50%) translateY(25%) rotate(45deg)",ze="translateX(-100%) rotate(90deg)",Xe="",ie=t=>{if(!d||!f)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},s={lineNumber:t.endLineNumber,column:t.endColumn},o=e.getScrollLeft(),l=e.getScrolledVisiblePosition(n),c=e.getScrolledVisiblePosition(s);if(!l||!c)return;const y=e.getTopForPosition(n.lineNumber,n.column),p=e.getTopForPosition(s.lineNumber,s.column),i=l.left+o-E,w=y,u=c.left+o-E,h=p;d.style.opacity="1",f.style.opacity="1",d.style.transform=`translateX(${i}px) translateY(${w}px)`,f.style.transform=`translateX(${u}px) translateY(${h}px)`,i===u&&w===h?(d.bottomCursor.style.transform=Me,f.bottomCursor.style.transform=Me):(d.bottomCursor.style.transform=ze,f.bottomCursor.style.transform=Xe)};let ce=0,ne;const re=t=>{if(clearTimeout(ne),!d||!f)return;const n=Date.now();if(n-ce<b){ce=n,d.style.opacity="0",f.style.opacity="0",ne=window.setTimeout(()=>{ie(t)},b);return}else ce=n,ie(t)},Se=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const s=document.createElement("div");s.classList.add("bottom-cursor"),t.appendChild(s);const o=t;return o.textCursor=n,o.bottomCursor=s,o},je=()=>{S=document.createElement("div"),S.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),d=Se(t),S.appendChild(t);const n=document.createElement("div");n.classList.add("right"),f=Se(n),S.appendChild(n);let s=e.getOption(j),o=e.getOption(P);const l=i=>{d&&(d.textCursor.style.height=`${i}px`,d.bottomCursor.style.top=`${i}px`,d.bottomCursor.style.marginTop="0"),f&&(f.textCursor.style.height=`${i}px`,f.bottomCursor.style.top=`${i}px`,f.bottomCursor.style.marginTop="0")};l(s),e.onDidChangeConfiguration(i=>{s=e.getOption(j),l(s),i.hasChanged(P)&&(o=e.getOption(P))}),A.append(S),e.onDidScrollChange(i=>{S&&(S.style.top=`-${i.scrollTop}px`,S.style.left=`-${i.scrollLeft}px`)});const c=(i,w)=>{const u=h=>{if(h&&d&&f){const a=d.getBoundingClientRect(),r=f.getBoundingClientRect(),k=Math.pow(h.clientX-(a.left+a.width/2),2)+Math.pow(h.clientY-(a.top+a.height/2),2),O=Math.pow(h.clientX-(r.left+r.width/2),2)+Math.pow(h.clientY-(r.top+r.height/2),2),L=k<=O?a:r;ve(L.left+L.width/2,L.top,L.bottom+s,!0)}};i.addEventListener("touchstart",h=>{const a=e.getSelection();if(!a)return;let r=h.changedTouches[0]??h.touches[0];if(!r)return;te(),F=!0,clearTimeout(ne),ne=void 0,d&&(d.style.opacity="0"),f&&(f.style.opacity="0");const k=a.isEmpty();let O=0;try{const m=i.classList.contains("left")?{lineNumber:a.startLineNumber,column:a.startColumn}:{lineNumber:a.endLineNumber,column:a.endColumn},T=e.getScrolledVisiblePosition(m);T&&(O=M.getBoundingClientRect().top+T.top+T.height/2-r.clientY)}catch{}let L=null,H=!1;const Y=()=>{const m=Re(r.clientX,r.clientY+O-s*1.5);if(m)if(k){const T=e.getPosition();if(T?.lineNumber===m.lineNumber&&T.column===m.column)return;e.setPosition(m)}else{const T=w(a,m),Q=e.getSelection();if(Q?.startLineNumber===T.startLineNumber&&Q.startColumn===T.startColumn&&Q.endLineNumber===T.endLineNumber&&Q.endColumn===T.endColumn)return;e.setSelection(T)}},z=()=>{be(e,r,s),Ee(e,r,o),Y()},X=()=>{L===null&&(z(),L=setInterval(z,50))},J=m=>{m.preventDefault(),r=m.changedTouches[0]??m.touches[0]??r,H=!0,X()};let Te=!1;const ue=()=>{if(Te)return;Te=!0,L!==null&&clearInterval(L),L=null,document.removeEventListener("touchmove",J),document.removeEventListener("touchend",se),document.removeEventListener("touchcancel",se),W===ue&&(W=null);const m=e.getSelection();m&&ie(m)},se=m=>{m.type!=="touchcancel"&&m.preventDefault(),r=m.changedTouches[0]??m.touches[0]??r,H&&Y(),ue();const T=e.getSelection();m.type!=="touchcancel"&&D&&T!==null&&u(r),setTimeout(()=>{F=!1},0)};W=ue,document.addEventListener("touchmove",J,{passive:!1}),document.addEventListener("touchend",se),document.addEventListener("touchcancel",se)},{passive:!0})};c(d,Ce),c(f,ye);const y=i=>{let w=0;i.addEventListener("touchstart",()=>{w=Date.now()},{passive:!0}),i.addEventListener("touchend",()=>{if(Date.now()-w>1e3)return;const u=e.getSelection();if(!u||u?.startColumn!==u.endColumn||u.startLineNumber!==u.endLineNumber)return;const h=e.getModel();if(!h)return;const a=h.getWordAtPosition(u.getStartPosition());a&&(e.setSelection({startLineNumber:u.startLineNumber,startColumn:a.startColumn,endLineNumber:u.endLineNumber,endColumn:a.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};y(d.textCursor),y(f.textCursor);const p=e.getSelection();p&&re(p)};e.onDidChangeCursorSelection(t=>{N(),!W&&setTimeout(()=>{re(t.selection)},0)}),je();const oe=new Map([["shrinkSelectionLeft",{name:"shrink selection from left",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 7 8 l 4 4 l -4 4 M 3 12 h 8"/>
</svg>`,action:()=>{Pe(),x()}}],["shrinkSelectionRight",{name:"shrink selection from right",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 22 6 v 12 M 17 8 l -4 4 l 4 4 M 13 12 h 8"/>
</svg>`,action:()=>{Ae(),x()}}]]),ae=new Map([["growSelectionLeft",{name:"grow selection left",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 7 16 l -4 -4 l 4 -4 M 5 12 h 7"/>
</svg>`,action:()=>{Oe(),x()}}],["growSelectionRight",{name:"grow selection right",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 22 6 v 12 M 17 16 l 4 -4 l -4 -4 M 12 12 h 7"/>
</svg>`,action:()=>{He(),x()}}]]),Ve=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await _e()&&N()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await Be()&&N()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await Ie()&&N()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{De(),x()}}],["redo",{name:"redo",innerHTML:`
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
</svg>`,action:()=>{Ye(),x()}}],["selectWord",{name:"select",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M5 3h2m4 0h2m4 0h2M3 7v2m18-2v2M3 13v2m18-2v2M5 21h2m4 0h2m4 0h2"/>
</svg>`,action:()=>{const o=e.getSelection();if(!o)return;const l=e.getModel();if(!l)return;const c=l.getWordAtPosition(o.getStartPosition());c&&(e.setSelection({startLineNumber:o.startLineNumber,startColumn:c.startColumn,endLineNumber:o.endLineNumber,endColumn:c.endColumn}),setTimeout(()=>{e.focus()})),x()}}],["selectAll",{name:"select all",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 17 16 l 4 -4 l -4 -4 M 7 16 l -4 -4 l 4 -4 M 22 6 v 12 M 5 12 h 14"/>
</svg>`,action:()=>{ke(),x()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{N();const o=e.getSelection();if(o&&o.getStartPosition)try{e.setPosition(o.getStartPosition())}catch{}const l=e.getAction("editor.action.showHover");return l?l.run():e.trigger("touch","editor.action.showHover",null),!0}}],["find",{name:"find",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🔎</span>',action:()=>{N();const o=e.getAction("actions.find");o&&o.run?o.run():e.trigger("touch-menu","actions.find",null)}}],["readOnly",{name:"read only",innerHTML:()=>`<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 100 100" style="fill: ${e.getOption(B?.readOnly??89)?"#4fc3f7":"currentColor"}; stroke: none;"><path d="M84.4,24.3H38l7,7h39.4c0.8,0,1.5,0.7,1.5,1.5v38.5c0,0.2-0.1,0.5-0.2,0.7l5,5c1.4-1.5,2.2-3.5,2.2-5.6V32.8C92.9,28.2,89.1,24.3,84.4,24.3z"/><path d="M66.9,53.3c0,1.9,1.6,3.5,3.5,3.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4C68.5,49.8,66.9,51.3,66.9,53.3z"/><path d="M34.2,53.3c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4C32.7,56.8,34.2,55.2,34.2,53.3z"/><path d="M60.4,45.5c1.9,0,3.5-1.6,3.5-3.5s-1.6-3.5-3.5-3.5H56c-1.1,0-2,0.5-2.6,1.2l5.8,5.8H60.4z"/><path d="M74.8,45.5c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5H74.8z"/><path d="M26.3,45.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5C22.8,43.9,24.4,45.5,26.3,45.5z"/><path d="M85.2,81.3l-8.4-8.4L70.8,67l0,0c0,0,0,0,0,0l-5.6-5.6l-4.6-4.6l0,0l-6.4-6.4l-6-6v0L23.3,19.5v0l-1.8-1.8c-1.4-1.4-3.6-1.4-4.9,0c-1.4,1.4-1.4,3.6,0,4.9l1.7,1.7h-1.5c-4.7,0-8.5,3.8-8.5,8.5v38.5c0,4.7,3.8,8.5,8.5,8.5h57l6.4,6.4c0.7,0.7,1.6,1,2.5,1c0.9,0,1.8-0.3,2.5-1c1.2-1.2,1.3-3,0.5-4.4C85.5,81.7,85.3,81.5,85.2,81.3z M16.8,72.8c-0.8,0-1.5-0.7-1.5-1.5V32.8c0-0.8,0.7-1.5,1.5-1.5h8.5l18.4,18.4l0,0h-2.6c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4c1.4,0,2.6-0.8,3.2-2l6.6,6.6H33.1c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5h29.3l4.5,4.5H16.8z"/></svg>`,action:()=>{const o=e.getOption(B?.readOnly??89);if(e.updateOptions({readOnly:!o}),o)try{const l=e.getDomNode(),c=l?.querySelector("textarea.inputarea")??l?.querySelector("textarea");c&&c.blur()}catch{}x()}}],["mention",{name:"mention",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">💬</span>',action:()=>{N();try{const o=e.getDomNode();o&&o.dispatchEvent(new CustomEvent("te2:mention-request",{bubbles:!1}))}catch{}return!0}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(N(),!0)}]]);for(const[o,l]of ae)n.set(o,l);for(const[o,l]of oe)n.set(o,l);const s=()=>Array.from(n).filter(([o])=>!ae.has(o)&&!oe.has(o)).map(([,o])=>o);if(C===void 0)return s();if(typeof C=="function"){const o=C({editor:e,selectorMenu:t,defaultTools:n,openMenu:x,closeMenu:N});return o===void 0?s():o}return s()};(()=>{g=document.createElement("div"),g.classList.add("monaco-editor-touch-selector-menu-stack"),D=document.createElement("div"),D.classList.add("monaco-editor-touch-selector-menu","main-menu"),$=document.createElement("div"),$.classList.add("selection-adjustment-row"),K=document.createElement("div"),K.classList.add("monaco-editor-touch-selector-menu","selection-shrink-left"),U=document.createElement("div"),U.classList.add("monaco-editor-touch-selector-menu","selection-adjustment"),q=document.createElement("div"),q.classList.add("monaco-editor-touch-selector-menu","selection-shrink-right"),$.append(K,U,q),g.append($,D);const t=(l,c,y)=>{for(const p of c){const i=document.createElement("div");if(i.classList.add("menu-item"),i.title=p.name,typeof p.innerHTML=="function"){const u=p.innerHTML();typeof u=="string"?i.innerHTML=u:i.appendChild(u),y&&he.push({el:i,fn:p.innerHTML})}else typeof p.innerHTML=="string"?i.innerHTML=p.innerHTML:i.appendChild(p.innerHTML);const w=async()=>{try{await p.action()}catch(u){await _(p.name,u)}};i.addEventListener("touchend",w),i.addEventListener("click",w),l.appendChild(i)}};t(D,Ve(D),!0),t(U,ae.values(),!1);const n=oe.get("shrinkSelectionLeft"),s=oe.get("shrinkSelectionRight");n&&t(K,[n],!1),s&&t(q,[s],!1),(l=>{l.addEventListener("touchstart",c=>{c.preventDefault()},{passive:!1}),l.addEventListener("touchmove",c=>{c.preventDefault()},{passive:!1}),l.addEventListener("touchend",c=>{c.preventDefault()},{passive:!1}),l.addEventListener("mousedown",c=>{c.preventDefault()})})(g),G=l=>{!V||!g||g.contains(l.target)||(V=!1,g.classList.remove("show"))},document.addEventListener("mousedown",G),document.documentElement.append(g)})(),M.addEventListener("touchstart",()=>{fe=Date.now(),Ne()},{passive:!0}),e.onDidBlurEditorWidget(()=>{de(),N()}),M.addEventListener("click",t=>{t.stopPropagation()}),M.addEventListener("contextmenu",t=>{if(t.preventDefault(),t.stopPropagation(),!g)return;F=!0;const n=e.getSelection();if(!(n&&!n.isEmpty())){const c=e.getTargetAtClientPoint(t.clientX,t.clientY);c&&c.position&&e.setPosition(c.position)}const l=t.sourceCapabilities?.firesTouchEvents===!0||Date.now()-fe<=2e3;ve(t.clientX,t.clientY-10,t.clientY+10,l),setTimeout(()=>{F=!1},0)})};I.DefaultToolName=me,I.editorTouchSelectionHelp=xe,Object.defineProperty(I,Symbol.toStringTag,{value:"Module"})}));

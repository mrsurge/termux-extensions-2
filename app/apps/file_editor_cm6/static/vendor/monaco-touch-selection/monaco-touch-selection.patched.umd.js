(function(I,G){typeof exports=="object"&&typeof module<"u"?G(exports):typeof define=="function"&&define.amd?define(["exports"],G):(I=typeof globalThis<"u"?globalThis:I||self,G(I["monaco-touch-selection"]={}))})(this,(function(I){"use strict";var re=(e=>(e.Copy="copy",e.Cut="cut",e.Paste="paste",e.SelectWord="selectWord",e.SelectAll="selectAll",e.GrowSelectionLeft="growSelectionLeft",e.GrowSelectionRight="growSelectionRight",e.ShrinkSelectionLeft="shrinkSelectionLeft",e.ShrinkSelectionRight="shrinkSelectionRight",e.Hover="hover",e.Find="find",e.Mention="mention",e.ReadOnly="readOnly",e.Undo="undo",e.Redo="redo",e.Close="close",e))(re||{});const Me=(e,v)=>({startLineNumber:v.lineNumber,startColumn:v.column,endLineNumber:e.endLineNumber,endColumn:e.endColumn}),Se=(e,v)=>({startLineNumber:e.startLineNumber,startColumn:e.startColumn,endLineNumber:v.lineNumber,endColumn:v.column}),Te=(e,v,C)=>{const b=e.getScrollTop(),R=e.getScrollHeight(),B=e.getLayoutInfo().height,P=Math.max(0,R-B),F=b>0,M=b<P,A=e.getTargetAtClientPoint(v.clientX,v.clientY-C),_=e.getTargetAtClientPoint(v.clientX,v.clientY+C);if(A===null&&_!==null&&F){const E=Math.max(0,b-C);e.setScrollTop(E,0)}else if(A!==null&&_===null&&M){const E=Math.min(P,b+C);e.setScrollTop(E,0)}},Ce=(e,v,C)=>{const b=e.getScrollLeft(),R=e.getScrollWidth(),B=e.getLayoutInfo().width,P=Math.max(0,R-B),F=b>0,M=b<P,A=e.getTargetAtClientPoint(v.clientX-C,v.clientY),_=e.getTargetAtClientPoint(v.clientX+C,v.clientY);if(A===null&&_!==null&&F){const E=Math.max(0,b-C);e.setScrollLeft(E,0)}else if(A!==null&&_===null&&M){const E=Math.min(P,b+C);e.setScrollLeft(E,0)}},ye=(e,v)=>{const{tools:C,selectionSyncTimeout:b=300,toolActionErrorHandler:R=(t,n)=>{console.error(`tool ${t} cause error: `,n)}}=v??{};if(!e)throw new Error("editor not existed");const B=globalThis.monaco?.editor?.EditorOption,P=B?.fontSize??52,F=B?.lineHeight??67,M=e.getDomNode();if(!M||!(M instanceof HTMLElement))throw new Error("editor container element not existed or it is not a HTMLElement");const A=M.querySelector(".overflow-guard");if(!A||!(A instanceof HTMLElement))throw new Error("no overlay guard or it is not a HTMLElement");const _=M.querySelector(".monaco-editor .margin");let E=0;_&&_ instanceof HTMLElement&&(E=_.offsetWidth);let J=!1,S=null,d=null,f=null;const be=()=>{S&&(J||(J=!0,S.classList.add("show")))},ae=()=>{S&&J&&(J=!1,S.classList.remove("show"))};let j=!1,g=null,D=null,Y=null,U=null,ue=0;const me=[];let W=!1,$=null;const Q=()=>{const t=$;$=null,t?.(),W=!1},de=()=>Q(),fe=()=>{document.hidden&&Q()};window.addEventListener("blur",de),document.addEventListener("visibilitychange",fe);const x=()=>{if(g){for(const t of me){const n=t.fn();t.el.innerHTML=typeof n=="string"?n:"",typeof n!="string"&&t.el.appendChild(n)}j||(j=!0,g.classList.add("show"))}},N=()=>{g&&j&&(W||(j=!1,g.classList.remove("show")))},he=(t,n,s,o)=>{if(!g)return;g.classList.toggle("touch-mode",o),x();const l=g.getBoundingClientRect(),c=l.width,y=l.height,p=window.visualViewport?.offsetLeft??document.documentElement.offsetLeft,i=window.visualViewport?.offsetTop??document.body.offsetTop,w=window.visualViewport?window.visualViewport.offsetLeft+window.visualViewport.width:document.documentElement.offsetLeft+document.body.clientWidth,u=window.visualViewport?window.visualViewport.offsetTop+window.visualViewport.height:document.body.offsetTop+document.body.clientHeight,h=p,a=i,r=w,O=u,k=(z,X,V)=>Math.min(Math.max(z,X),Math.max(X,V)),L=k(t-c/2,h,r-c);let H=n-y;H<a&&(H=s),H=k(H,a,O-y),g.style.transform=`translateX(${L}px) translateY(${H}px)`};let ne=new ResizeObserver(()=>{ae(),N();const t=e.getSelection();t&&le(t)});ne.observe(M),e.onDidDispose(()=>{Q(),window.removeEventListener("blur",de),document.removeEventListener("visibilitychange",fe),U&&(document.removeEventListener("mousedown",U),U=null),ne?.disconnect(),ne=null,S?.remove(),d?.remove(),f?.remove(),g?.remove(),S=null,d=null,f=null,g=null,D=null,Y=null});const Ee=()=>{e.focus();const t=e.getModel();if(t){const n=t.getFullModelRange();e.setSelection(n)}},ge=t=>{const n=e.getModel();if(!n)return t;if(t.column>1)return{lineNumber:t.lineNumber,column:t.column-1};if(t.lineNumber>1){const s=t.lineNumber-1;return{lineNumber:s,column:n.getLineMaxColumn(s)}}return t},pe=t=>{const n=e.getModel();if(!n)return t;const s=n.getLineMaxColumn(t.lineNumber);return t.column<s?{lineNumber:t.lineNumber,column:t.column+1}:t.lineNumber<n.getLineCount()?{lineNumber:t.lineNumber+1,column:1}:t},xe=()=>{const t=e.getSelection();if(!t)return;const n=t.getStartPosition(),s=ge(n);e.setSelection({startLineNumber:s.lineNumber,startColumn:s.column,endLineNumber:t.endLineNumber,endColumn:t.endColumn})},Ne=()=>{const t=e.getSelection();if(!t)return;const n=t.getEndPosition(),s=pe(n);e.setSelection({startLineNumber:t.startLineNumber,startColumn:t.startColumn,endLineNumber:s.lineNumber,endColumn:s.column})},Oe=()=>{const t=e.getSelection();if(!t||t.isEmpty())return;const n=pe(t.getStartPosition());e.setSelection({startLineNumber:n.lineNumber,startColumn:n.column,endLineNumber:t.endLineNumber,endColumn:t.endColumn})},ke=()=>{const t=e.getSelection();if(!t||t.isEmpty())return;const n=ge(t.getEndPosition());e.setSelection({startLineNumber:t.startLineNumber,startColumn:t.startColumn,endLineNumber:n.lineNumber,endColumn:n.column})},He=(t,n)=>{const s=e.getTargetAtClientPoint(t,n);if(!s?.position)return null;const o=e.getModel();if(!o)return s.position;const l=s.position.lineNumber,c=o.getLineMaxColumn(l),y=e.getLayoutInfo(),p=M.getBoundingClientRect(),i=t-p.left-y.contentLeft+e.getScrollLeft();try{const w=p.left+y.contentLeft,u=w+Math.max(1,y.contentWidth)-1,h=e.getTargetAtClientPoint(w,n)?.position,a=e.getTargetAtClientPoint(u,n)?.position;if(h?.lineNumber!==l||a?.lineNumber!==l)return s.position;let r=Math.min(h.column,a.column,s.position.column),O=Math.max(h.column,a.column,s.position.column);for(r=Math.max(1,r),O=Math.min(c,O);r<O;){const V=Math.floor((r+O)/2),K=e.getOffsetForColumn(l,V);if(K<0)return s.position;K<i?r=V+1:O=V}const k=r,L=Math.max(1,k-1),H=e.getOffsetForColumn(l,k),z=e.getOffsetForColumn(l,L);if(H<0||z<0)return s.position;const X=Math.abs(i-z)<=Math.abs(H-i)?L:k;return{lineNumber:l,column:X}}catch{return s.position}},Pe=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),!0):!1}catch(t){return await R(`copy fail: ${t}`,t),!1}},Ae=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=e.getModel()?.getValueInRange(t);return n?(await navigator.clipboard.writeText(n),e.executeEdits("cut",[{range:t,text:""}]),!0):!1}catch(t){return await R("cut",t),!1}},_e=async()=>{try{const t=e.getSelection();if(!t)return!1;const n=await navigator.clipboard.readText();return n.length===0?!1:(e.executeEdits("paste",[{range:t,text:n}]),!0)}catch(t){return await R("paste",t),!1}},Re=()=>{e.trigger("keyboard","undo",null)},Be=()=>{e.trigger("keyboard","redo",null)},ve="translateX(-50%) translateY(25%) rotate(45deg)",Ie="translateX(-100%) rotate(90deg)",De="",oe=t=>{if(!d||!f)return;const n={lineNumber:t.startLineNumber,column:t.startColumn},s={lineNumber:t.endLineNumber,column:t.endColumn},o=e.getScrollLeft(),l=e.getScrolledVisiblePosition(n),c=e.getScrolledVisiblePosition(s);if(!l||!c)return;const y=e.getTopForPosition(n.lineNumber,n.column),p=e.getTopForPosition(s.lineNumber,s.column),i=l.left+o-E,w=y,u=c.left+o-E,h=p;d.style.opacity="1",f.style.opacity="1",d.style.transform=`translateX(${i}px) translateY(${w}px)`,f.style.transform=`translateX(${u}px) translateY(${h}px)`,i===u&&w===h?(d.bottomCursor.style.transform=ve,f.bottomCursor.style.transform=ve):(d.bottomCursor.style.transform=Ie,f.bottomCursor.style.transform=De)};let se=0,Z;const le=t=>{if(clearTimeout(Z),!d||!f)return;const n=Date.now();if(n-se<b){se=n,d.style.opacity="0",f.style.opacity="0",Z=window.setTimeout(()=>{oe(t)},b);return}else se=n,oe(t)},we=t=>{t.classList.add("selector");const n=document.createElement("div");n.classList.add("text-cursor"),t.appendChild(n);const s=document.createElement("div");s.classList.add("bottom-cursor"),t.appendChild(s);const o=t;return o.textCursor=n,o.bottomCursor=s,o},Ye=()=>{S=document.createElement("div"),S.classList.add("monaco-editor-touch-selections");const t=document.createElement("div");t.classList.add("left"),d=we(t),S.appendChild(t);const n=document.createElement("div");n.classList.add("right"),f=we(n),S.appendChild(n);let s=e.getOption(F),o=e.getOption(P);const l=i=>{d&&(d.textCursor.style.height=`${i}px`,d.bottomCursor.style.top=`${i}px`,d.bottomCursor.style.marginTop="0"),f&&(f.textCursor.style.height=`${i}px`,f.bottomCursor.style.top=`${i}px`,f.bottomCursor.style.marginTop="0")};l(s),e.onDidChangeConfiguration(i=>{s=e.getOption(F),l(s),i.hasChanged(P)&&(o=e.getOption(P))}),A.append(S),e.onDidScrollChange(i=>{S&&(S.style.top=`-${i.scrollTop}px`,S.style.left=`-${i.scrollLeft}px`)});const c=(i,w)=>{const u=h=>{if(h&&d&&f){const a=d.getBoundingClientRect(),r=f.getBoundingClientRect(),O=Math.pow(h.clientX-(a.left+a.width/2),2)+Math.pow(h.clientY-(a.top+a.height/2),2),k=Math.pow(h.clientX-(r.left+r.width/2),2)+Math.pow(h.clientY-(r.top+r.height/2),2),L=O<=k?a:r;he(L.left+L.width/2,L.top,L.bottom+s,!0)}};i.addEventListener("touchstart",h=>{const a=e.getSelection();if(!a)return;let r=h.changedTouches[0]??h.touches[0];if(!r)return;Q(),W=!0,clearTimeout(Z),Z=void 0,d&&(d.style.opacity="0"),f&&(f.style.opacity="0");const O=a.isEmpty();let k=0;try{const m=i.classList.contains("left")?{lineNumber:a.startLineNumber,column:a.startColumn}:{lineNumber:a.endLineNumber,column:a.endColumn},T=e.getScrolledVisiblePosition(m);T&&(k=M.getBoundingClientRect().top+T.top+T.height/2-r.clientY)}catch{}let L=null,H=!1;const z=()=>{const m=He(r.clientX,r.clientY+k-s*1.5);if(m)if(O){const T=e.getPosition();if(T?.lineNumber===m.lineNumber&&T.column===m.column)return;e.setPosition(m)}else{const T=w(a,m),q=e.getSelection();if(q?.startLineNumber===T.startLineNumber&&q.startColumn===T.startColumn&&q.endLineNumber===T.endLineNumber&&q.endColumn===T.endColumn)return;e.setSelection(T)}},X=()=>{Te(e,r,s),Ce(e,r,o),z()},V=()=>{L===null&&(X(),L=setInterval(X,50))},K=m=>{m.preventDefault(),r=m.changedTouches[0]??m.touches[0]??r,H=!0,V()};let Le=!1;const ce=()=>{if(Le)return;Le=!0,L!==null&&clearInterval(L),L=null,document.removeEventListener("touchmove",K),document.removeEventListener("touchend",te),document.removeEventListener("touchcancel",te),$===ce&&($=null);const m=e.getSelection();m&&oe(m)},te=m=>{m.type!=="touchcancel"&&m.preventDefault(),r=m.changedTouches[0]??m.touches[0]??r,H&&z(),ce();const T=e.getSelection();m.type!=="touchcancel"&&D&&T!==null&&u(r),setTimeout(()=>{W=!1},0)};$=ce,document.addEventListener("touchmove",K,{passive:!1}),document.addEventListener("touchend",te),document.addEventListener("touchcancel",te)},{passive:!0})};c(d,Me),c(f,Se);const y=i=>{let w=0;i.addEventListener("touchstart",()=>{w=Date.now()},{passive:!0}),i.addEventListener("touchend",()=>{if(Date.now()-w>1e3)return;const u=e.getSelection();if(!u||u?.startColumn!==u.endColumn||u.startLineNumber!==u.endLineNumber)return;const h=e.getModel();if(!h)return;const a=h.getWordAtPosition(u.getStartPosition());a&&(e.setSelection({startLineNumber:u.startLineNumber,startColumn:a.startColumn,endLineNumber:u.endLineNumber,endColumn:a.endColumn}),setTimeout(()=>{e.focus()}))},{passive:!0})};y(d.textCursor),y(f.textCursor);const p=e.getSelection();p&&le(p)};e.onDidChangeCursorSelection(t=>{N(),!$&&setTimeout(()=>{le(t.selection)},0)}),Ye();const ee=new Map([["shrinkSelectionLeft",{name:"shrink selection from left",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 7 8 l 4 4 l -4 4 M 3 12 h 8"/>
</svg>`,action:()=>{Oe(),x()}}],["shrinkSelectionRight",{name:"shrink selection from right",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 22 6 v 12 M 17 8 l -4 4 l 4 4 M 13 12 h 8"/>
</svg>`,action:()=>{ke(),x()}}]]),ie=new Map([["growSelectionLeft",{name:"grow selection left",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 2 6 v 12 M 7 16 l -4 -4 l 4 -4 M 5 12 h 7"/>
</svg>`,action:()=>{xe(),x()}}],["growSelectionRight",{name:"grow selection right",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 22 6 v 12 M 17 16 l 4 -4 l -4 -4 M 12 12 h 7"/>
</svg>`,action:()=>{Ne(),x()}}]]),ze=t=>{const n=new Map([["copy",{name:"copy",innerHTML:`
<svg
    xmlns="http://www.w3.org/2000/svg"
    class="icon"
    viewBox="0 0 24 24"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="fill: none;"
>
    <path d="M 5 8 m 0 2 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2 z M 9 6 a 2 2 0 0 1 2 -2 h 8 a 2 2 0 0 1 2 2 v 8 a 2 2 0 0 1 -2 2"/>
</svg>`,action:async()=>{await Pe()&&N()}}],["cut",{name:"cut",innerHTML:`
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
</svg>`,action:async()=>{await Ae()&&N()}}],["paste",{name:"paste",innerHTML:`
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
</svg>`,action:async()=>{await _e()&&N()}}],["undo",{name:"undo",innerHTML:`
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
</svg>`,action:()=>{Re(),x()}}],["redo",{name:"redo",innerHTML:`
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
</svg>`,action:()=>{Be(),x()}}],["selectWord",{name:"select",innerHTML:`
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
</svg>`,action:()=>{Ee(),x()}}],["hover",{name:"hover",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🚁</span>',action:()=>{N();const o=e.getSelection();if(o&&o.getStartPosition)try{e.setPosition(o.getStartPosition())}catch{}const l=e.getAction("editor.action.showHover");return l?l.run():e.trigger("touch","editor.action.showHover",null),!0}}],["find",{name:"find",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">🔎</span>',action:()=>{N();const o=e.getAction("actions.find");o&&o.run?o.run():e.trigger("touch-menu","actions.find",null)}}],["readOnly",{name:"read only",innerHTML:()=>`<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 100 100" style="fill: ${e.getOption(B?.readOnly??89)?"#4fc3f7":"currentColor"}; stroke: none;"><path d="M84.4,24.3H38l7,7h39.4c0.8,0,1.5,0.7,1.5,1.5v38.5c0,0.2-0.1,0.5-0.2,0.7l5,5c1.4-1.5,2.2-3.5,2.2-5.6V32.8C92.9,28.2,89.1,24.3,84.4,24.3z"/><path d="M66.9,53.3c0,1.9,1.6,3.5,3.5,3.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4C68.5,49.8,66.9,51.3,66.9,53.3z"/><path d="M34.2,53.3c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4C32.7,56.8,34.2,55.2,34.2,53.3z"/><path d="M60.4,45.5c1.9,0,3.5-1.6,3.5-3.5s-1.6-3.5-3.5-3.5H56c-1.1,0-2,0.5-2.6,1.2l5.8,5.8H60.4z"/><path d="M74.8,45.5c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5H74.8z"/><path d="M26.3,45.5h4.4c1.9,0,3.5-1.6,3.5-3.5c0-1.9-1.6-3.5-3.5-3.5h-4.4c-1.9,0-3.5,1.6-3.5,3.5C22.8,43.9,24.4,45.5,26.3,45.5z"/><path d="M85.2,81.3l-8.4-8.4L70.8,67l0,0c0,0,0,0,0,0l-5.6-5.6l-4.6-4.6l0,0l-6.4-6.4l-6-6v0L23.3,19.5v0l-1.8-1.8c-1.4-1.4-3.6-1.4-4.9,0c-1.4,1.4-1.4,3.6,0,4.9l1.7,1.7h-1.5c-4.7,0-8.5,3.8-8.5,8.5v38.5c0,4.7,3.8,8.5,8.5,8.5h57l6.4,6.4c0.7,0.7,1.6,1,2.5,1c0.9,0,1.8-0.3,2.5-1c1.2-1.2,1.3-3,0.5-4.4C85.5,81.7,85.3,81.5,85.2,81.3z M16.8,72.8c-0.8,0-1.5-0.7-1.5-1.5V32.8c0-0.8,0.7-1.5,1.5-1.5h8.5l18.4,18.4l0,0h-2.6c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5h4.4c1.4,0,2.6-0.8,3.2-2l6.6,6.6H33.1c-1.9,0-3.5,1.6-3.5,3.5c0,1.9,1.6,3.5,3.5,3.5h29.3l4.5,4.5H16.8z"/></svg>`,action:()=>{const o=e.getOption(B?.readOnly??89);if(e.updateOptions({readOnly:!o}),o)try{const l=e.getDomNode(),c=l?.querySelector("textarea.inputarea")??l?.querySelector("textarea");c&&c.blur()}catch{}x()}}],["mention",{name:"mention",innerHTML:'<span class="icon" style="font-size: 1.2em; line-height: 1;">💬</span>',action:()=>{N();try{const o=e.getDomNode();o&&o.dispatchEvent(new CustomEvent("te2:mention-request",{bubbles:!1}))}catch{}return!0}}],["close",{name:"close",innerHTML:`
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
</svg>`,action:()=>(N(),!0)}]]);for(const[o,l]of ie)n.set(o,l);for(const[o,l]of ee)n.set(o,l);const s=()=>Array.from(n).filter(([o])=>!ie.has(o)&&!ee.has(o)).map(([,o])=>o);if(C===void 0)return s();if(typeof C=="function"){const o=C({editor:e,selectorMenu:t,defaultTools:n,openMenu:x,closeMenu:N});return o===void 0?s():o}return s()};(()=>{g=document.createElement("div"),g.classList.add("monaco-editor-touch-selector-menu-stack"),D=document.createElement("div"),D.classList.add("monaco-editor-touch-selector-menu","main-menu"),Y=document.createElement("div"),Y.classList.add("monaco-editor-touch-selector-menu","selection-adjustment-row"),g.append(Y,D);const t=(l,c,y)=>{for(const p of c){const i=document.createElement("div");if(i.classList.add("menu-item"),i.title=p.name,typeof p.innerHTML=="function"){const u=p.innerHTML();typeof u=="string"?i.innerHTML=u:i.appendChild(u),y&&me.push({el:i,fn:p.innerHTML})}else typeof p.innerHTML=="string"?i.innerHTML=p.innerHTML:i.appendChild(p.innerHTML);const w=async()=>{try{await p.action()}catch(u){await R(p.name,u)}};i.addEventListener("touchend",w),i.addEventListener("click",w),l.appendChild(i)}};t(D,ze(D),!0);const n=ee.get("shrinkSelectionLeft"),s=ee.get("shrinkSelectionRight");n&&t(Y,[n],!1),t(Y,ie.values(),!1),s&&t(Y,[s],!1),(l=>{l.addEventListener("touchstart",c=>{c.preventDefault()},{passive:!1}),l.addEventListener("touchmove",c=>{c.preventDefault()},{passive:!1}),l.addEventListener("touchend",c=>{c.preventDefault()},{passive:!1}),l.addEventListener("mousedown",c=>{c.preventDefault()})})(g),U=l=>{!j||!g||g.contains(l.target)||(j=!1,g.classList.remove("show"))},document.addEventListener("mousedown",U),document.documentElement.append(g)})(),M.addEventListener("touchstart",()=>{ue=Date.now(),be()},{passive:!0}),e.onDidBlurEditorWidget(()=>{ae(),N()}),M.addEventListener("click",t=>{t.stopPropagation()}),M.addEventListener("contextmenu",t=>{if(t.preventDefault(),t.stopPropagation(),!g)return;W=!0;const n=e.getSelection();if(!(n&&!n.isEmpty())){const c=e.getTargetAtClientPoint(t.clientX,t.clientY);c&&c.position&&e.setPosition(c.position)}const l=t.sourceCapabilities?.firesTouchEvents===!0||Date.now()-ue<=2e3;he(t.clientX,t.clientY-10,t.clientY+10,l),setTimeout(()=>{W=!1},0)})};I.DefaultToolName=re,I.editorTouchSelectionHelp=ye,Object.defineProperty(I,Symbol.toStringTag,{value:"Module"})}));

import { createModalFrame } from '../../code_te2/main_page/frontend/ui/modal-kit/modal-frame';
import { installProfilePaneLayout, profileMinibar } from '../../../static/js/profile-pane-layout';

interface Profile { id:string; name:string; command:string; env:Record<string,string>; cwd:string; enabled:boolean }
interface Settings {revision:number; default:string; profiles:Profile[]}
type Request = (method:string, params?:Record<string,unknown>)=>Promise<unknown>;
const system='system';
function array(v:unknown):v is unknown[]{return Array.isArray(v);}
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object' && v!==null && !array(v);}
function profile(v:unknown):v is Profile {
  return record(v) && typeof v.id==='string' && typeof v.name==='string' && typeof v.command==='string'
    && typeof v.cwd==='string' && typeof v.enabled==='boolean' && record(v.env) && Object.values(v.env).every(a=>typeof a==='string');
}
function parse(v:unknown):Settings {
  if (!record(v)||typeof v.revision!=='number'||typeof v.default!=='string'||!array(v.profiles)||!v.profiles.every(profile))
    throw new Error('Invalid terminal profile settings');
  return {revision:v.revision, default:v.default, profiles:v.profiles};
}

export function bindTerminalProfiles(root:HTMLElement, newButton:HTMLButtonElement, rpc:Request,
  launch:(id?:string)=>Promise<void>, report:(msg:string)=>void):void {
  const doc=root.ownerDocument;
  installProfilePaneLayout(doc);
  let active:HTMLElement|null=null, loading=false;
  let closeFrame:(()=>void)|null=null;
  const remove=()=>{const previous=active;active=null;if(closeFrame){const close=closeFrame;closeFrame=null;close();}else previous?.remove();};
  const button=(label:string, run:()=>void)=>{
    const b=doc.createElement('button');b.type='button';b.className='app-btn';b.textContent=label;b.onclick=run;return b;
  };
  const modal=(title:string,id:'profiles'|'profile-picker')=>{
    const surfaceId=id==='profiles'?'terminal.profiles':'terminal.profile-picker';
    const frame=createModalFrame(doc,{id:'ta-'+id,surfaceId,title,onClose:remove});
    const d=frame.root;active=d;d.classList.add('ta-profile-dialog','show');d.setAttribute('aria-hidden','false');
    closeFrame=()=>{d.classList.remove('show');d.setAttribute('aria-hidden','true');
      // Let the shared surface registry return this node from its native child.
      window.setTimeout(()=>{frame.dispose();d.remove();},0);};
    doc.body.append(d);return frame;
  };
  function manager(s:Settings){
    const frame=modal('Terminal profiles','profiles'),d=frame.root;
    d.classList.add('te-profile-manager');
    const layout=doc.createElement('div');layout.className='run-profiles-layout';
    const pane=doc.createElement('div');pane.className='run-profiles-list';
    const tools=doc.createElement('div'),list=doc.createElement('div');list.className='run-profiles-list-items';
    pane.append(tools,list);const caption=profileMinibar(pane);
    const form=doc.createElement('form');
    form.className='run-profiles-editor';
    form.innerHTML=`<div class="ta-profile-fields">
      <label>Name<input data-name maxlength="120"></label>
      <label>Command<textarea data-command autocapitalize="off" rows="1" placeholder="bash --rcfile .venv/bin/activate -i"></textarea></label>
      <label>Starting directory (optional)<input data-cwd autocapitalize="off" placeholder="Use current launch directory"></label>
      <details data-env><summary>Environment (optional)</summary><div data-rows></div></details>
      <label><span><input type="checkbox" data-enabled> Available for launch</span></label></div>
      <label><input type="checkbox" data-default> Default for New Terminal</label>
      <p data-note role="status"></p>`;
    layout.append(pane,form);frame.body.append(layout);
    const command=form.querySelector('textarea')!;
    const environment=form.querySelector<HTMLDetailsElement>('[data-env]')!;
    const rows=form.querySelector<HTMLElement>('[data-rows]')!;
    function envRow(key='',value=''){
      const row=doc.createElement('div');row.className='ta-env-row';
      const k=doc.createElement('input'),v=doc.createElement('input');
      k.setAttribute('autocapitalize','off');v.setAttribute('autocapitalize','off');
      k.placeholder='Name';k.setAttribute('aria-label','Environment variable name');k.value=key;
      v.placeholder='Value';v.setAttribute('aria-label','Environment variable value');v.value=value;
      row.append(k,v,button('Remove',()=>row.remove()));rows.append(row);return k;
    }
    environment.append(button('Add variable',()=>envRow().focus()));
    const input=(k:string)=>form.querySelector<HTMLInputElement>(`[data-${k}]`)!;
    const name=input('name'),cwd=input('cwd'),enabled=input('enabled'),def=input('default');
    const note=form.querySelector<HTMLElement>('[data-note]')!;
    let editing:Profile|undefined;
    function show(id:string){
      editing=s.profiles.find(p=>p.id===id);
      caption(editing?.name??'System default',true);
      list.replaceChildren(...[{id:system,name:'System default'},...s.profiles].map(p=>{
        const b=button(p.name,()=>{if(update())show(p.id);});
        b.className='run-profiles-list-item';b.classList.toggle('is-active',id===p.id);
        b.setAttribute('aria-pressed',String(id===p.id));return b;}));
      name.value=editing?.name??'System default';command.value=editing?.command??'';
      rows.replaceChildren();for(const [k,v] of Object.entries(editing?.env??{}))envRow(k,v);
      environment.hidden=!editing;environment.open=rows.childElementCount>0;
      cwd.value=editing?.cwd??'';enabled.checked=editing?.enabled??true;def.checked=s.default===id;
      for(const field of [name,command,cwd,enabled])field.disabled=!editing;
      def.disabled=def.checked||!enabled.checked;del.disabled=!editing;
      note.textContent=editing?'Changes apply to future shells.':'Uses the existing system shell and login behavior.';
    }
    function update(){
      const pairs=new Map<string,string>();
      for(const row of rows.children){
        const [k,v]=row.querySelectorAll('input');
        if(!k.value&&!v.value)continue;
        if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.value)||pairs.has(k.value)){
          environment.open=true;k.focus();note.textContent='Use a valid, unique environment variable name.';return false;
        }
        pairs.set(k.value,v.value);
      }
      if(editing)Object.assign(editing,{name:name.value.trim(),command:command.value,env:Object.fromEntries(pairs),cwd:cwd.value.trim(),enabled:enabled.checked});
      const id=editing?.id??system;
      if(def.checked&&enabled.checked)s.default=id;
      if(!enabled.checked&&s.default===id)s.default=system;
      return true;
    }
    enabled.onchange=()=>{def.disabled=!enabled.checked;if(!enabled.checked)def.checked=false;};
    const add=button('Add profile',()=>{if(!update())return;const id=Array.from(crypto.getRandomValues(new Uint32Array(4)),v=>v.toString(16).padStart(8,'0')).join('');
      s.profiles.push({id,name:'New profile',command:'',env:{},cwd:'',enabled:true});show(id);command.focus();});
    const del=button('Remove',()=>{if(!editing)return;s.profiles=s.profiles.filter(p=>p.id!==editing?.id);if(s.default===editing.id)s.default=system;show(system);});
    const save=button('Save',()=>form.requestSubmit());
    form.onsubmit=async e=>{e.preventDefault();if(save.disabled||!update())return;
      const invalid=s.profiles.find(p=>!p.name||!p.command.trim());if(invalid){show(invalid.id);note.textContent='Name and command are required.';return;}
      save.disabled=true;try{await rpc('profiles.save',{...s,format:'command'});if(active===d)remove();}catch(err){note.textContent=String(err);save.disabled=false;}};
    tools.append(add,del);frame.footer.append(button('Cancel',remove),save);show(system);
  }
  async function open(kind:'manage'|'pick'|'menu',point?:{x:number;y:number}){
    if(loading||active)return;loading=true;
    try{
      const s=parse(await rpc('profiles.get',{format:'command'}));
      if(kind==='manage'){manager(s);return;}
      const options=[{id:system,name:'System default'},...s.profiles.filter(p=>p.enabled)];
      const picker=kind==='pick'?modal('New terminal with profile','profile-picker'):null;
      const menu=picker?.body??doc.createElement('div');
      if(kind==='menu'){
        active=menu;menu.className='fe-dropdown ta-profile-menu';menu.popover='auto';menu.setAttribute('role','menu');
        menu.setAttribute('aria-label','New terminal with profile');root.append(menu);
        menu.addEventListener('toggle',()=>{if(active===menu&&!menu.matches(':popover-open'))remove();});
      }
      for(const opt of options){const b=button(opt.name+(picker && opt.id===s.default?' (default)':''),()=>{
        if(active!==(picker?.root??menu))return;remove();void launch(opt.id);});
        if(kind==='menu'){b.className='fe-dd-item';b.setAttribute('role','menuitemradio');
          b.dataset.checkable='true';b.classList.toggle('fe-menu-item-checked',opt.id===s.default);
          b.setAttribute('aria-checked',String(opt.id===s.default));}menu.append(b);}
      if(kind==='menu'){
        menu.showPopover();const r=newButton.getBoundingClientRect(),bounds=menu.getBoundingClientRect();
        menu.style.left=Math.max(0,Math.min(point?.x??r.left,doc.documentElement.clientWidth-bounds.width))+'px';
        menu.style.top=Math.max(0,Math.min(point?.y??r.bottom,doc.documentElement.clientHeight-bounds.height))+'px';
        menu.querySelector('button')?.focus();
        menu.onkeydown=e=>{if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;e.preventDefault();
          const items=Array.from(menu.querySelectorAll('button'));items[(items.findIndex(b=>b===doc.activeElement)+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();};
      }else{menu.classList.add('ta-profile-picker');picker?.footer.append(button('Cancel',remove));}
    }catch(err){remove();report(String(err));}finally{loading=false;}
  }
  root.querySelector('#ta-profiles')?.addEventListener('click',()=>void open('manage'));
  root.querySelector('#ta-new-with-profile')?.addEventListener('click',()=>void open('pick'));
  let timer=0,suppress=false,x=0,y=0;
  newButton.title='Start the default shell. In the minibar, hold or right-click to choose a profile.';
  newButton.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')suppress=false;});
  const cancel=()=>{window.clearTimeout(timer);timer=0;};
  newButton.addEventListener('pointerdown',e=>{cancel();suppress=false;
    if(!root.classList.contains('mode-terminal')||e.button!==0||e.pointerType==='mouse')return;
    x=e.clientX;y=e.clientY;timer=window.setTimeout(()=>{timer=0;suppress=true;void open('menu',{x,y});},480);});
  newButton.addEventListener('pointermove',e=>{if(timer&&Math.hypot(e.clientX-x,e.clientY-y)>8)cancel();});
  for(const type of ['pointerleave','pointercancel','pointerup'])newButton.addEventListener(type,cancel);
  newButton.addEventListener('contextmenu',e=>{if(!root.classList.contains('mode-terminal'))return;
    e.preventDefault();cancel();suppress=true;void open('menu',e.detail===0&&!e.clientX&&!e.clientY?undefined:{x:e.clientX,y:e.clientY});});
  newButton.addEventListener('click',e=>{if(suppress){e.preventDefault();suppress=false;return;}void launch();});
}

/** Shared presentation for profile managers. State stays in the owning app. */
export function installProfilePaneLayout(doc: Document): void {
  if (doc.getElementById('te-profile-pane-layout')) return;
  const style = doc.createElement('style');
  style.id = 'te-profile-pane-layout';
  style.textContent = `
    .te-profile-manager .fe-modal-card {height:min(680px,86dvh);min-height:0}
    .te-profile-manager .fe-modal-body {display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden!important}
    .te-profile-manager .run-profiles-layout {display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);flex:1;min-height:0;gap:12px}
    .te-profile-manager .run-profiles-list {display:flex;flex-direction:column;min-width:0;min-height:0;gap:6px}
    .te-profile-manager .run-profiles-list-items {display:flex;flex-direction:column;gap:4px;min-height:0;overflow:auto;overscroll-behavior:contain}
    .te-profile-manager .run-profiles-list-item {display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;width:100%;padding:7px 8px;border:1px solid var(--border,#333);border-radius:6px;background:rgba(255,255,255,.03);color:var(--foreground,#e5e7eb);text-align:start;overflow-wrap:anywhere;cursor:pointer}
    .te-profile-manager .run-profiles-list-item.is-active {border-color:var(--primary,#3b82f6);background:rgba(59,130,246,.16)}
    .te-profile-manager .run-profiles-editor {display:block;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain}
    .te-profile-manager .run-profiles-editor > * + * {margin-top:10px}
    .te-profile-manager .te-profile-minibar {display:none}
    @media(max-width:720px){
      .te-profile-manager .run-profiles-layout {grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
      .te-profile-manager .run-profiles-list {max-height:min(40dvh,16rem)}
      .te-profile-manager .te-profile-minibar {display:block;flex:none;text-align:start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .te-profile-manager .run-profiles-list:not([data-expanded]) > :not(.te-profile-minibar){display:none}
    }`;
  doc.head.append(style);
}

export function profileMinibar(pane: HTMLElement) {
  const toggle=pane.ownerDocument.createElement('button');
  toggle.type='button'; toggle.className='fe-btn te-profile-minibar';
  let label='Profiles';
  function update(expanded:boolean){
    pane.toggleAttribute('data-expanded',expanded);
    toggle.setAttribute('aria-expanded',String(expanded));
    toggle.textContent=(expanded?'▾ ':'▸ ')+label;
  }
  toggle.onclick=()=>update(!pane.hasAttribute('data-expanded'));
  pane.prepend(toggle);update(false);
  return (name:string,collapse=false)=>{
    label=name?'Profiles: '+name:'Profiles';
    update(!collapse&&pane.hasAttribute('data-expanded'));
  };
}

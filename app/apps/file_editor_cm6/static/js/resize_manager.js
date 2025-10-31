// resize_manager.js - Handle panel resizing with drag handles

export function initResizeManager() {
  const handles = document.querySelectorAll('.resize-handle');
  
  handles.forEach(handle => {
    let isDragging = false;
    let startPos = 0;
    let startSize = 0;
    let panel = null;
    
    const onStart = (e) => {
      const clientX = e.clientX || e.touches?.[0]?.clientX;
      const clientY = e.clientY || e.touches?.[0]?.clientY;
      
      const panelType = handle.dataset.panel;
      isDragging = true;
      panel = panelType;
      
      if (panelType === 'explorer' || panelType === 'agent') {
        startPos = clientX;
        const prop = panelType === 'explorer' ? '--explorer-width' : '--agent-width';
        const currentWidth = getComputedStyle(document.documentElement).getPropertyValue(prop);
        startSize = parseInt(currentWidth) || (panelType === 'explorer' ? 320 : 400);
      } else if (panelType === 'terminal') {
        startPos = clientY;
        const currentHeight = getComputedStyle(document.documentElement).getPropertyValue('--terminal-height');
        startSize = parseInt(currentHeight) || 340;
      }
      
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onEnd);
      e.preventDefault();
    };
    
    const onMove = (e) => {
      if (!isDragging) return;
      
      const clientX = e.clientX || e.touches?.[0]?.clientX;
      const clientY = e.clientY || e.touches?.[0]?.clientY;
      
      if (panel === 'explorer') {
        const delta = clientX - startPos;
        const newWidth = Math.max(200, Math.min(600, startSize + delta));
        document.documentElement.style.setProperty('--explorer-width', `${newWidth}px`);
      } else if (panel === 'agent') {
        const delta = startPos - clientX;
        const newWidth = Math.max(250, Math.min(700, startSize + delta));
        document.documentElement.style.setProperty('--agent-width', `${newWidth}px`);
      } else if (panel === 'terminal') {
        const delta = startPos - clientY;
        const newHeight = Math.max(150, Math.min(800, startSize + delta));
        document.documentElement.style.setProperty('--terminal-height', `${newHeight}px`);
      }
      
      // Trigger resize for CodeMirror
      window.dispatchEvent(new Event('resize'));
      e.preventDefault();
    };
    
    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      
      saveLayoutPreferences();
    };
    
    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart);
  });
}

function saveLayoutPreferences() {
  const prefs = {
    explorerWidth: getComputedStyle(document.documentElement).getPropertyValue('--explorer-width').trim(),
    agentWidth: getComputedStyle(document.documentElement).getPropertyValue('--agent-width').trim(),
    terminalHeight: getComputedStyle(document.documentElement).getPropertyValue('--terminal-height').trim()
  };
  
  localStorage.setItem('code_cm6_layout_prefs', JSON.stringify(prefs));
}

export function loadLayoutPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('code_cm6_layout_prefs') || '{}');
    
    if (prefs.explorerWidth) {
      document.documentElement.style.setProperty('--explorer-width', prefs.explorerWidth);
    }
    if (prefs.agentWidth) {
      document.documentElement.style.setProperty('--agent-width', prefs.agentWidth);
    }
    if (prefs.terminalHeight) {
      document.documentElement.style.setProperty('--terminal-height', prefs.terminalHeight);
    }
  } catch (e) {
    console.warn('Failed to load layout preferences:', e);
  }
}

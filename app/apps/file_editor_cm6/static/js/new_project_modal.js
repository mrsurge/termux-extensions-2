
const STYLE_ID = 'fe-new-project-style';

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .fe-modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px);
            display: flex; align-items: center; justify-content: center;
            z-index: 5000;
        }
        .fe-modal-box {
            background: var(--card, #181818); border: 1px solid var(--border, #333);
            border-radius: 12px; width: 420px; max-width: 92vw;
            display: flex; flex-direction: column;
            color: var(--foreground, #eee);
            box-shadow: 0 20px 40px rgba(0,0,0,0.6);
            font-family: system-ui, -apple-system, sans-serif;
        }
        .fe-modal-header { 
            padding: 16px 20px; font-weight: 600; font-size: 1.1rem;
            border-bottom: 1px solid var(--border, #333); 
        }
        .fe-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
        .fe-modal-footer { 
            padding: 16px 20px; display: flex; justify-content: flex-end; gap: 10px; 
            border-top: 1px solid var(--border, #333); background: rgba(255,255,255,0.02);
        }
        .fe-radio-group { display: flex; flex-direction: column; gap: 12px; }
        .fe-radio-label { 
            display: flex; align-items: center; gap: 10px; cursor: pointer; 
            padding: 10px; border-radius: 6px; border: 1px solid transparent;
            transition: background 0.2s;
        }
        .fe-radio-label:hover { background: rgba(255,255,255,0.05); }
        .fe-radio-label.checked { 
            background: rgba(80, 120, 255, 0.15); 
            border-color: var(--primary, #5078ff);
        }
        .fe-radio-input { accent-color: var(--primary, #5078ff); transform: scale(1.1); }
        .fe-modal-input-group { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; margin-left: 28px; margin-right: 4px; }
        .fe-modal-input {
            background: var(--input, #222); border: 1px solid var(--border, #444);
            padding: 10px 12px; border-radius: 6px; color: inherit; width: 100%; font-size: 0.95rem;
            box-sizing: border-box;
        }
        .fe-modal-input:focus { outline: 2px solid var(--primary, #5078ff); border-color: transparent; }
        .fe-modal-btn {
            padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border, #444);
            background: var(--secondary, #333); color: inherit; cursor: pointer; font-weight: 500;
            transition: all 0.2s;
        }
        .fe-modal-btn:hover { background: var(--hover, #444); }
        .fe-modal-btn.primary { 
            background: var(--primary, #5078ff); border-color: var(--primary, #5078ff); color: white; 
        }
        .fe-modal-btn.primary:hover { opacity: 0.9; }
        .fe-modal-hint { font-size: 0.85rem; color: var(--muted-foreground, #888); }
        .fe-hidden { display: none !important; }
    `;
    document.head.appendChild(style);
}

export function showNewProjectModal(toastFn) {
    ensureStyle();
    return new Promise((resolve, reject) => {
        const overlay = document.createElement('div');
        overlay.className = 'fe-modal-overlay';
        
        const box = document.createElement('div');
        box.className = 'fe-modal-box';
        
        box.innerHTML = `
            <div class="fe-modal-header">New Project</div>
            <div class="fe-modal-body">
                <div class="fe-radio-group">
                    <label class="fe-radio-label checked">
                        <input type="radio" name="proj_type" value="local" checked class="fe-radio-input">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:500">Local Project</span>
                            <span class="fe-modal-hint">Create a new empty folder</span>
                        </div>
                    </label>
                    <label class="fe-radio-label">
                        <input type="radio" name="proj_type" value="clone" class="fe-radio-input">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:500">Clone Repository</span>
                            <span class="fe-modal-hint">Clone from a Git URL</span>
                        </div>
                    </label>
                </div>
                <div id="fe-clone-opts" class="fe-modal-input-group fe-hidden">
                    <input type="text" id="fe-git-url" class="fe-modal-input" placeholder="https://github.com/user/repo.git">
                </div>
            </div>
            <div class="fe-modal-footer">
                <button class="fe-modal-btn" id="fe-modal-cancel">Cancel</button>
                <button class="fe-modal-btn primary" id="fe-modal-continue">Continue</button>
            </div>
        `;
        
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        
        const radios = box.querySelectorAll('input[name="proj_type"]');
        const cloneOpts = box.querySelector('#fe-clone-opts');
        const urlInput = box.querySelector('#fe-git-url');
        
        radios.forEach(r => {
            r.addEventListener('change', () => {
                radios.forEach(rb => rb.parentElement.classList.toggle('checked', rb.checked));
                const isClone = r.value === 'clone';
                cloneOpts.classList.toggle('fe-hidden', !isClone);
                if (isClone) setTimeout(() => urlInput.focus(), 50);
            });
        });
        
        const cleanup = () => {
            overlay.remove();
            document.removeEventListener('keydown', onEsc);
        };
        
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                reject('cancelled');
            }
        };
        document.addEventListener('keydown', onEsc);
        
        box.querySelector('#fe-modal-cancel').addEventListener('click', () => {
            cleanup();
            reject('cancelled');
        });
        
        box.querySelector('#fe-modal-continue').addEventListener('click', () => {
            const type = box.querySelector('input[name="proj_type"]:checked').value;
            const url = urlInput.value.trim();
            
            if (type === 'clone' && !url) {
                if (toastFn) toastFn('Please enter a valid Git URL');
                urlInput.focus();
                return;
            }
            
            cleanup();
            resolve({ type, url });
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                reject('cancelled');
            }
        });
    });
}

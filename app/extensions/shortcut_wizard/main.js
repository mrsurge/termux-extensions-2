// Extension Script: Shortcut Wizard

export default function initialize(extensionContainer, api) {
  // --- Get references to views and containers ---
  const menuView = extensionContainer.querySelector('#wizard-menu-view');
  const editorView = extensionContainer.querySelector('#wizard-editor-view');
  const editListView = extensionContainer.querySelector('#wizard-edit-list-view');
  const envVarsContainer = extensionContainer.querySelector('#env-vars-container');
  const commandBlocksContainer = extensionContainer.querySelector('#command-blocks');

  // --- Get references to buttons ---
  const newBtn = extensionContainer.querySelector('#wizard-new-btn');
  const editBtn = extensionContainer.querySelector('#wizard-edit-btn');
  const newRawBtn = extensionContainer.querySelector('#wizard-new-raw-btn');
  const backBtn = extensionContainer.querySelector('#wizard-back-btn');
  const backBtnFromEdit = extensionContainer.querySelector('#wizard-back-btn-from-edit-list');
  const saveBtn = extensionContainer.querySelector('#wizard-save-btn');
  const addEnvVarBtn = extensionContainer.querySelector('#add-env-var-btn');
  const addCommandBtn = extensionContainer.querySelector('#add-command-btn');
  const addPipeBtn = extensionContainer.querySelector('#add-pipe-btn');
  const toggleDeleteBtn = extensionContainer.querySelector('#wizard-toggle-delete-btn');
  const deleteSelectedBtn = extensionContainer.querySelector('#wizard-delete-selected-btn');

  // --- State ---
  let inDeleteMode = false;
  let activeArgValueInput = null; // To store the input field that triggered the browser
  let simpleEditorPath = null;
  let activeCommandInputForPath = null; // Command input to populate from PATH picker

  // --- Modal Control (specific to this extension's modals) ---
  const openModal = (modalId) => {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'block';
  };
  const closeModal = (modalId) => {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
  };
  // Expose for inline handlers
  window.openModal = openModal;
  window.closeModal = closeModal;

  // Add close handlers to all modal close buttons that this extension owns
  extensionContainer.querySelectorAll('.modal .back-btn').forEach(btn => {
    const modal = btn.closest('.modal');
    if (!modal) return;
    btn.addEventListener('click', () => closeModal(modal.id));
  });

  // --- File Browser Logic ---
  const openFileBrowser = (inputElement) => {
    activeArgValueInput = inputElement;
    const startPath = inputElement.value && inputElement.value !== '~' ? inputElement.value : '';
    browsePath(startPath);
    openModal('file-browser-modal');
  };

  const browsePath = (path) => {
    const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
    fetch(url)
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(items => renderFileBrowser(path, items))
      .catch(() => alert('Error browsing path.'));
  };

  const selectDirBtn = extensionContainer.querySelector('#file-browser-select-dir-btn');
  if (selectDirBtn) {
    selectDirBtn.addEventListener('click', () => {
      const currentPath = document.getElementById('file-browser-path').textContent;
      if (activeArgValueInput) {
        activeArgValueInput.value = currentPath;
      }
      closeModal('file-browser-modal');
    });
  }

  const renderFileBrowser = (path, items) => {
    const container = extensionContainer.querySelector('#file-browser-list');
    const pathDisplay = extensionContainer.querySelector('#file-browser-path');
    container.innerHTML = '';
    pathDisplay.textContent = path || '~';

    if (path && path !== '/') {
      const lastSlash = path.lastIndexOf('/');
      const parentPath = lastSlash > 0 ? path.substring(0, lastSlash) : '/';
      const upItem = document.createElement('div');
      upItem.className = 'file-item';
      upItem.innerHTML = '<span class="icon">&#8617;</span> ..';
      upItem.onclick = () => browsePath(parentPath);
      container.appendChild(upItem);
    }

    items.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'file-item';
      const icon = item.type === 'directory' ? '&#128193;' : '&#128196;';
      itemEl.innerHTML = `<span class="icon">${icon}</span> ${item.name}`;
      itemEl.onclick = () => {
        if (item.type === 'directory') {
          browsePath(item.path);
        } else {
          if (activeArgValueInput) {
            activeArgValueInput.value = item.path;
          }
          closeModal('file-browser-modal');
        }
      };
      container.appendChild(itemEl);
    });
  };

  // --- Dynamic Row Creation ---
  const createEnvVarRow = (key = '', value = '') => {
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
      <input type="text" class="form-input env-key" placeholder="KEY" value="${key}">
      <span style="color: var(--muted-foreground);">=</span>
      <input type="text" class="form-input env-value" placeholder="Value" value="${value}">
      <button class="remove-btn">&times;</button>
    `;
    row.querySelector('.remove-btn').onclick = () => row.remove();
    envVarsContainer.appendChild(row);
  };

  const createArgRow = (targetArgsContainer, option = '', value = '') => {
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
      <div class="reorder-handle">
        <button class="reorder-btn up-btn">&#8593;</button>
        <button class="reorder-btn down-btn">&#8595;</button>
      </div>
      <input type="text" class="form-input arg-option" placeholder="Option (e.g., -l)" value="${option}">
      <div class="input-with-buttons" style="flex-grow: 2;">
        <input type="text" class="form-input arg-value" placeholder="Value (optional)" value="${value}">
        <button class="picker-btn" title="Browse">&#128193;</button>
      </div>
      <button class="remove-btn">&times;</button>
    `;
    row.querySelector('.up-btn').onclick = () => {
      if (row.previousElementSibling) {
        row.parentNode.insertBefore(row, row.previousElementSibling);
      }
    };
    row.querySelector('.down-btn').onclick = () => {
      if (row.nextElementSibling) {
        row.parentNode.insertBefore(row.nextElementSibling, row);
      }
    };
    const optInput = row.querySelector('.arg-option');
    optInput.addEventListener('input', () => lowercaseFirstWord(optInput));
    row.querySelector('.remove-btn').onclick = () => row.remove();
    row.querySelector('.picker-btn').onclick = (e) => {
      const input = e.target.closest('.input-with-buttons').querySelector('.arg-value');
      openFileBrowser(input);
    };
    targetArgsContainer.appendChild(row);
  };

  // --- Command Blocks ---
  const createCommandBlock = (command = '', args = []) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'command-block-wrapper';
    wrapper.style.position = 'relative';

    const block = document.createElement('div');
    block.className = 'command-block';
    block.innerHTML = `
      <div class="form-section">
        <label>Command</label>
        <div class="input-with-buttons">
          <input type="text" class="form-input command-input" placeholder="e.g., ls, git, python" value="${command}">
          <button class="picker-btn path-picker" title="Select from $PATH">$</button>
          <button class="picker-btn exe-browser" title="Browse for executable">&#128193;</button>
        </div>
      </div>
      <div class="form-section">
        <label>Arguments</label>
        <div class="args-container"></div>
        <button class="add-arg-btn add-btn">+ Add Argument</button>
      </div>
    `;

    const cmdInput = block.querySelector('.command-input');
    cmdInput.addEventListener('input', () => lowercaseFirstWord(cmdInput));
    block.querySelector('.path-picker').onclick = () => openPathExecPicker(cmdInput);
    block.querySelector('.exe-browser').onclick = () => openFileBrowser(cmdInput);

    const targetArgsContainer = block.querySelector('.args-container');
    block.querySelector('.add-arg-btn').onclick = () => createArgRow(targetArgsContainer);
    if (args && args.length) {
      args.forEach(a => createArgRow(targetArgsContainer, a.option || '', a.value || ''));
    } else {
      createArgRow(targetArgsContainer);
    }

    wrapper.appendChild(block);
    commandBlocksContainer.appendChild(wrapper);
    return wrapper;
  };

  // Add pipe or block connector after a command wrapper
  function setConnectorAfter(wrapper, type) {
    // type: 'pipe' | 'block' | 'none'
    // Remove existing connectors within wrapper
    Array.from(wrapper.querySelectorAll('.pipe-separator, .block-separator, .pipe-remove-btn')).forEach(el => el.remove());
    wrapper.dataset.pipeToNext = 'false';

    if (type === 'pipe') {
      const hr = document.createElement('hr');
      hr.className = 'pipe-separator';
      const label = document.createElement('span');
      label.className = 'pipe-label';
      label.textContent = '|';
      hr.appendChild(label);
      const removeBtn = document.createElement('button');
      removeBtn.className = 'pipe-remove-btn';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove pipe (make next command new line)';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setConnectorAfter(wrapper, 'block');
      });
      wrapper.appendChild(hr);
      wrapper.appendChild(removeBtn);
      wrapper.dataset.pipeToNext = 'true';
    } else if (type === 'block') {
      const hr = document.createElement('hr');
      hr.className = 'block-separator';
      wrapper.appendChild(hr);
      wrapper.dataset.pipeToNext = 'false';
    }
  }

  // --- Event Listeners ---
  addEnvVarBtn.addEventListener('click', () => createEnvVarRow());
  addCommandBtn.addEventListener('click', () => {
    const wrappers = commandBlocksContainer.querySelectorAll('.command-block-wrapper');
    if (wrappers.length > 0) {
      const last = wrappers[wrappers.length - 1];
      setConnectorAfter(last, 'block');
    }
    createCommandBlock();
  });
  if (addPipeBtn) {
    addPipeBtn.addEventListener('click', () => {
      const wrappers = commandBlocksContainer.querySelectorAll('.command-block-wrapper');
      if (wrappers.length === 0) {
        // create first block, no connector
        createCommandBlock();
        return;
      }
      const last = wrappers[wrappers.length - 1];
      setConnectorAfter(last, 'pipe');
      createCommandBlock();
    });
  }

  newBtn.addEventListener('click', () => {
    extensionContainer.querySelector('#editor-title').textContent = 'New Shortcut';
    extensionContainer.querySelector('#shortcut-filename').value = '';
    extensionContainer.querySelector('#shortcut-shebang').checked = true;
    envVarsContainer.innerHTML = '';
    commandBlocksContainer.innerHTML = '';
    createCommandBlock();
    showView(editorView);
  });

  editBtn.addEventListener('click', () => {
    api.get('list').then(renderEditList);
    showView(editListView);
  });

  if (newRawBtn) {
    newRawBtn.addEventListener('click', () => {
      // Prepare empty simple editor for a new raw script
      simpleEditorPath = null; // path not set yet
      const title = extensionContainer.querySelector('#simple-editor-title');
      const text = extensionContainer.querySelector('#simple-editor-text');
      const filename = extensionContainer.querySelector('#simple-editor-filename');
      if (title) title.textContent = 'New Raw Script';
      if (text) text.value = '';
      if (filename) filename.value = '';
      openModal('simple-editor-modal');
    });
  }

  backBtn.addEventListener('click', () => showView(menuView));
  backBtnFromEdit.addEventListener('click', () => showView(menuView));

  saveBtn.addEventListener('click', () => {
    const envVars = {};
    envVarsContainer.querySelectorAll('.dynamic-row').forEach(row => {
      const key = row.querySelector('.env-key').value;
      const value = row.querySelector('.env-value').value;
      if (key) envVars[key] = value;
    });

    const commands = [];
    commandBlocksContainer.querySelectorAll('.command-block-wrapper').forEach(wrapper => {
      const block = wrapper.querySelector('.command-block');
      const command = block.querySelector('.command-input').value.trim();
      const args = [];
      block.querySelectorAll('.args-container .dynamic-row').forEach(row => {
        const option = row.querySelector('.arg-option').value;
        const value = row.querySelector('.arg-value').value;
        if (option || value) {
          args.push({ option, value });
        }
      });
      if (command) {
        const pipe_to_next = wrapper.dataset.pipeToNext === 'true';
        commands.push({ command, args, pipe_to_next });
      }
    });

    const payload = {
      filename: extensionContainer.querySelector('#shortcut-filename').value,
      shebang: extensionContainer.querySelector('#shortcut-shebang').checked,
      env_vars: envVars,
      commands: commands
    };

    if (!payload.filename || !payload.commands || payload.commands.length === 0) {
      alert('Filename and at least one command are required.');
      return;
    }

    api.post('create', payload)
      .then(response => {
        alert(response.message || 'Shortcut saved successfully!');
        showView(menuView);
      })
      .catch(err => {
        err.json().then(json_err => {
          alert(`Error: ${json_err.error}`);
        }).catch(() => {
          alert('An unknown error occurred while saving.');
        });
      });
  });

  // --- View Switching and Rendering ---
  const showView = (viewToShow) => {
    [menuView, editorView, editListView].forEach(v => v.style.display = 'none');
    inDeleteMode = false;
    toggleDeleteBtn.classList.remove('active');
    deleteSelectedBtn.style.display = 'none';
    viewToShow.style.display = 'block';
  };

  const renderEditList = (scripts) => {
    const container = extensionContainer.querySelector('#wizard-edit-list-container');
    container.innerHTML = '';
    if (scripts.length === 0) {
      container.innerHTML = '<p style="color: var(--muted-foreground);">No shortcuts found.</p>';
      return;
    }
    scripts.forEach(script => {
      const item = document.createElement('div');
      item.className = 'wizard-menu-btn';
      item.style.textAlign = 'left';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';

      let content = `<span>${script.name}</span>`;
      if (inDeleteMode) {
        content = `
          <label style="display: flex; align-items: center; width: 100%;">
            <input type="checkbox" data-path="${script.path}" style="margin-right: 12px;">
            <span>${script.name}</span>
          </label>
        `;
      }
      item.innerHTML = content;

      if (script.is_editable && !inDeleteMode) {
        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.onclick = (e) => {
          e.stopPropagation();
          loadShortcutForEditing(script.path);
        };
        item.appendChild(editButton);
      } else if (!inDeleteMode) {
        const viewButton = document.createElement('button');
        viewButton.textContent = 'View';
        viewButton.onclick = (e) => {
          e.stopPropagation();
          openSimpleEditor(script.path, script.name);
        };
        item.appendChild(viewButton);
      }
      container.appendChild(item);
    });
  };

  const loadShortcutForEditing = (path) => {
    api.get(`detail?path=${encodeURIComponent(path)}`).then(details => {
      const filename = path.split('/').pop();
      extensionContainer.querySelector('#editor-title').textContent = `Edit: ${filename}`;
      extensionContainer.querySelector('#shortcut-filename').value = filename;
      extensionContainer.querySelector('#shortcut-shebang').checked = !!details.shebang;

      envVarsContainer.innerHTML = '';
      if (details.env_vars) {
        for (const [key, value] of Object.entries(details.env_vars)) {
          createEnvVarRow(key, value);
        }
      }

      commandBlocksContainer.innerHTML = '';
      if (Array.isArray(details.commands) && details.commands.length > 0) {
        details.commands.forEach(block => {
          createCommandBlock(block.command || '', block.args || []);
        });
      } else {
        createCommandBlock(details.command || '', details.args || []);
      }

      showView(editorView);
    }).catch(() => alert('Could not load shortcut details.'));
  };

  // --- Simple Editor for non-editable scripts ---
  const openSimpleEditor = (path, name) => {
    simpleEditorPath = path;
    const title = extensionContainer.querySelector('#simple-editor-title');
    const text = extensionContainer.querySelector('#simple-editor-text');
    if (title) title.textContent = `View: ${name}`;
    if (text) text.value = '';
    api.get(`read_raw?path=${encodeURIComponent(path)}`).then(res => {
      if (text) text.value = res.content || '';
      openModal('simple-editor-modal');
    }).catch(() => {
      alert('Failed to read file.');
    });
  };
  const simpleSaveBtn = extensionContainer.querySelector('#simple-editor-save-btn');
  if (simpleSaveBtn) {
    simpleSaveBtn.addEventListener('click', () => {
      const textEl = extensionContainer.querySelector('#simple-editor-text');
      const fileInput = extensionContainer.querySelector('#simple-editor-filename');
      const content = textEl ? textEl.value : '';
      let path = simpleEditorPath;
      // If creating new, require a filename, save to ~/.shortcuts
      if (!path) {
        const fname = (fileInput && fileInput.value || '').trim();
        if (!fname) {
          alert('Please enter a filename.');
          return;
        }
        path = `${getHomeShortcutsDir()}/${fname}`;
      }
      api.post('save_raw', { path, content }).then(() => {
        alert('Saved.');
      }).catch(() => alert('Failed to save.'));
    });
  }

  // Helper to resolve ~/.shortcuts on client side
  function getHomeShortcutsDir() {
    // Best effort: Termux default HOME path; server validates and writes.
    return '/data/data/com.termux/files/home/.shortcuts';
  }

  // --- $PATH Executable Picker ---
  function openPathExecPicker(targetInput) {
    activeCommandInputForPath = targetInput;
    const list = extensionContainer.querySelector('#path-exec-list');
    const search = extensionContainer.querySelector('#path-exec-search');
    if (list) list.innerHTML = '';
    if (search) search.value = '';
    // Show loading modal first
    openModal('loading-modal');
    fetch('/api/list_path_executables')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(items => {
        // items: [{name, path}] expected
        renderPathExecList(items);
        closeModal('loading-modal');
        openModal('path-exec-modal');
      })
      .catch(() => {
        if (list) list.innerHTML = '<div class="file-item">Failed to load executables.</div>';
        closeModal('loading-modal');
        openModal('path-exec-modal');
      });
  }

  function renderPathExecList(items) {
    const list = extensionContainer.querySelector('#path-exec-list');
    const search = extensionContainer.querySelector('#path-exec-search');
    if (!list) return;

    function apply(itemsToShow) {
      list.innerHTML = '';
      itemsToShow.forEach(it => {
        const row = document.createElement('div');
        row.className = 'file-item';
        row.innerHTML = `<span class="icon">$</span> ${it.name} <span class="meta">${it.path || ''}</span>`;
        row.addEventListener('click', () => {
          if (activeCommandInputForPath) {
            activeCommandInputForPath.value = it.name || it.path || '';
          }
          closeModal('path-exec-modal');
        });
        list.appendChild(row);
      });
      if (itemsToShow.length === 0) {
        list.innerHTML = '<div class="file-item">No matches</div>';
      }
    }

    apply(items);

    if (search && !search._bound) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        if (!q) return apply(items);
        const filtered = items.filter(it => (it.name || '').toLowerCase().includes(q) || (it.path || '').toLowerCase().includes(q));
        apply(filtered);
      });
      search._bound = true;
    }
  }

  // --- Lowercase first word helper & bindings ---
  const lowercaseFirstWord = (inputEl) => {
    const val = inputEl.value;
    if (!val) return;
    const parts = val.split(/(\s+)/);
    if (parts.length > 0) {
      parts[0] = parts[0].toLowerCase();
      inputEl.value = parts.join('');
    }
  };
  const filenameInput = extensionContainer.querySelector('#shortcut-filename');
  if (filenameInput) {
    filenameInput.addEventListener('input', () => lowercaseFirstWord(filenameInput));
  }

  // --- Delete Logic ---
  toggleDeleteBtn.addEventListener('click', () => {
    inDeleteMode = !inDeleteMode;
    toggleDeleteBtn.classList.toggle('active', inDeleteMode);
    deleteSelectedBtn.style.display = inDeleteMode ? 'block' : 'none';
    api.get('list').then(renderEditList);
  });

  deleteSelectedBtn.addEventListener('click', () => {
    const container = extensionContainer.querySelector('#wizard-edit-list-container');
    const checkedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
    const pathsToDelete = Array.from(checkedBoxes).map(cb => cb.dataset.path);

    if (pathsToDelete.length === 0) {
      alert('Please select at least one shortcut to delete.');
      return;
    }

    if (confirm(`Are you sure you want to permanently delete ${pathsToDelete.length} shortcut(s)?`)) {
      api.post('delete', { paths: pathsToDelete })
        .then(() => {
          api.get('list').then(renderEditList);
        })
        .catch(() => alert('An error occurred while deleting shortcuts.'));
    }
  });
}

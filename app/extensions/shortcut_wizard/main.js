// Extension Script: Shortcut Wizard

export default function initialize(extensionContainer, api) {
    // --- Get references to views and containers ---
    const menuView = extensionContainer.querySelector('#wizard-menu-view');
    const editorView = extensionContainer.querySelector('#wizard-editor-view');
    const editListView = extensionContainer.querySelector('#wizard-edit-list-view');
    const envVarsContainer = extensionContainer.querySelector('#env-vars-container');
    const argsContainer = extensionContainer.querySelector('#args-container');

    // --- Get references to buttons ---
    const newBtn = extensionContainer.querySelector('#wizard-new-btn');
    const editBtn = extensionContainer.querySelector('#wizard-edit-btn');
    const backBtn = extensionContainer.querySelector('#wizard-back-btn');
    const backBtnFromEdit = extensionContainer.querySelector('#wizard-back-btn-from-edit-list');
    const saveBtn = extensionContainer.querySelector('#wizard-save-btn');
    const addEnvVarBtn = extensionContainer.querySelector('#add-env-var-btn');
    const addArgBtn = extensionContainer.querySelector('#add-arg-btn');
    const toggleDeleteBtn = extensionContainer.querySelector('#wizard-toggle-delete-btn');
    const deleteSelectedBtn = extensionContainer.querySelector('#wizard-delete-selected-btn');

    // --- State ---
    let inDeleteMode = false;
    let activeArgValueInput = null; // To store the input field that triggered the browser

    // --- Modal Control (specific to this extension's modals) ---
    const openModal = (modalId) => {
        document.getElementById(modalId).style.display = 'block';
    };
    const closeModal = (modalId) => {
        document.getElementById(modalId).style.display = 'none';
    };

    // Add close handlers to all modal close buttons that this extension owns
    document.querySelectorAll('.modal .back-btn').forEach(btn => {
        const modalId = btn.closest('.modal').id;
        btn.onclick = () => closeModal(modalId);
    });

    // --- File Browser Logic ---
    const openFileBrowser = (inputElement) => {
        activeArgValueInput = inputElement;
        const startPath = inputElement.value || '~'; // Use input value or home dir
        browsePath(startPath);
        openModal('file-browser-modal');
    };

    const browsePath = (path) => {
        // Use the core API, not the extension-scoped one
        fetch(`/api/browse?path=${encodeURIComponent(path)}`)
            .then(res => res.ok ? res.json() : Promise.reject(res))
            .then(items => renderFileBrowser(path, items)) // Pass the path to the renderer
            .catch(err => alert('Error browsing path.'));
    };

    document.getElementById('file-browser-select-dir-btn').addEventListener('click', () => {
        const currentPath = document.getElementById('file-browser-path').textContent;
        if (activeArgValueInput) {
            activeArgValueInput.value = currentPath;
        }
        closeModal('file-browser-modal');
    });

    const renderFileBrowser = (path, items) => {
        const container = document.getElementById('file-browser-list');
        const pathDisplay = document.getElementById('file-browser-path');
        container.innerHTML = '';
        pathDisplay.textContent = path;

        // Add an "up one level" option
        if (path && path !== '/' && path !== '~') {
            const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
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

    const createArgRow = (option = '', value = '') => {
        const row = document.createElement('div');
        row.className = 'dynamic-row';
        row.innerHTML = `
            <div class="reorder-handle">
                <button class="reorder-btn up-btn">&#9650;</button>
                <button class="reorder-btn down-btn">&#9660;</button>
            </div>
            <input type="text" class="form-input arg-option" placeholder="Flag" value="${option}" style="width: 25%;">
            <div class="input-with-buttons" style="width: 75%;">
                <input type="text" class="form-input arg-value" placeholder="Value" value="${value}">
                <button class="picker-btn" title="Browse for file/directory">&#128193;</button>
            </div>
            <button class="remove-btn">&times;</button>
        `;
        // Reordering logic
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

        row.querySelector('.remove-btn').onclick = () => row.remove();
        row.querySelector('.picker-btn').onclick = (e) => {
            const input = e.target.closest('.input-with-buttons').querySelector('.arg-value');
            openFileBrowser(input);
        };
        argsContainer.appendChild(row);
    };

    // --- Event Listeners ---
    addEnvVarBtn.addEventListener('click', () => createEnvVarRow());
    addArgBtn.addEventListener('click', () => createArgRow());

    // Add placeholders for command picker buttons
    extensionContainer.querySelectorAll('.picker-btn').forEach(btn => {
        if(btn.title === 'Select from $PATH') {
            btn.onclick = () => alert('$PATH executable picker not implemented yet.');
        } else if (btn.title === 'Browse for executable') {
            btn.onclick = () => alert('File browser for executable not implemented yet.');
        }
    });

    newBtn.addEventListener('click', () => {
        extensionContainer.querySelector('#editor-title').textContent = 'New Shortcut';
        // Clear form for new shortcut
        extensionContainer.querySelector('#shortcut-filename').value = '';
        extensionContainer.querySelector('#shortcut-shebang').checked = true;
        extensionContainer.querySelector('#shortcut-command').value = '';
        envVarsContainer.innerHTML = '';
        argsContainer.innerHTML = '';
        createArgRow(); // Start with one empty argument row
        showView(editorView);
    });

    editBtn.addEventListener('click', () => {
        api.get('list').then(renderEditList);
        showView(editListView);
    });

    backBtn.addEventListener('click', () => showView(menuView));
    backBtnFromEdit.addEventListener('click', () => showView(menuView));

    saveBtn.addEventListener('click', () => {
        const envVars = {};
        envVarsContainer.querySelectorAll('.dynamic-row').forEach(row => {
            const key = row.querySelector('.env-key').value;
            const value = row.querySelector('.env-value').value;
            if (key) envVars[key] = value;
        });

        const args = [];
        argsContainer.querySelectorAll('.dynamic-row').forEach(row => {
            const option = row.querySelector('.arg-option').value;
            const value = row.querySelector('.arg-value').value;
            if (option || value) {
                args.push({ option, value });
            }
        });

        const payload = {
            filename: extensionContainer.querySelector('#shortcut-filename').value,
            shebang: extensionContainer.querySelector('#shortcut-shebang').checked,
            command: extensionContainer.querySelector('#shortcut-command').value,
            env_vars: envVars,
            args: args
        };

        if (!payload.filename || !payload.command) {
            alert('Filename and Command are required fields.');
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
            }
            container.appendChild(item);
        });
    };

    const loadShortcutForEditing = (path) => {
        api.get(`detail?path=${encodeURIComponent(path)}`).then(details => {
            extensionContainer.querySelector('#editor-title').textContent = `Edit: ${path.split('/').pop()}`;
            extensionContainer.querySelector('#shortcut-filename').value = path.split('/').pop();
            extensionContainer.querySelector('#shortcut-shebang').checked = details.shebang;
            extensionContainer.querySelector('#shortcut-command').value = details.command;
            
            envVarsContainer.innerHTML = '';
            if (details.env_vars) {
                for (const [key, value] of Object.entries(details.env_vars)) {
                    createEnvVarRow(key, value);
                }
            }

            argsContainer.innerHTML = '';
            if (details.args && details.args.length > 0) {
                details.args.forEach(arg => createArgRow(arg.option, arg.value));
            } else {
                createArgRow();
            }

            showView(editorView);
        }).catch(err => alert('Could not load shortcut details.'));
    };

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
                .catch(err => alert('An error occurred while deleting shortcuts.'));
        }
    });
}

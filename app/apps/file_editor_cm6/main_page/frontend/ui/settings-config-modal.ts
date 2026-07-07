
import { EXPLORER_RPC_METHODS } from '../../../src/explorer/rpc/contract.ts';
import {
  createJsonTextmateField,
  type JsonTextmateFieldHandle,
} from './cm6-json-textmate-field.ts';

type ExtConfigValues = Record<string, any>;
type ExtConfigSchema = Record<string, any>;

function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function schemaTypeIncludes(prop: any, typeName: string): boolean {
  const rawType = prop?.type;
  return rawType === typeName || (Array.isArray(rawType) && rawType.includes(typeName));
}

function schemaAnyOfIncludesType(prop: any, typeName: string): boolean {
  return Array.isArray(prop?.anyOf) && prop.anyOf.some((branch: any) => {
    return schemaTypeIncludes(branch, typeName);
  });
}

function schemaAllowsObject(prop: any): boolean {
  return schemaTypeIncludes(prop, 'object') ||
    schemaAnyOfIncludesType(prop, 'object') ||
    isPlainObject(prop?.default);
}

function formatConfigValue(value: any): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
  }
  return String(value);
}

function sameConfigValue(left: any, right: any): boolean {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch (_) { return String(left) === String(right); }
}

function collectEnumOptions(prop: any): any[] {
  const options: any[] = [];
  const seen = new Set<string>();
  const addOption = (value: any) => {
    let key = '';
    try { key = JSON.stringify(value); } catch (_) { key = String(value); }
    if (seen.has(key)) return;
    seen.add(key);
    options.push(value);
  };

  if (Array.isArray(prop?.enum)) {
    prop.enum.forEach(addOption);
  }
  if (Array.isArray(prop?.anyOf)) {
    prop.anyOf.forEach((branch: any) => {
      if (Array.isArray(branch?.enum)) branch.enum.forEach(addOption);
    });
  }
  return options;
}

function parseJsonRawValue(rawValue: string): { ok: boolean; value: any } {
  const raw = rawValue.trim();
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (_) {
    return { ok: false, value: null };
  }
}

/**
 * @param {{
 *   modalEl: HTMLElement,
 *   titleEl: HTMLElement,
 *   formEl: HTMLElement,
 *   closeBtn: HTMLElement,
 *   cancelBtn: HTMLElement,
 *   saveBtn: HTMLButtonElement,
 *   busRequest: (event: string, payload?: any, timeoutMs?: number) => Promise<any>,
 *   refreshExtManager: () => Promise<any> | void,
 *   reloadEditorFrame: () => void,
 *   toast: (msg: string, ms?: number) => void
 * }} deps
 */
export function createSettingsConfigModalController(deps: any) {
  let extConfigExtId = '';
  let extConfigValues: ExtConfigValues = {};
  let extConfigScope = 'user';
  let fieldDisposables: Array<() => void> = [];

  function cleanupFieldControls() {
    fieldDisposables.forEach((dispose) => dispose());
    fieldDisposables = [];
  }

  function createJsonEditor(options: {
    value: string;
    rows?: number;
    placeholder?: string;
    onValidValue: (value: any) => void;
  }): JsonTextmateFieldHandle {
    const editor = createJsonTextmateField({
      value: options.value,
      rows: options.rows || 8,
      placeholder: options.placeholder || 'JSON object...',
      className: 'ext-config-json-editor',
      validateJson: true,
      onJsonChange(value) {
        options.onValidValue(value);
      },
    });
    fieldDisposables.push(() => editor.destroy());
    return editor;
  }

  function openExtConfigModal(extId: string, displayName: string, schema: ExtConfigSchema, currentValues: ExtConfigValues, scope = 'user') {
    cleanupFieldControls();
    extConfigExtId = extId;
    extConfigScope = scope;
    extConfigValues = { ...(currentValues || {}) };
    const scopeLabel = extConfigScope === 'workspace' ? ' (Workspace)' : ' (User)';
    deps.titleEl.textContent = `Configure: ${displayName || extId}${scopeLabel}`;
    deps.formEl.innerHTML = '';

    const props: ExtConfigSchema = schema?.properties || schema || {};
    const propKeys = Object.keys(props);
    if (!propKeys.length) {
      const msg = document.createElement('div');
      msg.style.opacity = '0.7';
      msg.textContent = 'This extension has no configurable settings.';
      deps.formEl.appendChild(msg);
    } else {
      let lastGroup: string | null = null;
      propKeys.forEach((key) => {
        const group = key.indexOf('.') > 0 ? key.slice(0, key.indexOf('.')) : '';
        if (lastGroup !== null && group !== lastGroup) {
          const sep = document.createElement('div');
          sep.className = 'fe-hr-thin';
          deps.formEl.appendChild(sep);
        }
        lastGroup = group;
        const prop = props[key] || {};
        const fieldRow = document.createElement('div');
        fieldRow.style.marginBottom = '12px';

        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.fontWeight = '600';
        label.style.fontSize = '0.88rem';
        label.style.marginBottom = '4px';
        label.textContent = key;
        fieldRow.appendChild(label);

        if (prop.description) {
          const desc = document.createElement('div');
          desc.style.fontSize = '12px';
          desc.style.opacity = '0.6';
          desc.style.marginBottom = '4px';
          desc.textContent = prop.description;
          fieldRow.appendChild(desc);
        }

        const hasCurrentValue = Object.prototype.hasOwnProperty.call(extConfigValues, key);
        const curVal = hasCurrentValue ? extConfigValues[key] : prop.default;
        if (prop.type === 'boolean') {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!curVal;
          cb.addEventListener('change', () => { extConfigValues[key] = cb.checked; });
          fieldRow.appendChild(cb);
        } else if (schemaAllowsObject(prop) && collectEnumOptions(prop).length) {
          const enumOptions = collectEnumOptions(prop);
          const customValue = isPlainObject(curVal) ? curVal : (isPlainObject(prop.default) ? prop.default : {});
          const select = document.createElement('select');
          select.className = 'lsp-rootrel-input';
          select.style.width = '100%';
          select.style.marginBottom = '6px';

          enumOptions.forEach((opt: any) => {
            const option = document.createElement('option');
            option.value = formatConfigValue(opt);
            option.textContent = formatConfigValue(opt);
            select.appendChild(option);
          });

          const customOption = document.createElement('option');
          customOption.value = '__json_object__';
          customOption.textContent = 'Custom JSON object';
          select.appendChild(customOption);

          const jsonEditor = createJsonEditor({
            value: formatConfigValue(customValue),
            rows: 8,
            placeholder: 'JSON object...',
            onValidValue(value) {
              if (select.value === '__json_object__') extConfigValues[key] = value;
            },
          });

          const enumMatch = enumOptions.find((opt: any) => sameConfigValue(curVal, opt));
          select.value = enumMatch !== undefined ? formatConfigValue(enumMatch) : '__json_object__';

          function syncMixedEditor(markChanged: boolean) {
            if (select.value !== '__json_object__') {
              jsonEditor.element.style.display = 'none';
              jsonEditor.setInvalid(false);
              if (markChanged) {
                const selected = enumOptions.find((opt: any) => formatConfigValue(opt) === select.value);
                extConfigValues[key] = selected !== undefined ? selected : select.value;
              }
              return;
            }

            jsonEditor.element.style.display = '';
            if (markChanged) {
              const parsed = parseJsonRawValue(jsonEditor.getValue());
              jsonEditor.setInvalid(!parsed.ok);
              if (parsed.ok) extConfigValues[key] = parsed.value;
            }
          }

          select.addEventListener('change', () => syncMixedEditor(true));
          syncMixedEditor(false);
          fieldRow.appendChild(select);
          fieldRow.appendChild(jsonEditor.element);
        } else if (prop.enum && Array.isArray(prop.enum)) {
          const wrap = document.createElement('div');
          wrap.style.display = 'flex';
          wrap.style.flexDirection = 'column';
          wrap.style.gap = '4px';
          prop.enum.forEach((opt: any) => {
            const optLabel = document.createElement('label');
            optLabel.style.display = 'flex';
            optLabel.style.alignItems = 'center';
            optLabel.style.gap = '6px';
            optLabel.style.cursor = 'pointer';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `ext-cfg-${key}`;
            radio.value = formatConfigValue(opt);
            radio.checked = sameConfigValue(curVal, opt);
            radio.addEventListener('change', () => { extConfigValues[key] = opt; });
            optLabel.appendChild(radio);
            optLabel.appendChild(document.createTextNode(formatConfigValue(opt)));
            wrap.appendChild(optLabel);
          });
          fieldRow.appendChild(wrap);
        } else if (prop.type === 'number' || prop.type === 'integer') {
          const input = document.createElement('input');
          input.type = 'number';
          input.className = 'lsp-rootrel-input';
          input.style.width = '100%';
          input.value = curVal != null ? String(curVal) : '';
          if (prop.minimum != null) input.min = String(prop.minimum);
          if (prop.maximum != null) input.max = String(prop.maximum);
          input.addEventListener('input', () => {
            extConfigValues[key] = input.value === '' ? null : Number(input.value);
          });
          fieldRow.appendChild(input);
        } else if (schemaAllowsObject(prop)) {
          const jsonEditor = createJsonEditor({
            value: formatConfigValue(curVal),
            rows: 8,
            placeholder: prop.default != null ? formatConfigValue(prop.default) : 'JSON object...',
            onValidValue(value) {
              extConfigValues[key] = value;
            },
          });
          fieldRow.appendChild(jsonEditor.element);
        } else if (prop.type === 'array') {
          // ── VS Code-style array editor ──────────────────────────
          const itemSchema = prop.items || {};
          const itemType = itemSchema.type || 'string';

          // Normalize current value to a proper JS array
          let arr: any[] = [];
          if (Array.isArray(curVal)) {
            arr = curVal.slice();
          } else if (typeof curVal === 'string' && curVal.trim()) {
            try { const p = JSON.parse(curVal); if (Array.isArray(p)) arr = p; } catch (_) {}
          }
          extConfigValues[key] = arr.slice();

          const arrayContainer = document.createElement('div');
          arrayContainer.className = 'ext-cfg-array';
          const rowsEl = document.createElement('div');
          rowsEl.className = 'ext-cfg-array-rows';
          arrayContainer.appendChild(rowsEl);

          let activeEdit: { cancel: () => void } | null = null;

          function itemToStr(val: any): string {
            if (val == null) return '';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }

          function parseItem(raw: string): any {
            const s = raw.trim();
            if (itemType === 'number' || itemType === 'integer') {
              const n = Number(s);
              return isNaN(n) ? s : n;
            }
            if (itemType === 'object') {
              try { return JSON.parse(s); } catch (_) { return s; }
            }
            return s;
          }

          function buildRow(idx: number): HTMLElement {
            const row = document.createElement('div');
            row.className = 'ext-cfg-array-row';

            const valSpan = document.createElement('span');
            valSpan.className = 'ext-cfg-array-val';
            valSpan.textContent = itemToStr(extConfigValues[key][idx]);
            row.appendChild(valSpan);

            const acts = document.createElement('span');
            acts.className = 'ext-cfg-array-acts';

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'ext-cfg-arr-btn ext-cfg-arr-edit';
            editBtn.textContent = '✏';
            editBtn.title = 'Edit';
            editBtn.addEventListener('click', () => {
              if (activeEdit) activeEdit.cancel();
              startEdit(row, idx);
            });

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'ext-cfg-arr-btn ext-cfg-arr-del';
            delBtn.textContent = '✕';
            delBtn.title = 'Remove';
            delBtn.addEventListener('click', () => {
              if (activeEdit) activeEdit.cancel();
              extConfigValues[key].splice(idx, 1);
              rebuild();
            });

            acts.appendChild(editBtn);
            acts.appendChild(delBtn);
            row.appendChild(acts);
            return row;
          }

          function startEdit(row: HTMLElement, idx: number) {
            row.innerHTML = '';
            row.classList.add('ext-cfg-array-row-editing');

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'lsp-rootrel-input ext-cfg-arr-input';
            input.value = itemToStr(extConfigValues[key][idx]);

            const acts = document.createElement('span');
            acts.className = 'ext-cfg-array-acts';

            const doConfirm = () => {
              const v = input.value.trim();
              if (v) extConfigValues[key][idx] = parseItem(v);
              activeEdit = null;
              rebuild();
            };
            const doCancel = () => { activeEdit = null; rebuild(); };

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'ext-cfg-arr-btn ext-cfg-arr-ok';
            okBtn.textContent = '✓';
            okBtn.title = 'Confirm';
            okBtn.addEventListener('click', doConfirm);

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'ext-cfg-arr-btn ext-cfg-arr-cancel';
            cancelBtn.textContent = '✕';
            cancelBtn.title = 'Cancel';
            cancelBtn.addEventListener('click', doCancel);

            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
              if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
            });

            acts.appendChild(okBtn);
            acts.appendChild(cancelBtn);
            row.appendChild(input);
            row.appendChild(acts);
            activeEdit = { cancel: doCancel };
            input.focus();
          }

          function rebuild() {
            rowsEl.innerHTML = '';
            (extConfigValues[key] as any[]).forEach((_, i) => {
              rowsEl.appendChild(buildRow(i));
            });
          }

          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'ext-cfg-arr-add';
          addBtn.textContent = '+ Add Item';
          addBtn.addEventListener('click', () => {
            if (activeEdit) activeEdit.cancel();
            addBtn.style.display = 'none';

            const addRow = document.createElement('div');
            addRow.className = 'ext-cfg-array-row ext-cfg-array-row-editing';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'lsp-rootrel-input ext-cfg-arr-input';
            input.placeholder = itemType === 'object' ? 'JSON object…' : 'Enter value…';

            const acts = document.createElement('span');
            acts.className = 'ext-cfg-array-acts';

            const doAdd = () => {
              const v = input.value.trim();
              if (v) extConfigValues[key].push(parseItem(v));
              activeEdit = null;
              addRow.remove();
              addBtn.style.display = '';
              rebuild();
            };
            const doCancelAdd = () => {
              activeEdit = null;
              addRow.remove();
              addBtn.style.display = '';
            };

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'ext-cfg-arr-btn ext-cfg-arr-ok';
            okBtn.textContent = '✓';
            okBtn.title = 'Add';
            okBtn.addEventListener('click', doAdd);

            const cancelBtnAdd = document.createElement('button');
            cancelBtnAdd.type = 'button';
            cancelBtnAdd.className = 'ext-cfg-arr-btn ext-cfg-arr-cancel';
            cancelBtnAdd.textContent = '✕';
            cancelBtnAdd.title = 'Cancel';
            cancelBtnAdd.addEventListener('click', doCancelAdd);

            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
              if (e.key === 'Escape') { e.preventDefault(); doCancelAdd(); }
            });

            acts.appendChild(okBtn);
            acts.appendChild(cancelBtnAdd);
            addRow.appendChild(input);
            addRow.appendChild(acts);
            rowsEl.appendChild(addRow);
            activeEdit = { cancel: doCancelAdd };
            input.focus();
          });

          rebuild();
          arrayContainer.appendChild(addBtn);
          fieldRow.appendChild(arrayContainer);
        } else {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'lsp-rootrel-input';
          input.style.width = '100%';
          input.value = curVal != null ? String(curVal) : '';
          input.placeholder = prop.default != null ? String(prop.default) : '';
          input.addEventListener('input', () => { extConfigValues[key] = input.value; });
          fieldRow.appendChild(input);
        }
        deps.formEl.appendChild(fieldRow);
      });
    }

    deps.modalEl.classList.add('show');
    deps.modalEl.setAttribute('aria-hidden', 'false');
  }

  function closeExtConfigModal() {
    cleanupFieldControls();
    deps.modalEl.classList.remove('show');
    deps.modalEl.setAttribute('aria-hidden', 'true');
    extConfigExtId = '';
    extConfigValues = {};
  }

  function install() {
    deps.closeBtn.addEventListener('click', closeExtConfigModal);
    deps.cancelBtn.addEventListener('click', closeExtConfigModal);
    deps.modalEl.addEventListener('click', (ev: MouseEvent) => {
      if (ev.target === deps.modalEl) closeExtConfigModal();
    });
    deps.saveBtn.addEventListener('click', async () => {
      if (!extConfigExtId) return;
      deps.saveBtn.disabled = true;
      try {
        if (extConfigScope === 'workspace') {
          // Workspace scope: merge changed keys into .vscode/settings.json
          let wsSettings: ExtConfigValues = {};
          try {
            const getRes = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsWorkspaceSettingsGet, {}, 5000);
            wsSettings = getRes?.settings || {};
          } catch (_) {}
          // Merge our values into workspace settings (flat dotted keys)
          for (const [k, v] of Object.entries(extConfigValues)) {
            if (v === undefined || v === null || v === '' ||
                (Array.isArray(v) && v.length === 0)) {
              delete wsSettings[k];
            } else {
              wsSettings[k] = v;
            }
          }
          const res = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsWorkspaceSettingsSet, {
            settings: wsSettings,
          }, 15000);
          if (res?.ok) {
            deps.toast('Workspace configuration saved — reloading adapter…');
            closeExtConfigModal();
            void deps.refreshExtManager();
            deps.reloadEditorFrame();
          } else {
            deps.toast(res?.error || 'Save failed');
          }
        } else {
          // User scope: existing global config flow
          const res = await deps.busRequest(EXPLORER_RPC_METHODS.extensionsConfigure, {
            ext_id: extConfigExtId,
            values: extConfigValues,
          }, 15000);
          if (res?.ok) {
            deps.toast('Configuration saved — reloading adapter…');
            closeExtConfigModal();
            void deps.refreshExtManager();
            deps.reloadEditorFrame();
          } else {
            deps.toast(res?.error || 'Save failed');
          }
        }
      } catch (e) {
        deps.toast((e as { message?: string })?.message || 'Save failed');
      } finally {
        deps.saveBtn.disabled = false;
      }
    });
  }

  return { openExtConfigModal, closeExtConfigModal, install };
}

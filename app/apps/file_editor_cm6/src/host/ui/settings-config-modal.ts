// @ts-nocheck

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
 *   reloadEditorIframe: () => void,
 *   toast: (msg: string, ms?: number) => void
 * }} deps
 */
export function createSettingsConfigModalController(deps) {
  let extConfigExtId = '';
  let extConfigValues = {};

  function openExtConfigModal(extId, displayName, schema, currentValues) {
    extConfigExtId = extId;
    extConfigValues = { ...(currentValues || {}) };
    deps.titleEl.textContent = `Configure: ${displayName || extId}`;
    deps.formEl.innerHTML = '';

    const props = schema?.properties || schema || {};
    const propKeys = Object.keys(props);
    if (!propKeys.length) {
      const msg = document.createElement('div');
      msg.style.opacity = '0.7';
      msg.textContent = 'This extension has no configurable settings.';
      deps.formEl.appendChild(msg);
    } else {
      let lastGroup = null;
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

        const curVal = extConfigValues[key] !== undefined ? extConfigValues[key] : prop.default;
        if (prop.type === 'boolean') {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!curVal;
          cb.addEventListener('change', () => { extConfigValues[key] = cb.checked; });
          fieldRow.appendChild(cb);
        } else if (prop.enum && Array.isArray(prop.enum)) {
          const wrap = document.createElement('div');
          wrap.style.display = 'flex';
          wrap.style.flexDirection = 'column';
          wrap.style.gap = '4px';
          prop.enum.forEach((opt) => {
            const optLabel = document.createElement('label');
            optLabel.style.display = 'flex';
            optLabel.style.alignItems = 'center';
            optLabel.style.gap = '6px';
            optLabel.style.cursor = 'pointer';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `ext-cfg-${key}`;
            radio.value = String(opt);
            radio.checked = String(curVal) === String(opt);
            radio.addEventListener('change', () => { extConfigValues[key] = opt; });
            optLabel.appendChild(radio);
            optLabel.appendChild(document.createTextNode(String(opt)));
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
    deps.modalEl.classList.remove('show');
    deps.modalEl.setAttribute('aria-hidden', 'true');
    extConfigExtId = '';
    extConfigValues = {};
  }

  function install() {
    deps.closeBtn.addEventListener('click', closeExtConfigModal);
    deps.cancelBtn.addEventListener('click', closeExtConfigModal);
    deps.modalEl.addEventListener('click', (ev) => {
      if (ev.target === deps.modalEl) closeExtConfigModal();
    });
    deps.saveBtn.addEventListener('click', async () => {
      if (!extConfigExtId) return;
      deps.saveBtn.disabled = true;
      try {
        const res = await deps.busRequest('ext:configure', {
          ext_id: extConfigExtId,
          values: extConfigValues,
        }, 15000);
        if (res?.payload?.ok) {
          deps.toast('Configuration saved — reloading adapter…');
          closeExtConfigModal();
          void deps.refreshExtManager();
          deps.reloadEditorIframe();
        } else {
          deps.toast(res?.payload?.error || 'Save failed');
        }
      } catch (e) {
        deps.toast(/** @type {any} */ (e)?.message || 'Save failed');
      } finally {
        deps.saveBtn.disabled = false;
      }
    });
  }

  return { openExtConfigModal, closeExtConfigModal, install };
}

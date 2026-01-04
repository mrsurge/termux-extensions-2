export function initAndroidModal(ctx) {
  const { host, openFile, pickFile, pickDirectory, closeAllMenus } = ctx;

  const androidConfigModal = {
    root: document.getElementById('android-config-modal'),
    closeBtn: document.getElementById('android-config-close'),
    files: document.getElementById('android-config-files'),
    projectRoot: document.getElementById('android-config-project-root'),
    effectiveRoot: document.getElementById('android-config-effective-root'),
    moduleInput: document.getElementById('android-config-module-input'),
    moduleBtn: document.getElementById('android-config-module-btn'),
    moduleDD: document.getElementById('android-config-module-dd'),
    variantsInput: document.getElementById('android-config-variants'),
    sdkDirInput: document.getElementById('android-config-sdk-dir'),
    sdkPickBtn: document.getElementById('android-config-sdk-pick'),
    aapt2Input: document.getElementById('android-config-aapt2'),
    aapt2PickBtn: document.getElementById('android-config-aapt2-pick'),
    aapt2TermuxBtn: document.getElementById('android-config-aapt2-termux'),
    compileSdkInput: document.getElementById('android-config-compile-sdk'),
    minSdkInput: document.getElementById('android-config-min-sdk'),
    targetSdkInput: document.getElementById('android-config-target-sdk'),
    minifyInput: document.getElementById('android-config-minify'),
    shrinkInput: document.getElementById('android-config-shrink'),
    abiEnableInput: document.getElementById('android-config-abi-enable'),
    abiUniversalInput: document.getElementById('android-config-abi-universal'),
    abiIncludeInput: document.getElementById('android-config-abi-include'),
    sourceSets: document.getElementById('android-config-sourcesets'),
    sourceSetName: document.getElementById('android-config-sourceset-name'),
    sourceSetKindBtn: document.getElementById('android-config-sourceset-kind-btn'),
    sourceSetKindLabel: document.getElementById('android-config-sourceset-kind-label'),
    sourceSetKindDD: document.getElementById('android-config-sourceset-kind-dd'),
    sourceSetCreateBtn: document.getElementById('android-config-sourceset-create'),
    sourceSetCode: document.getElementById('android-config-sourceset-code'),
    sourceSetRes: document.getElementById('android-config-sourceset-res'),
    sourceSetManifest: document.getElementById('android-config-sourceset-manifest'),
    variantName: document.getElementById('android-config-variant-name'),
    variantTypeBtn: document.getElementById('android-config-variant-type-btn'),
    variantTypeLabel: document.getElementById('android-config-variant-type-label'),
    variantTypeDD: document.getElementById('android-config-variant-type-dd'),
    variantDimension: document.getElementById('android-config-variant-dimension'),
    variantCreateBtn: document.getElementById('android-config-variant-create'),
    variantCreateSources: document.getElementById('android-config-variant-create-sources'),
    gradlePropsGrid: document.getElementById('android-config-gradle-props'),
    missingNote: document.getElementById('android-config-missing'),
    createMissingInput: document.getElementById('android-config-create-missing'),
    refreshBtn: document.getElementById('android-config-refresh'),
    saveBtn: document.getElementById('android-config-save'),
  };

  const androidConfigState = {
    data: null,
    modules: [],
    termuxAapt2Path: '',
    gradlePropKeys: [],
    sourceSetKind: 'variant',
    variantType: 'buildType',
  };

  const ANDROID_FILE_LABELS = [
    { key: 'gradleProperties', label: 'gradle.properties' },
    { key: 'localProperties', label: 'local.properties' },
    { key: 'settingsGradle', label: 'settings.gradle(.kts)' },
    { key: 'rootBuildGradle', label: 'build.gradle(.kts) (root)' },
    { key: 'moduleBuildGradle', label: 'build.gradle(.kts) (module)' },
    { key: 'versionsCatalog', label: 'gradle/libs.versions.toml' },
  ];

  function _setAndroidInput(el, value) {
    if (!el) return;
    el.value = value == null ? '' : String(value);
    _autoGrowField(el);
  }

  function _autoGrowField(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function _renderAndroidFiles(files) {
    if (!androidConfigModal.files) return;
    androidConfigModal.files.innerHTML = '';
    ANDROID_FILE_LABELS.forEach((entry) => {
      const info = files?.[entry.key] || {};
      const row = document.createElement('div');
      row.className = 'android-config-file';

      const label = document.createElement('div');
      label.textContent = entry.label;
      row.appendChild(label);

      const status = document.createElement('div');
      status.className = 'status';
      status.textContent = info.exists ? 'Found' : 'Missing';
      if (info.path) status.title = info.path;
      row.appendChild(status);

      const btn = document.createElement('button');
      btn.className = 'fe-btn fe-btn-secondary';
      btn.textContent = 'Open';
      btn.disabled = !info.exists || !info.path;
      if (info.exists && info.path) {
        btn.addEventListener('click', async () => {
          await openFile(info.path);
        });
      }
      androidConfigModal.files.appendChild(row);
      androidConfigModal.files.appendChild(btn);
    });
  }

  function _populateAndroidGradleProps(props, keys) {
    if (!androidConfigModal.gradlePropsGrid) return;
    androidConfigModal.gradlePropsGrid.innerHTML = '';
    androidConfigState.gradlePropKeys = Array.isArray(keys) ? keys.slice() : [];
    androidConfigState.gradlePropKeys.forEach((key) => {
      if (key === 'android.aapt2FromMavenOverride') return;
      const label = document.createElement('label');
      label.textContent = key;
      const input = document.createElement('input');
      input.className = 'android-config-input';
      input.type = 'text';
      input.dataset.propKey = key;
      input.value = props?.[key] ?? '';
      androidConfigModal.gradlePropsGrid.appendChild(label);
      androidConfigModal.gradlePropsGrid.appendChild(input);
    });
  }

  function _populateAndroidConfig(data) {
    androidConfigState.data = data || null;
    const files = data?.files || {};
    _renderAndroidFiles(files);

    _setAndroidInput(androidConfigModal.projectRoot, data?.projectRoot || '');
    _setAndroidInput(androidConfigModal.effectiveRoot, data?.effectiveRoot || '');

    androidConfigState.modules = Array.isArray(data?.modules) ? data.modules.slice() : [];
    androidConfigState.termuxAapt2Path = data?.termuxAapt2Path || '';
    const moduleValue = data?.module || 'app';
    _setAndroidInput(androidConfigModal.moduleInput, moduleValue);

    const variants = data?.variants?.variants || [];
    _setAndroidInput(androidConfigModal.variantsInput, variants.join(', '));

    const localProps = data?.localProperties || {};
    _setAndroidInput(androidConfigModal.sdkDirInput, localProps['sdk.dir'] || '');

    const gradleProps = data?.gradleProperties || {};
    _setAndroidInput(androidConfigModal.aapt2Input, gradleProps['android.aapt2FromMavenOverride'] || '');

    const buildCfg = data?.buildConfig || {};
    _setAndroidInput(androidConfigModal.compileSdkInput, buildCfg.compileSdk ?? '');
    _setAndroidInput(androidConfigModal.minSdkInput, buildCfg.minSdk ?? '');
    _setAndroidInput(androidConfigModal.targetSdkInput, buildCfg.targetSdk ?? '');
    if (androidConfigModal.minifyInput) androidConfigModal.minifyInput.checked = !!buildCfg.minifyEnabled;
    if (androidConfigModal.shrinkInput) androidConfigModal.shrinkInput.checked = !!buildCfg.shrinkResources;

    const abi = buildCfg.abi || {};
    if (androidConfigModal.abiEnableInput) androidConfigModal.abiEnableInput.checked = !!abi.enable;
    if (androidConfigModal.abiUniversalInput) androidConfigModal.abiUniversalInput.checked = !!abi.universalApk;
    _setAndroidInput(androidConfigModal.abiIncludeInput, Array.isArray(abi.include) ? abi.include.join(', ') : '');

    _populateAndroidGradleProps(gradleProps, data?.importantGradleProperties || []);
    _renderSourceSets(data?.sourceSets);

    if (androidConfigModal.missingNote) {
      androidConfigModal.missingNote.style.display = 'none';
      androidConfigModal.missingNote.textContent = '';
    }
  }

  function _renderAndroidModuleDropdown() {
    if (!androidConfigModal.moduleDD) return;
    androidConfigModal.moduleDD.innerHTML = '';
    const modules = androidConfigState.modules || [];
    if (!modules.length) {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.textContent = 'No modules detected';
      androidConfigModal.moduleDD.appendChild(item);
      return;
    }
    modules.forEach((mod) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.textContent = mod;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        androidConfigModal.moduleDD.classList.remove('show');
        if (androidConfigModal.moduleInput) {
          androidConfigModal.moduleInput.value = mod;
        }
      });
      androidConfigModal.moduleDD.appendChild(item);
    });
  }

  function _renderSourceSetKindDropdown() {
    if (!androidConfigModal.sourceSetKindDD) return;
    androidConfigModal.sourceSetKindDD.innerHTML = '';
    const items = [
      { value: 'buildType', label: 'Build type' },
      { value: 'flavor', label: 'Flavor' },
      { value: 'variant', label: 'Variant' },
    ];
    items.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.textContent = entry.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        androidConfigState.sourceSetKind = entry.value;
        if (androidConfigModal.sourceSetKindLabel) {
          androidConfigModal.sourceSetKindLabel.textContent = entry.label;
        }
        androidConfigModal.sourceSetKindDD.classList.remove('show');
      });
      androidConfigModal.sourceSetKindDD.appendChild(item);
    });
    if (androidConfigModal.sourceSetKindLabel) {
      const current = items.find((i) => i.value === androidConfigState.sourceSetKind) || items[2];
      androidConfigModal.sourceSetKindLabel.textContent = current.label;
    }
  }

  function _applyVariantTypeUI() {
    const isFlavor = androidConfigState.variantType === 'flavor';
    if (androidConfigModal.variantDimension) {
      androidConfigModal.variantDimension.disabled = !isFlavor;
      if (!isFlavor) androidConfigModal.variantDimension.value = '';
    }
  }

  function _renderVariantTypeDropdown() {
    if (!androidConfigModal.variantTypeDD) return;
    androidConfigModal.variantTypeDD.innerHTML = '';
    const items = [
      { value: 'buildType', label: 'Build type' },
      { value: 'flavor', label: 'Flavor' },
    ];
    items.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.textContent = entry.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        androidConfigState.variantType = entry.value;
        if (androidConfigModal.variantTypeLabel) {
          androidConfigModal.variantTypeLabel.textContent = entry.label;
        }
        androidConfigModal.variantTypeDD.classList.remove('show');
        _applyVariantTypeUI();
      });
      androidConfigModal.variantTypeDD.appendChild(item);
    });
    if (androidConfigModal.variantTypeLabel) {
      const current = items.find((i) => i.value === androidConfigState.variantType) || items[0];
      androidConfigModal.variantTypeLabel.textContent = current.label;
    }
    _applyVariantTypeUI();
  }

  function _renderSourceSets(sourceSets) {
    if (!androidConfigModal.sourceSets) return;
    androidConfigModal.sourceSets.innerHTML = '';
    const list = Array.isArray(sourceSets) ? sourceSets : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'android-config-sourceset';
      empty.textContent = 'None detected';
      androidConfigModal.sourceSets.appendChild(empty);
      return;
    }
    list.forEach((name) => {
      const chip = document.createElement('div');
      chip.className = 'android-config-sourceset';
      chip.textContent = name;
      androidConfigModal.sourceSets.appendChild(chip);
    });
  }

  async function _fetchAndroidConfig() {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/android/config', { cache: 'no-store' });
      const json = await resp.json();
      if (json && json.ok) return json.data || null;
    } catch (_) { }
    return null;
  }

  async function showAndroidConfigModal() {
    if (!androidConfigModal.root) return;
    androidConfigModal.root.classList.add('show');
    androidConfigModal.root.setAttribute('aria-hidden', 'false');
    const data = await _fetchAndroidConfig();
    if (!data) {
      host.toast('Failed to load Android config');
      return;
    }
    _populateAndroidConfig(data);
    _renderAndroidModuleDropdown();
    _renderSourceSetKindDropdown();
    _renderVariantTypeDropdown();
  }

  function hideAndroidConfigModal() {
    if (!androidConfigModal.root) return;
    androidConfigModal.root.classList.remove('show');
    androidConfigModal.root.setAttribute('aria-hidden', 'true');
  }

  function _collectAndroidGradleProps() {
    const props = {};
    const baseline = androidConfigState.data?.gradleProperties || {};
    const inputs = androidConfigModal.gradlePropsGrid?.querySelectorAll('input[data-prop-key]') || [];
    inputs.forEach((input) => {
      const key = input.dataset.propKey;
      const value = input.value.trim();
      const base = String(baseline[key] ?? '');
      if (value && value !== base) props[key] = value;
    });
    const aapt2Val = androidConfigModal.aapt2Input?.value?.trim() || '';
    const baseAapt2 = String(baseline['android.aapt2FromMavenOverride'] ?? '');
    if (aapt2Val && aapt2Val !== baseAapt2) {
      props['android.aapt2FromMavenOverride'] = aapt2Val;
    }
    return props;
  }

  function _collectAndroidBuildGradle() {
    const baseline = androidConfigState.data?.buildConfig || {};
    const updates = {};
    const compileSdk = androidConfigModal.compileSdkInput?.value?.trim() || '';
    if (compileSdk) {
      const val = parseInt(compileSdk, 10);
      if (!Number.isNaN(val) && val !== baseline.compileSdk) updates.compileSdk = val;
    }
    const minSdk = androidConfigModal.minSdkInput?.value?.trim() || '';
    if (minSdk) {
      const val = parseInt(minSdk, 10);
      if (!Number.isNaN(val) && val !== baseline.minSdk) updates.minSdk = val;
    }
    const targetSdk = androidConfigModal.targetSdkInput?.value?.trim() || '';
    if (targetSdk) {
      const val = parseInt(targetSdk, 10);
      if (!Number.isNaN(val) && val !== baseline.targetSdk) updates.targetSdk = val;
    }
    const minify = androidConfigModal.minifyInput ? androidConfigModal.minifyInput.checked : null;
    if (minify !== null && minify !== baseline.minifyEnabled) {
      if (baseline.minifyEnabled !== undefined || minify) updates.minifyEnabled = minify;
    }
    const shrink = androidConfigModal.shrinkInput ? androidConfigModal.shrinkInput.checked : null;
    if (shrink !== null && shrink !== baseline.shrinkResources) {
      if (baseline.shrinkResources !== undefined || shrink) updates.shrinkResources = shrink;
    }

    const abiUpdates = {};
    const abiBaseline = baseline.abi || {};
    const abiEnable = androidConfigModal.abiEnableInput ? androidConfigModal.abiEnableInput.checked : null;
    if (abiEnable !== null && abiEnable !== abiBaseline.enable) {
      if (abiBaseline.enable !== undefined || abiEnable) abiUpdates.enable = abiEnable;
    }
    const abiUniversal = androidConfigModal.abiUniversalInput ? androidConfigModal.abiUniversalInput.checked : null;
    if (abiUniversal !== null && abiUniversal !== abiBaseline.universalApk) {
      if (abiBaseline.universalApk !== undefined || abiUniversal) abiUpdates.universalApk = abiUniversal;
    }
    const abiIncludeRaw = androidConfigModal.abiIncludeInput?.value || '';
    const abiInclude = abiIncludeRaw.split(',').map((x) => x.trim()).filter(Boolean);
    if (abiInclude.length) {
      const baseIncl = Array.isArray(abiBaseline.include) ? abiBaseline.include.join(',') : '';
      if (abiInclude.join(',') !== baseIncl) abiUpdates.include = abiInclude;
    }
    if (Object.keys(abiUpdates).length) updates.abi = abiUpdates;
    return updates;
  }

  async function _saveAndroidConfig() {
    const module = androidConfigModal.moduleInput?.value?.trim() || androidConfigState.data?.module || 'app';
    const gradleProps = _collectAndroidGradleProps();
    const localProps = {};
    const baselineLocal = androidConfigState.data?.localProperties || {};
    const sdkDir = androidConfigModal.sdkDirInput?.value?.trim() || '';
    if (sdkDir && sdkDir !== String(baselineLocal['sdk.dir'] ?? '')) {
      localProps.sdkDir = sdkDir;
    }

    const buildGradle = _collectAndroidBuildGradle();
    const createMissing = !!androidConfigModal.createMissingInput?.checked;
    const payload = {
      module,
      createMissing,
      gradleProperties: gradleProps,
      localProperties: localProps,
      buildGradle: buildGradle,
    };

    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/android/config/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!json || !json.ok) {
        host.toast('Failed to save Android config');
        return;
      }
      const results = json.data?.results || {};
      const missing = results.buildGradle?.missing || [];
      if (androidConfigModal.missingNote) {
        if (missing.length) {
          androidConfigModal.missingNote.textContent = `Fields not found in build.gradle: ${missing.join(', ')}`;
          androidConfigModal.missingNote.style.display = 'block';
        } else {
          androidConfigModal.missingNote.style.display = 'none';
        }
      }
      _populateAndroidConfig(json.data?.config || {});
      _renderAndroidModuleDropdown();
      host.toast('Android config saved');
    } catch (_) {
      host.toast('Failed to save Android config');
    }
  }

  async function _createAndroidSourceSet() {
    const name = androidConfigModal.sourceSetName?.value?.trim() || '';
    if (!name) {
      host.toast('Source set name required');
      return;
    }
    const module = androidConfigModal.moduleInput?.value?.trim() || androidConfigState.data?.module || 'app';
    const payload = {
      name,
      kind: androidConfigState.sourceSetKind || 'variant',
      module,
      include: {
        code: !!androidConfigModal.sourceSetCode?.checked,
        res: !!androidConfigModal.sourceSetRes?.checked,
        manifest: !!androidConfigModal.sourceSetManifest?.checked,
      },
    };
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/android/source_set/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!json || !json.ok) {
        host.toast('Failed to create source set');
        return;
      }
      _populateAndroidConfig(json.data?.config || {});
      _renderAndroidModuleDropdown();
      if (androidConfigModal.sourceSetName) androidConfigModal.sourceSetName.value = '';
      host.toast('Source set created');
    } catch (_) {
      host.toast('Failed to create source set');
    }
  }

  async function _createAndroidVariant() {
    const name = androidConfigModal.variantName?.value?.trim() || '';
    if (!name) {
      host.toast('Variant name required');
      return;
    }
    const module = androidConfigModal.moduleInput?.value?.trim() || androidConfigState.data?.module || 'app';
    const payload = {
      name,
      type: androidConfigState.variantType || 'buildType',
      module,
      dimension: androidConfigModal.variantDimension?.value?.trim() || '',
      createSourceSet: !!androidConfigModal.variantCreateSources?.checked,
    };
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/android/variant/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!json || !json.ok) {
        host.toast('Failed to add variant');
        return;
      }
      _populateAndroidConfig(json.data?.config || {});
      _renderAndroidModuleDropdown();
      if (androidConfigModal.variantName) androidConfigModal.variantName.value = '';
      host.toast('Variant added');
    } catch (_) {
      host.toast('Failed to add variant');
    }
  }

  function closeMenus() {
    if (androidConfigModal.moduleDD) androidConfigModal.moduleDD.classList.remove('show');
    if (androidConfigModal.sourceSetKindDD) androidConfigModal.sourceSetKindDD.classList.remove('show');
    if (androidConfigModal.variantTypeDD) androidConfigModal.variantTypeDD.classList.remove('show');
  }

  function bindControls(lspModal) {
    if (lspModal?.configKotlinAndroid) {
      lspModal.configKotlinAndroid.addEventListener('click', showAndroidConfigModal);
    }
    if (androidConfigModal.closeBtn) androidConfigModal.closeBtn.addEventListener('click', hideAndroidConfigModal);
    if (androidConfigModal.root) {
      androidConfigModal.root.addEventListener('click', (evt) => {
        if (evt.target === androidConfigModal.root) hideAndroidConfigModal();
      });
    }
    if (androidConfigModal.moduleBtn && androidConfigModal.moduleDD) {
      androidConfigModal.moduleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = androidConfigModal.moduleDD;
        const wasOpen = dd.classList.contains('show');
        closeAllMenus();
        if (!wasOpen) dd.classList.add('show');
      });
    }
    if (androidConfigModal.sourceSetKindBtn && androidConfigModal.sourceSetKindDD) {
      androidConfigModal.sourceSetKindBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = androidConfigModal.sourceSetKindDD;
        const wasOpen = dd.classList.contains('show');
        closeAllMenus();
        if (!wasOpen) dd.classList.add('show');
      });
    }
    if (androidConfigModal.variantTypeBtn && androidConfigModal.variantTypeDD) {
      androidConfigModal.variantTypeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = androidConfigModal.variantTypeDD;
        const wasOpen = dd.classList.contains('show');
        closeAllMenus();
        if (!wasOpen) dd.classList.add('show');
      });
    }
    if (androidConfigModal.refreshBtn) {
      androidConfigModal.refreshBtn.addEventListener('click', async () => {
        const data = await _fetchAndroidConfig();
        if (!data) {
          host.toast('Failed to refresh Android config');
          return;
        }
        _populateAndroidConfig(data);
        _renderAndroidModuleDropdown();
      });
    }
    if (androidConfigModal.saveBtn) androidConfigModal.saveBtn.addEventListener('click', _saveAndroidConfig);
    if (androidConfigModal.sourceSetCreateBtn) {
      androidConfigModal.sourceSetCreateBtn.addEventListener('click', _createAndroidSourceSet);
    }
    if (androidConfigModal.variantCreateBtn) {
      androidConfigModal.variantCreateBtn.addEventListener('click', _createAndroidVariant);
    }
    if (androidConfigModal.sdkPickBtn) {
      androidConfigModal.sdkPickBtn.addEventListener('click', async () => {
        const start = androidConfigModal.sdkDirInput?.value || androidConfigState.data?.projectRoot || '';
        const dir = await pickDirectory(start);
        if (dir && androidConfigModal.sdkDirInput) androidConfigModal.sdkDirInput.value = dir;
      });
    }
    if (androidConfigModal.aapt2PickBtn) {
      androidConfigModal.aapt2PickBtn.addEventListener('click', async () => {
        const start = androidConfigModal.aapt2Input?.value || androidConfigState.data?.projectRoot || '';
        const file = await pickFile(start);
        if (file && androidConfigModal.aapt2Input) androidConfigModal.aapt2Input.value = file;
      });
    }
    if (androidConfigModal.aapt2TermuxBtn) {
      androidConfigModal.aapt2TermuxBtn.addEventListener('click', () => {
        if (androidConfigModal.aapt2Input) androidConfigModal.aapt2Input.value = androidConfigState.termuxAapt2Path || '';
        _autoGrowField(androidConfigModal.aapt2Input);
      });
    }
    [
      androidConfigModal.projectRoot,
      androidConfigModal.effectiveRoot,
      androidConfigModal.moduleInput,
      androidConfigModal.variantsInput,
      androidConfigModal.sdkDirInput,
      androidConfigModal.aapt2Input,
      androidConfigModal.abiIncludeInput,
    ].forEach((field) => {
      if (!field || field.tagName !== 'TEXTAREA') return;
      field.addEventListener('input', () => _autoGrowField(field));
      _autoGrowField(field);
    });
  }

  return {
    showModal: showAndroidConfigModal,
    bindControls,
    closeMenus,
  };
}

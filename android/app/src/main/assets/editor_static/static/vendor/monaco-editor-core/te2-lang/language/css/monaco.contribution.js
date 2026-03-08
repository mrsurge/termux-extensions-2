// src/language/css/monaco.contribution.ts
import { languages, Emitter } from "monaco-editor-core";
var LanguageServiceDefaultsImpl = class {
  constructor(languageId, options, modeConfiguration) {
    this._onDidChange = new Emitter();
    this._languageId = languageId;
    this.setOptions(options);
    this.setModeConfiguration(modeConfiguration);
  }
  get onDidChange() {
    return this._onDidChange.event;
  }
  get languageId() {
    return this._languageId;
  }
  get modeConfiguration() {
    return this._modeConfiguration;
  }
  get diagnosticsOptions() {
    return this.options;
  }
  get options() {
    return this._options;
  }
  setOptions(options) {
    this._options = options || /* @__PURE__ */ Object.create(null);
    this._onDidChange.fire(this);
  }
  setDiagnosticsOptions(options) {
    this.setOptions(options);
  }
  setModeConfiguration(modeConfiguration) {
    this._modeConfiguration = modeConfiguration || /* @__PURE__ */ Object.create(null);
    this._onDidChange.fire(this);
  }
};
var optionsDefault = {
  validate: true,
  lint: {
    compatibleVendorPrefixes: "ignore",
    vendorPrefix: "warning",
    duplicateProperties: "warning",
    emptyRules: "warning",
    importStatement: "ignore",
    boxModel: "ignore",
    universalSelector: "ignore",
    zeroUnits: "ignore",
    fontFaceProperties: "warning",
    hexColorLength: "error",
    argumentsInColorFunction: "error",
    unknownProperties: "warning",
    ieHack: "ignore",
    unknownVendorSpecificProperties: "ignore",
    propertyIgnoredDueToDisplay: "warning",
    important: "ignore",
    float: "ignore",
    idSelector: "ignore"
  },
  data: { useDefaultDataProvider: true },
  format: {
    newlineBetweenSelectors: true,
    newlineBetweenRules: true,
    spaceAroundSelectorSeparator: false,
    braceStyle: "collapse",
    maxPreserveNewLines: void 0,
    preserveNewLines: true
  }
};
var modeConfigurationDefault = {
  completionItems: true,
  hovers: true,
  documentSymbols: true,
  definitions: true,
  references: true,
  documentHighlights: true,
  rename: true,
  colors: true,
  foldingRanges: true,
  diagnostics: true,
  selectionRanges: true,
  documentFormattingEdits: true,
  documentRangeFormattingEdits: true
};
var cssDefaults = new LanguageServiceDefaultsImpl(
  "css",
  optionsDefault,
  modeConfigurationDefault
);
var scssDefaults = new LanguageServiceDefaultsImpl(
  "scss",
  optionsDefault,
  modeConfigurationDefault
);
var lessDefaults = new LanguageServiceDefaultsImpl(
  "less",
  optionsDefault,
  modeConfigurationDefault
);
function getMode() {
  return import("../../chunk-U6WZ436B.js");
}
languages.onLanguage("less", () => {
  getMode().then((mode) => mode.setupMode(lessDefaults));
});
languages.onLanguage("scss", () => {
  getMode().then((mode) => mode.setupMode(scssDefaults));
});
languages.onLanguage("css", () => {
  getMode().then((mode) => mode.setupMode(cssDefaults));
});
export {
  cssDefaults,
  lessDefaults,
  scssDefaults
};
//# sourceMappingURL=monaco.contribution.js.map

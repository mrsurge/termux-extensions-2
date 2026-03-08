// src/language/json/monaco.contribution.ts
import { Emitter, languages } from "monaco-editor-core";
var LanguageServiceDefaultsImpl = class {
  constructor(languageId, diagnosticsOptions, modeConfiguration) {
    this._onDidChange = new Emitter();
    this._languageId = languageId;
    this.setDiagnosticsOptions(diagnosticsOptions);
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
    return this._diagnosticsOptions;
  }
  setDiagnosticsOptions(options) {
    this._diagnosticsOptions = options || /* @__PURE__ */ Object.create(null);
    this._onDidChange.fire(this);
  }
  setModeConfiguration(modeConfiguration) {
    this._modeConfiguration = modeConfiguration || /* @__PURE__ */ Object.create(null);
    this._onDidChange.fire(this);
  }
};
var diagnosticDefault = {
  validate: true,
  allowComments: true,
  schemas: [],
  enableSchemaRequest: false,
  schemaRequest: "warning",
  schemaValidation: "warning",
  comments: "error",
  trailingCommas: "error"
};
var modeConfigurationDefault = {
  documentFormattingEdits: true,
  documentRangeFormattingEdits: true,
  completionItems: true,
  hovers: true,
  documentSymbols: true,
  tokens: true,
  colors: true,
  foldingRanges: true,
  diagnostics: true,
  selectionRanges: true
};
var jsonDefaults = new LanguageServiceDefaultsImpl(
  "json",
  diagnosticDefault,
  modeConfigurationDefault
);
var getWorker = () => getMode().then((mode) => mode.getWorker());
function getMode() {
  return import("../../chunk-DA7HCPVO.js");
}
languages.register({
  id: "json",
  extensions: [".json", ".bowerrc", ".jshintrc", ".jscsrc", ".eslintrc", ".babelrc", ".har"],
  aliases: ["JSON", "json"],
  mimetypes: ["application/json"]
});
languages.onLanguage("json", () => {
  getMode().then((mode) => mode.setupMode(jsonDefaults));
});
export {
  getWorker,
  jsonDefaults
};
//# sourceMappingURL=monaco.contribution.js.map

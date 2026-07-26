type ExtensionRecord = Record<string, unknown>;

type ActivationEventGenerator = (
  contributions: readonly unknown[],
) => Iterable<string>;

function isRecord(value: unknown): value is ExtensionRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function contributionArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function identifierValue(extension: ExtensionRecord): string {
  const identifier = extension.identifier;
  if (typeof identifier === "string") return identifier.toLowerCase();
  if (isRecord(identifier)) {
    const value = stringField(identifier, "value") ?? stringField(identifier, "id");
    if (value) return value.toLowerCase();
  }
  return String(extension.id ?? extension.extensionId ?? "").toLowerCase();
}

function* fieldEvents(
  contributions: readonly unknown[],
  field: string,
  prefix: string,
): Iterable<string> {
  for (const contribution of contributions) {
    const value = stringField(contribution, field);
    if (value) yield `${prefix}${value}`;
  }
}

const IMPLICIT_ACTIVATION_GENERATORS: Readonly<
  Record<string, ActivationEventGenerator>
> = {
  authentication: (contributions) =>
    fieldEvents(contributions, "id", "onAuthenticationRequest:"),
  chatContext: (contributions) =>
    fieldEvents(contributions, "id", "onChatContextProvider:"),
  chatOutputRenderers: (contributions) =>
    fieldEvents(contributions, "viewType", "onChatOutputRenderer:"),
  chatParticipants: (contributions) =>
    fieldEvents(contributions, "id", "onChatParticipant:"),
  chatSessions: (contributions) =>
    fieldEvents(contributions, "type", "onChatSession:"),
  commands: (contributions) =>
    fieldEvents(contributions, "command", "onCommand:"),
  customEditors: (contributions) =>
    fieldEvents(contributions, "viewType", "onCustomEditor:"),
  debugVisualizers: (contributions) =>
    fieldEvents(contributions, "id", "onDebugVisualizer:"),
  languageModelChatProviders: (contributions) =>
    fieldEvents(
      contributions,
      "vendor",
      "onLanguageModelChatProvider:",
    ),
  languageModelTools: (contributions) =>
    fieldEvents(contributions, "name", "onLanguageModelTool:"),
  languages: function* (contributions) {
    for (const contribution of contributions) {
      const id = stringField(contribution, "id");
      const configuration = stringField(contribution, "configuration");
      if (id && configuration) yield `onLanguage:${id}`;
    }
  },
  mcpServerDefinitionProviders: (contributions) =>
    fieldEvents(contributions, "id", "onMcpCollection:"),
  notebookRenderer: (contributions) =>
    fieldEvents(contributions, "id", "onRenderer:"),
  notebooks: (contributions) =>
    fieldEvents(contributions, "type", "onNotebookSerializer:"),
  taskDefinitions: (contributions) =>
    fieldEvents(contributions, "type", "onTaskType:"),
  terminal: function* (contributions) {
    for (const contribution of contributions) {
      if (!isRecord(contribution)) continue;
      for (const profile of contribution.profiles ?? []) {
        const id = stringField(profile, "id");
        if (id) yield `onTerminalProfile:${id}`;
      }
    }
  },
  terminalQuickFixes: (contributions) =>
    fieldEvents(
      contributions,
      "id",
      "onTerminalQuickFixRequest:",
    ),
  views: function* (contributions) {
    for (const contribution of contributions) {
      if (!isRecord(contribution)) continue;
      for (const descriptors of Object.values(contribution)) {
        for (const descriptor of contributionArray(descriptors)) {
          const id = stringField(descriptor, "id");
          if (id) yield `onView:${id}`;
        }
      }
    }
  },
  walkthroughs: (contributions) =>
    fieldEvents(contributions, "id", "onWalkthrough:"),
};

export const IMPLICIT_ACTIVATION_EXTENSION_POINTS = Object.freeze(
  Object.keys(IMPLICIT_ACTIVATION_GENERATORS).sort(),
);

/**
 * Mirrors Code OSS implicit activation generation for the extension points
 * registered by the code-server source shipped with TE2.
 */
export function activationEventsForExtension(
  extension: ExtensionRecord,
): string[] {
  if (
    typeof extension.main !== "string" &&
    typeof extension.browser !== "string"
  ) {
    return [];
  }

  const extensionId = identifierValue(extension);
  const events: string[] = [];
  const seen = new Set<string>();
  const add = (event: unknown): void => {
    if (typeof event !== "string" || !event.trim()) return;
    const normalized =
      event === "onUri" && extensionId ? `onUri:${extensionId}` : event;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    events.push(normalized);
  };

  if (Array.isArray(extension.activationEvents)) {
    for (const event of extension.activationEvents) add(event);
  }

  const contributes = isRecord(extension.contributes)
    ? extension.contributes
    : null;
  if (!contributes) return events;

  for (const [extensionPoint, contribution] of Object.entries(contributes)) {
    const generator = IMPLICIT_ACTIVATION_GENERATORS[extensionPoint];
    if (!generator) continue;
    try {
      for (const event of generator(contributionArray(contribution))) {
        add(event);
      }
    } catch {
      // A malformed contribution must not suppress the extension's other events.
    }
  }
  return events;
}

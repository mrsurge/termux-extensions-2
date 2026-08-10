import fs from "node:fs/promises";
import path from "node:path";

import type { DecodedExtHostRpc } from "../protocol/wire-encoding";

interface CommandRpcIds {
  MainThreadCommands: number;
  MainThreadMessageService: number;
  ExtHostCommands: number;
}

interface CommandRuntimeOptions {
  rpcIds: CommandRpcIds;
  activateByEvent(event: string): Promise<unknown>;
  sendExtAwaitTerminalReply(
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable: boolean,
    timeoutMs: number,
  ): { req: number; promise: Promise<unknown> };
  uriForPath(filePath: string): Record<string, unknown>;
  syncSelection(params: ExtensionCommandContext): void;
  onEvent(payload: Record<string, unknown>): void;
  log(...args: unknown[]): void;
}

export interface ExtensionCommandContext extends Record<string, unknown> {
  path?: string;
  languageId?: string;
  selection?: Record<string, unknown> | null;
}

export interface ExtensionCommandAction extends Record<string, unknown> {
  command: string;
  title: string;
  category: string | null;
  extensionId: string;
  group: string | null;
  icon: string | null;
}

export interface MainThreadCommandResult {
  handled: boolean;
  replyResult?: unknown;
  pending?: Promise<unknown>;
  error?: unknown;
}

interface CommandDefinition {
  command: string;
  title: string;
  category: string | null;
  extensionId: string;
  extensionRoot: string | null;
  icon: unknown;
}

interface MenuDefinition {
  location: string;
  command: string;
  when: string | null;
  group: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extensionIdFrom(extension: Record<string, unknown>): string | null {
  const identifier = isRecord(extension.identifier) ? extension.identifier : null;
  return stringValue(identifier?.value) ?? stringValue(identifier?.id) ?? stringValue(extension.id);
}

function extensionRootFrom(extension: Record<string, unknown>): string | null {
  const location = isRecord(extension.extensionLocation)
    ? extension.extensionLocation
    : isRecord(extension.location)
      ? extension.location
      : null;
  return stringValue(location?.fsPath) ?? stringValue(location?.path);
}

function splitExpression(expression: string, operator: "||" | "&&"): string[] {
  const parts: string[] = [];
  let quote = "";
  let regex = false;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index] ?? "";
    const previous = expression[index - 1] ?? "";
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (regex) {
      if (char === "/" && previous !== "\\") regex = false;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "/" && expression.slice(0, index).trimEnd().endsWith("=~")) {
      regex = true;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && expression.slice(index, index + operator.length) === operator) {
      parts.push(expression.slice(start, index).trim());
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  parts.push(expression.slice(start).trim());
  return parts;
}

function contextValue(raw: string, context: Record<string, unknown>): unknown {
  const value = raw.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (Object.prototype.hasOwnProperty.call(context, value)) return context[value];
  return value;
}

function evaluateAtom(expression: string, context: Record<string, unknown>): boolean {
  let atom = expression.trim();
  if (atom.startsWith("(") && atom.endsWith(")")) {
    return evaluateWhenClause(atom.slice(1, -1), context);
  }
  if (!atom) return true;
  if (atom.startsWith("!")) return !evaluateAtom(atom.slice(1), context);

  const regexMatch = atom.match(/^([^\s]+)\s*=~\s*\/(.*)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[2] ?? "", regexMatch[3] ?? "").test(
        String(contextValue(regexMatch[1] ?? "", context) ?? ""),
      );
    } catch {
      return false;
    }
  }
  const comparison = atom.match(/^(.+?)\s*(===|!==|==|!=)\s*(.+)$/);
  if (comparison) {
    const left = contextValue(comparison[1] ?? "", context);
    const right = contextValue(comparison[3] ?? "", context);
    return comparison[2] === "==" || comparison[2] === "==="
      ? left === right
      : left !== right;
  }
  return Boolean(contextValue(atom, context));
}

export function evaluateWhenClause(
  expression: string | null,
  context: Record<string, unknown>,
): boolean {
  if (!expression) return true;
  const orParts = splitExpression(expression, "||");
  return orParts.some((orPart) =>
    splitExpression(orPart, "&&").every((andPart) => evaluateAtom(andPart, context)),
  );
}

function menuContext(params: ExtensionCommandContext): Record<string, unknown> {
  const filePath = stringValue(params.path) ?? "";
  const selection = isRecord(params.selection) ? params.selection : null;
  const startLine = Number(selection?.startLineNumber ?? 0);
  const startColumn = Number(selection?.startColumn ?? 0);
  const endLine = Number(selection?.endLineNumber ?? startLine);
  const endColumn = Number(selection?.endColumn ?? startColumn);
  const hasSelection = !!selection && (startLine !== endLine || startColumn !== endColumn);
  return {
    resourceExtname: path.extname(filePath),
    resourceFilename: path.basename(filePath),
    resourceDirname: path.dirname(filePath),
    resourceScheme: "file",
    editorLangId: stringValue(params.languageId) ?? "",
    editorHasSelection: hasSelection,
    editorTextFocus: true,
  };
}

function iconPath(icon: unknown): string | null {
  if (typeof icon === "string") return icon;
  if (!isRecord(icon)) return null;
  return stringValue(icon.dark) ?? stringValue(icon.light);
}

function iconMime(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return null;
  }
}

async function commandIconDataUrl(command: CommandDefinition): Promise<string | null> {
  const relative = iconPath(command.icon);
  if (!relative || !command.extensionRoot) return null;
  const root = path.resolve(command.extensionRoot);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  const mime = iconMime(candidate);
  if (!mime) return null;
  try {
    const payload = await fs.readFile(candidate);
    return `data:${mime};base64,${payload.toString("base64")}`;
  } catch {
    return null;
  }
}

function replyResult(reply: unknown): unknown {
  return isRecord(reply) && Object.prototype.hasOwnProperty.call(reply, "result")
    ? reply.result
    : undefined;
}

export class ExtensionCommandRuntime {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly menus = new Map<string, MenuDefinition[]>();
  private readonly registeredCommands = new Set<string>();

  constructor(private readonly options: CommandRuntimeOptions) {}

  reset(): void {
    this.registeredCommands.clear();
  }

  setExtensions(extensions: unknown[]): void {
    this.commands.clear();
    this.menus.clear();
    for (const rawExtension of extensions) {
      if (!isRecord(rawExtension)) continue;
      const extensionId = extensionIdFrom(rawExtension);
      const contributes = isRecord(rawExtension.contributes) ? rawExtension.contributes : null;
      if (!extensionId || !contributes) continue;
      const extensionRoot = extensionRootFrom(rawExtension);
      const rawCommands = Array.isArray(contributes.commands) ? contributes.commands : [];
      for (const rawCommand of rawCommands) {
        if (!isRecord(rawCommand)) continue;
        const command = stringValue(rawCommand.command);
        const title = stringValue(rawCommand.title);
        if (!command || !title) continue;
        this.commands.set(command, {
          command,
          title,
          category: stringValue(rawCommand.category),
          extensionId,
          extensionRoot,
          icon: rawCommand.icon,
        });
      }
      const rawMenus = isRecord(contributes.menus) ? contributes.menus : null;
      if (!rawMenus) continue;
      for (const [location, rawEntries] of Object.entries(rawMenus)) {
        if (!Array.isArray(rawEntries)) continue;
        const entries = this.menus.get(location) ?? [];
        for (const rawEntry of rawEntries) {
          if (!isRecord(rawEntry)) continue;
          const command = stringValue(rawEntry.command);
          if (!command) continue;
          entries.push({
            location,
            command,
            when: stringValue(rawEntry.when),
            group: stringValue(rawEntry.group),
          });
        }
        this.menus.set(location, entries);
      }
    }
  }

  handleMainThreadRequest(message: DecodedExtHostRpc): MainThreadCommandResult {
    if (message.rpcId === this.options.rpcIds.MainThreadCommands) {
      const command = stringValue(message.args?.[0]);
      switch (message.method) {
        case "$registerCommand":
          if (command) this.registeredCommands.add(command);
          return { handled: true };
        case "$unregisterCommand":
          if (command) this.registeredCommands.delete(command);
          return { handled: true };
        case "$fireCommandActivationEvent":
          return {
            handled: true,
            pending: command
              ? this.options.activateByEvent(`onCommand:${command}`).then(() => undefined)
              : Promise.resolve(undefined),
          };
        case "$getCommands":
          return { handled: true, replyResult: [...this.registeredCommands] };
        default:
          return {
            handled: true,
            error: new Error(`Unsupported MainThreadCommands method: ${String(message.method)}`),
          };
      }
    }

    if (message.rpcId === this.options.rpcIds.MainThreadMessageService) {
      if (message.method !== "$showMessage") {
        return {
          handled: true,
          error: new Error(`Unsupported MainThreadMessageService method: ${String(message.method)}`),
        };
      }
      const severity = Number(message.args?.[0]);
      const text = stringValue(message.args?.[1]) ?? "Extension message";
      this.options.onEvent({
        type: "extension/message",
        ts_ms: Date.now(),
        severity: severity >= 3 ? "error" : severity === 2 ? "warning" : "info",
        message: text,
        modal: isRecord(message.args?.[2]) && message.args?.[2]?.modal === true,
      });
      return { handled: true, replyResult: null };
    }

    return { handled: false };
  }

  async resolveMenu(params: ExtensionCommandContext): Promise<Record<string, unknown>> {
    const location = stringValue(params.menu) ?? "";
    if (!location) throw new Error("Missing required param: menu");
    const context = menuContext(params);
    const actions: ExtensionCommandAction[] = [];
    for (const entry of this.menus.get(location) ?? []) {
      if (!evaluateWhenClause(entry.when, context)) continue;
      const command = this.commands.get(entry.command);
      if (!command) continue;
      actions.push({
        command: command.command,
        title: command.title,
        category: command.category,
        extensionId: command.extensionId,
        group: entry.group,
        icon: await commandIconDataUrl(command),
      });
    }
    actions.sort((left, right) => String(left.group ?? "").localeCompare(String(right.group ?? "")));
    return { ok: true, menu: location, context, actions };
  }

  async execute(params: ExtensionCommandContext): Promise<Record<string, unknown>> {
    const commandId = stringValue(params.command);
    if (!commandId) throw new Error("Missing required param: command");
    const definition = this.commands.get(commandId);
    if (!definition) throw new Error(`Unknown extension command: ${commandId}`);
    const filePath = stringValue(params.path);
    this.options.syncSelection(params);
    await this.options.activateByEvent(`onCommand:${commandId}`);
    const explicitArguments = Array.isArray(params.arguments) ? params.arguments : null;
    const commandArguments = explicitArguments ?? (filePath ? [this.options.uriForPath(filePath)] : []);
    const pending = this.options.sendExtAwaitTerminalReply(
      this.options.rpcIds.ExtHostCommands,
      "$executeContributedCommand",
      [commandId, ...commandArguments],
      false,
      30000,
    );
    const reply = await pending.promise;
    this.options.log(`[extension-command] executed ${commandId} req=${pending.req}`);
    return { ok: true, command: commandId, result: replyResult(reply) };
  }
}

interface ExtensionNavigationEditorLike {
  focus?(): void;
  setSelections?(selections: Record<string, number>[]): void;
  revealRange?(range: Record<string, number>): void;
  revealRangeInCenter?(range: Record<string, number>): void;
  revealRangeInCenterIfOutsideViewport?(range: Record<string, number>): void;
  revealRangeAtTop?(range: Record<string, number>): void;
}

interface ExtensionNavigationRuntimeDeps {
  getCurrentPath(): string | null;
  getEditor(): ExtensionNavigationEditorLike | null;
  rpcCall(
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.trunc(numeric)) : fallback;
}

function rangeFrom(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const startLineNumber = positiveInteger(value.startLineNumber);
  const startColumn = positiveInteger(value.startColumn);
  return {
    startLineNumber,
    startColumn,
    endLineNumber: positiveInteger(value.endLineNumber, startLineNumber),
    endColumn: positiveInteger(value.endColumn, startColumn),
  };
}

function selectionFrom(value: unknown): Record<string, number> | null {
  const range = rangeFrom(value);
  if (!range || !isRecord(value)) return null;
  return {
    ...range,
    selectionStartLineNumber: positiveInteger(
      value.selectionStartLineNumber,
      range.startLineNumber,
    ),
    selectionStartColumn: positiveInteger(
      value.selectionStartColumn,
      range.startColumn,
    ),
    positionLineNumber: positiveInteger(
      value.positionLineNumber,
      range.endLineNumber,
    ),
    positionColumn: positiveInteger(value.positionColumn, range.endColumn),
  };
}

export function createEditorExtensionNavigationRuntime(
  deps: ExtensionNavigationRuntimeDeps,
) {
  async function acknowledge(
    operationId: string,
    ok: boolean,
    error?: unknown,
  ): Promise<void> {
    try {
      await deps.rpcCall(
        "vscode.editorOperation.complete",
        {
          operationId,
          ok,
          ...(ok
            ? {}
            : { error: error instanceof Error ? error.message : String(error) }),
        },
        { timeoutMs: 10000 },
      );
    } catch (ackError) {
      console.warn("[extension-navigation] operation acknowledgement failed", ackError);
    }
  }

  async function handle(payload: Record<string, unknown>): Promise<void> {
    const operationId = typeof payload.operationId === "string"
      ? payload.operationId
      : "";
    if (!operationId) return;
    try {
      const path = typeof payload.path === "string" ? payload.path : "";
      const editor = deps.getEditor();
      if (!path || path !== deps.getCurrentPath() || !editor) {
        throw new Error("Extension editor operation target is not active");
      }
      const operation = typeof payload.operation === "string"
        ? payload.operation
        : "";
      if (operation === "showEditor") {
        editor.focus?.();
      } else if (operation === "setSelections") {
        const selections = Array.isArray(payload.selections)
          ? payload.selections.map(selectionFrom).filter((item): item is Record<string, number> => item != null)
          : [];
        if (!selections.length || !editor.setSelections) {
          throw new Error("Extension selection payload is invalid");
        }
        editor.setSelections(selections);
        if (payload.revealSelection === true) {
          editor.revealRangeInCenterIfOutsideViewport?.(selections[0]);
        }
      } else if (operation === "revealRange") {
        const range = rangeFrom(payload.range);
        if (!range) throw new Error("Extension reveal range is invalid");
        const revealType = Number(payload.revealType);
        if (revealType === 1 && editor.revealRangeInCenter) {
          editor.revealRangeInCenter(range);
        } else if (revealType === 2 && editor.revealRangeInCenterIfOutsideViewport) {
          editor.revealRangeInCenterIfOutsideViewport(range);
        } else if (revealType === 3 && editor.revealRangeAtTop) {
          editor.revealRangeAtTop(range);
        } else if (editor.revealRange) {
          editor.revealRange(range);
        } else {
          throw new Error("The active editor cannot reveal a range");
        }
      } else {
        throw new Error(`Unsupported extension editor operation: ${operation}`);
      }
      await acknowledge(operationId, true);
    } catch (error) {
      await acknowledge(operationId, false, error);
    }
  }

  return { handle };
}

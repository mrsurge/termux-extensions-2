import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron";

type EditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "delete" | "selectAll";

export function textEditItems(contents: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
  const flags = params.editFlags;
  const canCopy = params.formControlType !== "input-password" && (flags.canCopy || Boolean(params.selectionText));
  const item = (command: EditCommand, label: string, enabled: boolean, accelerator?: string): MenuItemConstructorOptions => ({
    label, enabled, accelerator,
    click: () => { if (!contents.isDestroyed()) contents[command](); },
  });
  const copy = item("copy", "Copy", canCopy, "CmdOrCtrl+C");
  const selectAll = item("selectAll", "Select All", flags.canSelectAll, "CmdOrCtrl+A");
  if (!params.isEditable) {
    const textField = params.formControlType === "text-area" ||
      ["input-text", "input-search", "input-url", "input-email", "input-telephone", "input-number"].includes(params.formControlType);
    return canCopy || (textField && flags.canSelectAll) ? [copy, selectAll] : [];
  }
  return [
    item("undo", "Undo", flags.canUndo, "CmdOrCtrl+Z"),
    item("redo", "Redo", flags.canRedo, process.platform === "win32" ? "Ctrl+Y" : "CmdOrCtrl+Shift+Z"),
    { type: "separator" },
    item("cut", "Cut", flags.canCut && params.formControlType !== "input-password", "CmdOrCtrl+X"),
    copy,
    item("paste", "Paste", flags.canPaste, "CmdOrCtrl+V"),
    item("pasteAndMatchStyle", "Paste Without Formatting", flags.canPaste,
      process.platform === "darwin" ? "Cmd+Option+Shift+V" : "CmdOrCtrl+Shift+V"),
    item("delete", "Delete", flags.canDelete),
    { type: "separator" },
    selectAll,
  ];
}

export function installTextContextMenu(contents: WebContents, getOwner: () => BrowserWindow | null): void {
  contents.on("context-menu", async (event, params) => {
    const items = textEditItems(contents, params);
    if (!items.length) return;
    event.preventDefault();
    // A terminal owns this gesture even when it forwards mouse input to a TUI.
    const handled = await Promise.all(contents.mainFrame.framesInSubtree.map(frame =>
      frame.executeJavaScript("Date.now() - Number(document.documentElement.dataset.te2TerminalContextAt || 0) < 1000")
        .catch(() => false),
    ));
    if (contents.isDestroyed() || handled.some(Boolean)) return;
    const owner = getOwner();
    if (!owner || owner.isDestroyed()) return;
    contents.focus();
    Menu.buildFromTemplate(items).popup({ window: owner });
  });
}

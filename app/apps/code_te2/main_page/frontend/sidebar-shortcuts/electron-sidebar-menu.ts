export type ElectronSidebarMenuItem =
  | { type: "label"; label: string }
  | { type: "separator" }
  | { type: "item"; id: string; label: string; enabled: boolean };

interface ElectronSidebarMenuBridge {
  openSidebarMenu(request: {
    x: number;
    y: number;
    items: ElectronSidebarMenuItem[];
  }): Promise<{ selectedId: string | null }>;
}

interface ElectronSidebarMenuWindow extends Window {
  te2Electron?: ElectronSidebarMenuBridge;
}

function bridge(): ElectronSidebarMenuBridge | null {
  const candidate = (window as ElectronSidebarMenuWindow).te2Electron;
  return typeof candidate?.openSidebarMenu === "function" ? candidate : null;
}

export function hasElectronSidebarMenu(): boolean {
  return bridge() !== null;
}

export async function openElectronSidebarMenu(
  anchor: HTMLElement,
  items: ElectronSidebarMenuItem[],
): Promise<string | null> {
  const electron = bridge();
  if (!electron) throw new Error("Electron Sidebar menu bridge is unavailable");
  const rect = anchor.getBoundingClientRect();
  const result = await electron.openSidebarMenu({
    x: rect.left,
    y: rect.bottom + 4,
    items,
  });
  return typeof result?.selectedId === "string" ? result.selectedId : null;
}

import {
  SIDEBAR_IPC_RPC_NOTIFICATIONS,
  type SidebarIpcRpcNotificationMethod,
} from '../../src/sidebar_ipc/rpc_contract.ts';

export interface HostSidebarRuntimeDeps {
  drawerEl: HTMLElement;
  toggleButtonEl: HTMLElement | null;
  closeButtonEl: HTMLElement | null;
  emitSidebarRpcNotification?: (
    method: SidebarIpcRpcNotificationMethod,
    payload: Record<string, unknown>,
  ) => void;
}

export interface HostSidebarRuntime {
  install: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  getShortcutLoadDropdown: () => HTMLElement | null;
  getShortcutLoadButton: () => HTMLElement | null;
}

const DRAWER_STATE_EVENT = SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerState;
const DRAWER_OPEN_EVENTS: ReadonlySet<string> = new Set([SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerOpen]);
const DRAWER_CLOSE_EVENTS: ReadonlySet<string> = new Set([SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerClose]);
const DRAWER_TOGGLE_EVENTS: ReadonlySet<string> = new Set([SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerToggle]);

function getElementById(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeEventType(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isOpen(drawerEl: HTMLElement): boolean {
  return drawerEl.classList.contains('open');
}

export function createHostSidebarRuntime(deps: HostSidebarRuntimeDeps): HostSidebarRuntime {
  let installed = false;

  function publishState(open: boolean): void {
    try {
      deps.emitSidebarRpcNotification?.(DRAWER_STATE_EVENT, {
        open,
        source: 'main_page',
        ts: Date.now(),
      });
    } catch {}
  }

  function setDrawerOpen(open: boolean, options: { publish?: boolean } = {}): void {
    deps.drawerEl.classList.toggle('open', open);
    deps.drawerEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (options.publish !== false) publishState(open);
  }

  function openDrawer(): void {
    setDrawerOpen(true);
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
  }

  function toggleDrawer(): void {
    setDrawerOpen(!isOpen(deps.drawerEl));
  }

  function handleSidebarEvent(event: Event): void {
    const customEvent = event as CustomEvent<unknown>;
    const detail = isRecord(customEvent.detail) ? customEvent.detail : {};
    const type = normalizeEventType(detail.type);
    if (!type || type === DRAWER_STATE_EVENT) return;
    if (DRAWER_OPEN_EVENTS.has(type)) {
      setDrawerOpen(true, { publish: false });
      return;
    }
    if (DRAWER_CLOSE_EVENTS.has(type)) {
      setDrawerOpen(false, { publish: false });
      return;
    }
    if (DRAWER_TOGGLE_EVENTS.has(type)) {
      setDrawerOpen(!isOpen(deps.drawerEl), { publish: false });
    }
  }

  function install(): void {
    if (installed) return;
    installed = true;
    deps.toggleButtonEl?.addEventListener('click', (event) => {
      event.preventDefault();
      toggleDrawer();
    });
    deps.closeButtonEl?.addEventListener('click', (event) => {
      event.preventDefault();
      closeDrawer();
    });
    window.addEventListener('code-te2:sidebar-event', handleSidebarEvent);
  }

  return {
    install,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    getShortcutLoadDropdown: () => getElementById('agent-shortcut-load-dd'),
    getShortcutLoadButton: () => getElementById('agent-shortcut-load-btn'),
  };
}

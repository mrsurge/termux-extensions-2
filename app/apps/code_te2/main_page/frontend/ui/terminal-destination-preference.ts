import { androidTerminalDestination, isAndroidNativePage } from '../native-client-bridge.ts';
import { chooseTerminalDestination } from '../../../../../static/js/te_terminal_destination.mjs';
import { createCustomSelectControl } from './declarative-modal.ts';

export type TerminalDestination = 'ask' | 'drawer' | 'sidebar';
type NativeBridge = {
  readTerminalDestination?: () => Promise<unknown>;
  writeTerminalDestination?: (value: string) => Promise<unknown>;
};

function destination(value: unknown): TerminalDestination {
  if (value === 'ask' || value === 'drawer' || value === 'sidebar') return value;
  throw new Error('Invalid terminal destination preference');
}

export function createTerminalDestinationPreference(clientId: string) {
  // Native clients must never fall back to the relay's origin-local storage.
  const bridge = (window as unknown as { te2Electron?: NativeBridge }).te2Electron;
  const configuredOrigin = new URLSearchParams(window.location.search).get('te2_framework_origin');
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : window.location.origin;
  const key = `te2.terminal.destination.v1:${origin}:${clientId}`;
  let cached: TerminalDestination | null = null;
  let loading: Promise<TerminalDestination> | null = null;
  async function read(): Promise<TerminalDestination> {
    if (cached !== null) return cached;
    if (!loading) loading = (async () => {
      let value: unknown;
      if (bridge) {
        if (!bridge.readTerminalDestination) throw new Error('Update desktop client to use terminal preferences');
        value = await bridge.readTerminalDestination();
      } else if (isAndroidNativePage()) value = await androidTerminalDestination(clientId);
      else value = window.localStorage.getItem(key) || 'ask';
      cached = destination(value);
      return cached;
    })().finally(() => { loading = null; });
    return loading;
  }
  async function write(value: TerminalDestination): Promise<void> {
    destination(value);
    // Serialize with an in-flight first read so it cannot overwrite the new cache.
    if (loading) await loading;
    if (bridge) {
      if (!bridge.writeTerminalDestination) throw new Error('Update desktop client to use terminal preferences');
      await bridge.writeTerminalDestination(value);
    } else if (isAndroidNativePage()) await androidTerminalDestination(clientId, value);
    else window.localStorage.setItem(key, value);
    cached = value;
  }
  return { read, write };
}

export function installTerminalDestinationSettings(
  container: HTMLElement,
  preferences: ReturnType<typeof createTerminalDestinationPreference>,
  toast: (message: string) => void,
): () => Promise<void> {
  const control = createCustomSelectControl({
    document: container.ownerDocument, value: 'ask', ariaLabel: 'Terminal destination',
    options: [
      { value: 'ask', label: 'Ask every time' },
      { value: 'drawer', label: 'Drawer' },
      { value: 'sidebar', label: 'Sidebar' },
    ],
    onChange: async (value) => {
      control.setDisabled(true);
      try { await preferences.write(destination(value)); }
      catch (error) {
        toast(String(error));
        control.setValue(await preferences.read().catch(() => 'ask'));
      } finally { control.setDisabled(false); }
    },
  });
  container.replaceChildren(control.element);
  // Demand-load only for Settings or an explicit terminal intent, never page boot.
  return async () => {
    control.setDisabled(true);
    try { control.setValue(await preferences.read()); }
    catch (error) { toast(String(error)); }
    finally { control.setDisabled(false); }
  };
}

export async function resolveHostTerminalDestination(
  preferences: ReturnType<typeof createTerminalDestinationPreference>,
  toast: (message: string) => void,
): Promise<'drawer' | 'sidebar' | null> {
  return chooseTerminalDestination(window.teUI.dialog, {
    ...preferences,
    onError: error => toast(`Terminal choice could not be remembered: ${String(error)}`),
  });
}

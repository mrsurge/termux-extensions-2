import { chooseTerminalDestination as choose } from '../../../../../static/js/te_terminal_destination.mjs';
/** Shared app-owned choice; Cancel performs no launch/session mutation. */
export async function chooseTerminalDestination(): Promise<'sidebar' | 'drawer' | null> {
  return await choose(window.teUI.dialog);
}

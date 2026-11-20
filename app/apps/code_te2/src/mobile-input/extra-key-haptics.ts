import { touchHapticsEnabled } from './handle-feedback.ts';
import { bindSoftkeyHaptics } from '../../../../libs/terminal_runtime/softkey-haptics.ts';

/** One optional pulse per press, independent of key routing and hold repeats. */
export function bindExtraKeyHaptics(
  root: HTMLElement,
): () => void {
  return bindSoftkeyHaptics(root, touchHapticsEnabled);
}

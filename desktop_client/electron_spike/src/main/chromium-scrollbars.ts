import type { WebContents } from "electron";

import { CHROMIUM_SCROLLBAR_STYLE } from "../shared/chromium-scrollbars";

type StyleWebContents = Pick<WebContents, "insertCSS" | "isDestroyed">;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function installChromiumScrollbars(
  contents: StyleWebContents,
  surface: string,
): Promise<void> {
  if (contents.isDestroyed()) return;
  try {
    await contents.insertCSS(CHROMIUM_SCROLLBAR_STYLE, {
      cssOrigin: "author",
    });
  } catch (error) {
    console.warn(
      `[te2-desktop] Failed to install ${surface} scrollbar CSS: ${errorMessage(error)}`,
    );
  }
}

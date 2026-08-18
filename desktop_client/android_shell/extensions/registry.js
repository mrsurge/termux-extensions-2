// in `android_shell/extensions/`
import { appsExtension } from "./apps.js";
import { localFrameworkExtension } from "./local-framework.js";

/** Compile-time registry for frontend-only modules mounted on the Android splash page. */
export const launcherExtensions = [localFrameworkExtension, appsExtension];

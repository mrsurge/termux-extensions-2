/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { isIOS, isLinux, isMacintosh, isMobile, isWeb, isWindows } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { RawContextKey } from './contextkey.js';
export const IsMacContext = new RawContextKey('isMac', isMacintosh, localize(1684, "Whether the operating system is macOS"));
export const IsLinuxContext = new RawContextKey('isLinux', isLinux, localize(1685, "Whether the operating system is Linux"));
export const IsWindowsContext = new RawContextKey('isWindows', isWindows, localize(1686, "Whether the operating system is Windows"));
export const IsWebContext = new RawContextKey('isWeb', isWeb, localize(1687, "Whether the platform is a web browser"));
export const IsMacNativeContext = new RawContextKey('isMacNative', isMacintosh && !isWeb, localize(1688, "Whether the operating system is macOS on a non-browser platform"));
export const IsIOSContext = new RawContextKey('isIOS', isIOS, localize(1689, "Whether the operating system is iOS"));
export const IsMobileContext = new RawContextKey('isMobile', isMobile, localize(1690, "Whether the platform is a mobile web browser"));
export const IsDevelopmentContext = new RawContextKey('isDevelopment', false, true);
export const ProductQualityContext = new RawContextKey('productQualityType', '', localize(1691, "Quality type of VS Code"));
export const InputFocusedContextKey = 'inputFocus';
export const InputFocusedContext = new RawContextKey(InputFocusedContextKey, false, localize(1692, "Whether keyboard focus is inside an input box"));
//# sourceMappingURL=contextkeys.js.map
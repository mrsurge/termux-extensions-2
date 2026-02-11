/*
 * TE2 Breadcrumbs Widget — thin entrypoint for esbuild.
 *
 * Re-exports only what TE2 needs from the VS Code base widget.
 * esbuild resolves imports from the code-server worktree source.
 */

export {
	BreadcrumbsWidget,
	BreadcrumbsItem,
	type IBreadcrumbsWidgetStyles,
	type IBreadcrumbsItemEvent
} from 'vs/base/browser/ui/breadcrumbs/breadcrumbsWidget.js';

export { ScrollbarVisibility } from 'vs/base/common/scrollable.js';
export { ThemeIcon } from 'vs/base/common/themables.js';
export { Codicon } from 'vs/base/common/codicons.js';
export { Dimension } from 'vs/base/browser/dom.js';

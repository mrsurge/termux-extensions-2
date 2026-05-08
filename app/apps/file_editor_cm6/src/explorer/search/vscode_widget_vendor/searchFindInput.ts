/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextScopedFindInput } from '/static/vendor/monaco-editor-core/esm/vs/platform/history/browser/contextScopedHistoryWidget.js';
import { Emitter } from '/static/vendor/monaco-editor-core/esm/vs/base/common/event.js';
import type {
  ExplorerSearchWidgetContextKeyService,
  ExplorerSearchWidgetContextViewProvider,
} from './searchWidgetServices.ts';

type FindInputOptionsLike = Record<string, unknown>;


export class SearchFindInput extends ContextScopedFindInput {
	private _filterVisible = false;
	private readonly _onDidChangeAIToggle = this._register(new Emitter());
	public readonly onDidChangeAIToggle = this._onDidChangeAIToggle.event;

	constructor(
		container: HTMLElement | null,
		contextViewProvider: ExplorerSearchWidgetContextViewProvider,
		options: FindInputOptionsLike,
		contextKeyService: ExplorerSearchWidgetContextKeyService,
	) {
		super(container, contextViewProvider, options, contextKeyService);
	}

	get filterVisible(): boolean {
		return this._filterVisible;
	}

	set filterVisible(visible: boolean) {
		this._filterVisible = visible;
	}

	override setEnabled(enabled: boolean) {
		super.setEnabled(enabled);
		if (enabled) {
			this.regex?.enable();
		} else {
			this.regex?.disable();
		}
	}

	updateFilterStyles() {
		// Explorer does not yet wire the notebook-specific filter affordance.
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '/static/vendor/monaco-editor-core/esm/vs/base/browser/dom.js';
import { Toggle } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/toggle/toggle.js';
import { HistoryInputBox } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/inputbox/inputBox.js';
import { Widget } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/widget.js';
import { Codicon } from '/static/vendor/monaco-editor-core/esm/vs/base/common/codicons.js';
import { Emitter } from '/static/vendor/monaco-editor-core/esm/vs/base/common/event.js';
import { HistoryNavigator } from '/static/vendor/monaco-editor-core/esm/vs/base/common/history.js';
import * as nls from '/static/vendor/monaco-editor-core/esm/vs/nls.js';
import {
  registerAndCreateHistoryNavigationContext,
} from '/static/vendor/monaco-editor-core/esm/vs/platform/history/browser/contextScopedHistoryWidget.js';
import { showHistoryKeybindingHint } from '/static/vendor/monaco-editor-core/esm/vs/platform/history/browser/historyWidgetKeybindingHint.js';
import { defaultToggleStyles } from '/static/vendor/monaco-editor-core/esm/vs/platform/theme/browser/defaultStyles.js';
import type { ExplorerSearchWidgetKeybindingService } from './searchWidgetServices.ts';

const KEY_CODE = {
	Enter: 3,
	Escape: 9,
} as const;

interface PatternKeyboardEvent {
	keyCode: number;
}

interface PatternInputBoxStyles {
	[key: string]: unknown;
}

interface PatternContextViewProvider {
	showContextView(...args: unknown[]): { close(): void };
	hideContextView(data?: unknown): void;
	layout(): void;
}

interface PatternContextKeyService {
	createScoped(target: HTMLElement): { dispose(): void };
}

type PatternFocusTracker = ReturnType<typeof dom.trackFocus>;

class ExplorerContextScopedHistoryInputBox extends HistoryInputBox {
	private readonly scopedContextKeyService: { dispose(): void };

	constructor(
		container: HTMLElement,
		contextViewProvider: PatternContextViewProvider,
		options: {
			placeholder?: string;
			showPlaceholderOnFocus?: boolean;
			tooltip?: string;
			ariaLabel?: string;
			validationOptions?: { validation: undefined };
			history: Set<string>;
			showHistoryHint: () => boolean;
			inputBoxStyles: PatternInputBoxStyles;
		},
		contextKeyService: PatternContextKeyService,
	) {
		super(container, contextViewProvider, options);
		this.scopedContextKeyService = registerAndCreateHistoryNavigationContext(
			contextKeyService.createScoped(this.element),
			this,
		);
	}

	override dispose(): void {
		this.scopedContextKeyService.dispose();
		super.dispose();
	}

	set width(value: number) {
		this.element.style.width = `${value}px`;
		this.layout();
	}

	getHistory(): string[] {
		return this.history.getHistory();
	}

	clearHistory(): void {
		this.history = new HistoryNavigator(new Set(), 100);
	}

	prependHistory(history: string[]): void {
		for (const entry of history) {
			if (entry) {
				this.history.add(entry);
			}
		}
	}
}

export interface IOptions {
	placeholder?: string;
	showPlaceholderOnFocus?: boolean;
	tooltip?: string;
	width?: number;
	ariaLabel?: string;
	history?: string[];
	inputBoxStyles: PatternInputBoxStyles;
}

export class PatternInputWidget extends Widget {

	static OPTION_CHANGE: string = 'optionChange';

	inputFocusTracker!: PatternFocusTracker;

	private width: number;

	private domNode!: HTMLElement;
	protected inputBox!: HistoryInputBox;

	private _onSubmit = this._register(new Emitter());
	onSubmit = this._onSubmit.event;

	private _onCancel = this._register(new Emitter());
	onCancel = this._onCancel.event;

	constructor(
		parent: HTMLElement,
		private contextViewProvider: PatternContextViewProvider,
		options: IOptions,
		private readonly contextKeyService: PatternContextKeyService,
		private readonly keybindingService: ExplorerSearchWidgetKeybindingService,
	) {
		super();
		options = {
			...{
				ariaLabel: nls.localize('defaultLabel', "input")
			},
			...options,
		};
		this.width = options.width ?? 100;

		this.render(options);

		parent.appendChild(this.domNode);
	}

	override dispose(): void {
		super.dispose();
		this.inputFocusTracker?.dispose();
	}

	setWidth(newWidth: number): void {
		this.width = newWidth;
		this.contextViewProvider.layout();
		this.setInputWidth();
	}

	getValue(): string {
		return this.inputBox.value;
	}

	setValue(value: string): void {
		if (this.inputBox.value !== value) {
			this.inputBox.value = value;
		}
	}


	select(): void {
		this.inputBox.select();
	}

	focus(): void {
		this.inputBox.focus();
	}

	inputHasFocus(): boolean {
		return this.inputBox.hasFocus();
	}

	private setInputWidth(): void {
		this.inputBox.width = this.width - this.getSubcontrolsWidth() - 2; // 2 for input box border
	}

	protected getSubcontrolsWidth(): number {
		return 0;
	}

	getHistory(): string[] {
		return this.inputBox.getHistory();
	}

	clearHistory(): void {
		this.inputBox.clearHistory();
	}

	prependHistory(history: string[]): void {
		this.inputBox.prependHistory(history);
	}

	clear(): void {
		this.setValue('');
	}

	onSearchSubmit(): void {
		this.inputBox.addToHistory();
	}

	showNextTerm() {
		this.inputBox.showNextValue();
	}

	showPreviousTerm() {
		this.inputBox.showPreviousValue();
	}

	private render(options: IOptions): void {
		this.domNode = document.createElement('div');
		this.domNode.classList.add('monaco-findInput');
		const history = options.history || [];

		this.inputBox = this._register(new ExplorerContextScopedHistoryInputBox(this.domNode, this.contextViewProvider, {
			placeholder: options.placeholder,
			showPlaceholderOnFocus: options.showPlaceholderOnFocus,
			tooltip: options.tooltip,
			ariaLabel: options.ariaLabel,
			validationOptions: {
				validation: undefined
			},
			history: new Set(history),
			showHistoryHint: () => showHistoryKeybindingHint(this.keybindingService),
			inputBoxStyles: options.inputBoxStyles
		}, this.contextKeyService));
		this._register(this.inputBox.onDidChange(() => this._onSubmit.fire(true)));

		this.inputFocusTracker = dom.trackFocus(this.inputBox.inputElement);
		this.onkeyup(this.inputBox.inputElement, (keyboardEvent) => this.onInputKeyUp(keyboardEvent));

		const controls = document.createElement('div');
		controls.className = 'controls';
		this.renderSubcontrols(controls);

		this.domNode.appendChild(controls);
		this.setInputWidth();
	}

	protected renderSubcontrols(_controlsDiv: HTMLDivElement): void {
	}

	private onInputKeyUp(keyboardEvent: PatternKeyboardEvent) {
		switch (keyboardEvent.keyCode) {
			case KEY_CODE.Enter:
				this.onSearchSubmit();
				this._onSubmit.fire(false);
				return;
			case KEY_CODE.Escape:
				this._onCancel.fire();
				return;
		}
	}
}

export class IncludePatternInputWidget extends PatternInputWidget {

	private _onChangeSearchInEditorsBoxEmitter = this._register(new Emitter());
	onChangeSearchInEditorsBox = this._onChangeSearchInEditorsBoxEmitter.event;

	constructor(parent: HTMLElement, contextViewProvider: PatternContextViewProvider, options: IOptions,
		contextKeyService: PatternContextKeyService,
		keybindingService: ExplorerSearchWidgetKeybindingService,
	) {
		super(parent, contextViewProvider, options, contextKeyService, keybindingService);
	}

	private useSearchInEditorsBox!: Toggle;

	override dispose(): void {
		super.dispose();
		this.useSearchInEditorsBox.dispose();
	}

	onlySearchInOpenEditors(): boolean {
		return this.useSearchInEditorsBox.checked;
	}

	setOnlySearchInOpenEditors(value: boolean) {
		this.useSearchInEditorsBox.checked = value;
		this._onChangeSearchInEditorsBoxEmitter.fire();
	}

	protected override getSubcontrolsWidth(): number {
		return super.getSubcontrolsWidth() + this.useSearchInEditorsBox.width();
	}

	protected override renderSubcontrols(controlsDiv: HTMLDivElement): void {
		this.useSearchInEditorsBox = this._register(new Toggle({
			icon: Codicon.book,
			title: nls.localize('onlySearchInOpenEditors', "Search only in Open Editors"),
			isChecked: false,
			...defaultToggleStyles
		}));
		this._register(this.useSearchInEditorsBox.onChange(viaKeyboard => {
			this._onChangeSearchInEditorsBoxEmitter.fire();
			if (!viaKeyboard) {
				this.inputBox.focus();
			}
		}));

		controlsDiv.appendChild(this.useSearchInEditorsBox.domNode);
		super.renderSubcontrols(controlsDiv);
	}
}

export class ExcludePatternInputWidget extends PatternInputWidget {

	private _onChangeIgnoreBoxEmitter = this._register(new Emitter());
	onChangeIgnoreBox = this._onChangeIgnoreBoxEmitter.event;

	constructor(parent: HTMLElement, contextViewProvider: PatternContextViewProvider, options: IOptions,
		contextKeyService: PatternContextKeyService,
		keybindingService: ExplorerSearchWidgetKeybindingService,
	) {
		super(parent, contextViewProvider, options, contextKeyService, keybindingService);
	}

	private useExcludesAndIgnoreFilesBox!: Toggle;

	override dispose(): void {
		super.dispose();
		this.useExcludesAndIgnoreFilesBox.dispose();
	}

	useExcludesAndIgnoreFiles(): boolean {
		return this.useExcludesAndIgnoreFilesBox.checked;
	}

	setUseExcludesAndIgnoreFiles(value: boolean) {
		this.useExcludesAndIgnoreFilesBox.checked = value;
		this._onChangeIgnoreBoxEmitter.fire();
	}

	protected override getSubcontrolsWidth(): number {
		return super.getSubcontrolsWidth() + this.useExcludesAndIgnoreFilesBox.width();
	}

	protected override renderSubcontrols(controlsDiv: HTMLDivElement): void {
		this.useExcludesAndIgnoreFilesBox = this._register(new Toggle({
			icon: Codicon.exclude,
			actionClassName: 'useExcludesAndIgnoreFiles',
			title: nls.localize('useExcludesAndIgnoreFilesDescription', "Use Exclude Settings and Ignore Files"),
			isChecked: true,
			...defaultToggleStyles
		}));
		this._register(this.useExcludesAndIgnoreFilesBox.onChange(viaKeyboard => {
			this._onChangeIgnoreBoxEmitter.fire();
			if (!viaKeyboard) {
				this.inputBox.focus();
			}
		}));

		controlsDiv.appendChild(this.useExcludesAndIgnoreFilesBox.domNode);
		super.renderSubcontrols(controlsDiv);
	}
}

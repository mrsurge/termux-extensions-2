/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '/static/vendor/monaco-editor-core/esm/vs/nls.js';
import * as dom from '/static/vendor/monaco-editor-core/esm/vs/base/browser/dom.js';
import { ActionBar } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/actionbar/actionbar.js';
import { Button } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/button/button.js';
import { ReplaceInput } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/findinput/replaceInput.js';
import {
  InputBox,
} from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/inputbox/inputBox.js';
import { Widget } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/widget.js';
import { Action } from '/static/vendor/monaco-editor-core/esm/vs/base/common/actions.js';
import { Delayer } from '/static/vendor/monaco-editor-core/esm/vs/base/common/async.js';
import { Emitter } from '/static/vendor/monaco-editor-core/esm/vs/base/common/event.js';
import type { IContextKey } from '/static/vendor/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey.js';
import { ThemeIcon } from '/static/vendor/monaco-editor-core/esm/vs/base/common/themables.js';
import { ContextScopedReplaceInput } from '/static/vendor/monaco-editor-core/esm/vs/platform/history/browser/contextScopedHistoryWidget.js';
import { isMacintosh } from '/static/vendor/monaco-editor-core/esm/vs/base/common/platform.js';
import { Toggle } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/toggle/toggle.js';
import {
  searchReplaceAllIcon,
  searchHideReplaceIcon,
  searchShowContextIcon,
  searchShowReplaceIcon,
} from './searchIcons.ts';
import { showHistoryKeybindingHint } from '/static/vendor/monaco-editor-core/esm/vs/platform/history/browser/historyWidgetKeybindingHint.js';
import {
  defaultInputBoxStyles,
  defaultToggleStyles,
} from '/static/vendor/monaco-editor-core/esm/vs/platform/theme/browser/defaultStyles.js';
import { SearchFindInput } from './searchFindInput.ts';
import { getDefaultHoverDelegate } from '/static/vendor/monaco-editor-core/esm/vs/base/browser/ui/hover/hoverDelegateFactory.js';
import {
  MutableDisposable,
} from '/static/vendor/monaco-editor-core/esm/vs/base/common/lifecycle.js';
import {
  SEARCH_WIDGET_COMMAND_IDS,
  SEARCH_WIDGET_CONTEXT,
} from './searchWidgetConstants.ts';
import {
  createExplorerSearchWidgetServices,
  type ExplorerSearchWidgetKeybindingService,
  type ExplorerSearchWidgetSearchConfiguration,
  type ExplorerSearchWidgetServices,
} from './searchWidgetServices.ts';

/** Specified in searchview.css */
const SingleLineInputHeight = 26;
const KEY_CODE = {
	Enter: 3,
	Escape: 9,
	Tab: 2,
	PageUp: 11,
	PageDown: 12,
	UpArrow: 16,
	DownArrow: 18,
} as const;
const KEY_MOD = {
	WinCtrl: 256,
	Alt: 512,
	Shift: 1024,
	CtrlCmd: 2048,
} as const;

interface SearchKeyboardEvent {
	keyCode: number;
	preventDefault(): void;
	stopPropagation(): void;
	equals(other: number): boolean;
}

interface SearchButtonOptions {
	[key: string]: unknown;
}

interface SearchFindInputOptions {
	[key: string]: unknown;
}

interface SearchInputBoxStyles {
	[key: string]: unknown;
}

interface SearchMessage {
	content: string;
}

interface SearchToggleStyles {
	[key: string]: unknown;
}

type SearchFocusTracker = ReturnType<typeof dom.trackFocus>;
type SearchDisposable = { dispose(): void };

export interface ISearchWidgetOptions {
	value?: string;
	replaceValue?: string;
	isRegex?: boolean;
	isCaseSensitive?: boolean;
	isWholeWords?: boolean;
	searchHistory?: string[];
	replaceHistory?: string[];
	preserveCase?: boolean;
	_hideReplaceToggle?: boolean; // TODO: Search Editor's replace experience
	showContextToggle?: boolean;
	inputBoxStyles: SearchInputBoxStyles;
	toggleStyles: SearchToggleStyles;
}

class ReplaceAllAction extends Action {

	static readonly ID: string = 'search.action.replaceAll';

	constructor(private _searchWidget: SearchWidget) {
		super(ReplaceAllAction.ID, '', ThemeIcon.asClassName(searchReplaceAllIcon), false);
	}

	set searchWidget(searchWidget: SearchWidget) {
		this._searchWidget = searchWidget;
	}

	override run(): Promise<void> {
		if (this._searchWidget) {
			return this._searchWidget.triggerReplaceAll();
		}
		return Promise.resolve();
	}
}

const hoverLifecycleOptions = { groupId: 'search-widget' };
const ctrlKeyMod = (isMacintosh ? KEY_MOD.WinCtrl : KEY_MOD.CtrlCmd);

function stopPropagationForMultiLineUpwards(event: IKeyboardEvent, value: string, textarea: HTMLTextAreaElement | null) {
	const isMultiline = !!value.match(/\n/);
	if (textarea && (isMultiline || textarea.clientHeight > SingleLineInputHeight) && textarea.selectionStart > 0) {
		event.stopPropagation();
		return;
	}
}

function stopPropagationForMultiLineDownwards(event: IKeyboardEvent, value: string, textarea: HTMLTextAreaElement | null) {
	const isMultiline = !!value.match(/\n/);
	if (textarea && (isMultiline || textarea.clientHeight > SingleLineInputHeight) && textarea.selectionEnd < textarea.value.length) {
		event.stopPropagation();
		return;
	}
}


export class SearchWidget extends Widget {
	private static readonly INPUT_MAX_HEIGHT = 134;

	private static readonly REPLACE_ALL_DISABLED_LABEL = nls.localize('search.action.replaceAll.disabled.label', "Replace All (Submit Search to Enable)");
	private static readonly REPLACE_ALL_ENABLED_LABEL = (keyBindingService2: ExplorerSearchWidgetKeybindingService): string => {
		return keyBindingService2.appendKeybinding(nls.localize('search.action.replaceAll.enabled.label', "Replace All"), ReplaceAllAction.ID);
	};

	domNode: HTMLElement | undefined;

	searchInput: SearchFindInput | undefined;
	searchInputFocusTracker: SearchFocusTracker | undefined;
	private searchInputBoxFocused: IContextKey<boolean>;

	private replaceContainer: HTMLElement | undefined;
	replaceInput: ReplaceInput | undefined;
	replaceInputFocusTracker: SearchFocusTracker | undefined;
	private replaceInputBoxFocused: IContextKey<boolean>;
	private toggleReplaceButton: Button | undefined;
	private replaceAllAction: ReplaceAllAction | undefined;
	private replaceActive: IContextKey<boolean>;
	private replaceActionBar: ActionBar | undefined;
	private _replaceHistoryDelayer: Delayer;
	private ignoreGlobalFindBufferOnNextFocus = false;
	private previousGlobalFindBufferValue: string | null = null;

	private _onSearchSubmit = this._register(new Emitter());
	readonly onSearchSubmit = this._onSearchSubmit.event;

	private _onSearchCancel = this._register(new Emitter());
	readonly onSearchCancel = this._onSearchCancel.event;

	private _onReplaceToggled = this._register(new Emitter());
	readonly onReplaceToggled = this._onReplaceToggled.event;

	private _onReplaceStateChange = this._register(new Emitter());
	readonly onReplaceStateChange = this._onReplaceStateChange.event;

	private _onPreserveCaseChange = this._register(new Emitter());
	readonly onPreserveCaseChange = this._onPreserveCaseChange.event;

	private _onReplaceValueChanged = this._register(new Emitter());
	readonly onReplaceValueChanged = this._onReplaceValueChanged.event;

	private _onReplaceAll = this._register(new Emitter());
	readonly onReplaceAll = this._onReplaceAll.event;

	private _onBlur = this._register(new Emitter());
	readonly onBlur = this._onBlur.event;

	private _onDidHeightChange = this._register(new Emitter());
	readonly onDidHeightChange = this._onDidHeightChange.event;

	private readonly _onDidToggleContext = new Emitter();
	readonly onDidToggleContext = this._onDidToggleContext.event;

	private showContextToggle!: Toggle;
	public contextLinesInput!: InputBox;

	private readonly _toggleReplaceButtonListener: MutableDisposable<SearchDisposable>;
	private readonly services: ExplorerSearchWidgetServices;

	constructor(
		container: HTMLElement,
		options: ISearchWidgetOptions,
		services?: ExplorerSearchWidgetServices,
	) {
		super();
		this.services = this._register(
			services ?? createExplorerSearchWidgetServices(container),
		);
		this.replaceActive = SEARCH_WIDGET_CONTEXT.replaceActiveKey.bindTo(this.services.contextKeyService);
		this.searchInputBoxFocused = SEARCH_WIDGET_CONTEXT.searchInputBoxFocusedKey.bindTo(this.services.contextKeyService);
		this.replaceInputBoxFocused = SEARCH_WIDGET_CONTEXT.replaceInputBoxFocusedKey.bindTo(this.services.contextKeyService);

		this._replaceHistoryDelayer = new Delayer(500);
		this._toggleReplaceButtonListener = this._register(new MutableDisposable<SearchDisposable>());

		this.render(container, options);

		this._register(this.services.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.accessibilitySupport')) {
				this.updateAccessibilitySupport();
			}
		}));

		this._register(this.services.accessibilityService.onDidChangeScreenReaderOptimized(() => this.updateAccessibilitySupport()));
		this.updateAccessibilitySupport();
	}

	focus(select: boolean = true, focusReplace: boolean = false, suppressGlobalSearchBuffer = false): void {
		this.ignoreGlobalFindBufferOnNextFocus = suppressGlobalSearchBuffer;

		if (focusReplace && this.isReplaceShown()) {
			if (this.replaceInput) {
				this.replaceInput.focus();
				if (select) {
					this.replaceInput.select();
				}
			}
		} else {
			if (this.searchInput) {
				this.searchInput.focus();
				if (select) {
					this.searchInput.select();
				}
			}
		}
	}

	setWidth(width: number) {
		this.searchInput?.inputBox.layout();
		if (this.replaceInput) {
			this.replaceInput.width = width - 28;
			this.replaceInput.inputBox.layout();
		}
	}

	clear() {
		this.searchInput?.clear();
		this.replaceInput?.setValue('');
		this.setReplaceAllActionState(false);
	}

	isReplaceShown(): boolean {
		return this.replaceContainer ? !this.replaceContainer.classList.contains('disabled') : false;
	}

	isReplaceActive(): boolean {
		return !!this.replaceActive.get();
	}

	getReplaceValue(): string {
		return this.replaceInput?.getValue() ?? '';
	}

	toggleReplace(show?: boolean): void {
		if (show === undefined || show !== this.isReplaceShown()) {
			this.onToggleReplaceButton();
		}
	}

	getSearchHistory(): string[] {
		return this.searchInput?.inputBox.getHistory() ?? [];
	}

	getReplaceHistory(): string[] {
		return this.replaceInput?.inputBox.getHistory() ?? [];
	}

	prependSearchHistory(history: string[]): void {
		this.searchInput?.inputBox.prependHistory(history);
	}

	prependReplaceHistory(history: string[]): void {
		this.replaceInput?.inputBox.prependHistory(history);
	}

	clearHistory(): void {
		this.searchInput?.inputBox.clearHistory();
		this.replaceInput?.inputBox.clearHistory();
	}

	showNextSearchTerm() {
		this.searchInput?.inputBox.showNextValue();
	}

	showPreviousSearchTerm() {
		this.searchInput?.inputBox.showPreviousValue();
	}

	showNextReplaceTerm() {
		this.replaceInput?.inputBox.showNextValue();
	}

	showPreviousReplaceTerm() {
		this.replaceInput?.inputBox.showPreviousValue();
	}

	searchInputHasFocus(): boolean {
		return !!this.searchInputBoxFocused.get();
	}

	replaceInputHasFocus(): boolean {
		return !!this.replaceInput?.inputBox.hasFocus();
	}

	focusReplaceAllAction(): void {
		this.replaceActionBar?.focus(true);
	}

	focusRegexAction(): void {
		this.searchInput?.focusOnRegex();
	}

	set replaceButtonVisibility(val: boolean) {
		if (this.toggleReplaceButton) {
			this.toggleReplaceButton.element.style.display = val ? '' : 'none';
		}
	}

	private render(container: HTMLElement, options: ISearchWidgetOptions): void {
		this.domNode = dom.append(container, dom.$('.search-widget'));
		this.domNode.style.position = 'relative';

		if (!options._hideReplaceToggle) {
			this.renderToggleReplaceButton(this.domNode);
		}

		this.renderSearchInput(this.domNode, options);
		this.renderReplaceInput(this.domNode, options);
	}

	private updateAccessibilitySupport(): void {
		this.searchInput?.setFocusInputOnOptionClick(!this.services.accessibilityService.isScreenReaderOptimized());
	}

	private renderToggleReplaceButton(parent: HTMLElement): void {
		const opts: SearchButtonOptions = {
			buttonBackground: undefined,
			buttonBorder: undefined,
			buttonForeground: undefined,
			buttonHoverBackground: undefined,
			buttonSecondaryBackground: undefined,
			buttonSecondaryForeground: undefined,
			buttonSecondaryHoverBackground: undefined,
			buttonSeparator: undefined,
			title: nls.localize('search.replace.toggle.button.title', "Toggle Replace"),
			hoverDelegate: getDefaultHoverDelegate('element'),
		};
		this.toggleReplaceButton = this._register(new Button(parent, opts));
		this.toggleReplaceButton.element.setAttribute('aria-expanded', 'false');
		this.toggleReplaceButton.element.classList.add('toggle-replace-button');
		this.toggleReplaceButton.icon = searchHideReplaceIcon;
		this._toggleReplaceButtonListener.value = this.toggleReplaceButton.onDidClick(() => this.onToggleReplaceButton());
	}

	private renderSearchInput(parent: HTMLElement, options: ISearchWidgetOptions): void {
		const history = options.searchHistory || [];
		const inputOptions: SearchFindInputOptions = {
			label: nls.localize('label.Search', 'Search: Type Search Term and press Enter to search'),
			validation: (value: string) => this.validateSearchInput(value),
			placeholder: nls.localize('search.placeHolder', "Search"),
			appendCaseSensitiveLabel: this.services.keybindingService.appendKeybinding('', SEARCH_WIDGET_COMMAND_IDS.toggleCaseSensitive),
			appendWholeWordsLabel: this.services.keybindingService.appendKeybinding('', SEARCH_WIDGET_COMMAND_IDS.toggleWholeWord),
			appendRegexLabel: this.services.keybindingService.appendKeybinding('', SEARCH_WIDGET_COMMAND_IDS.toggleRegex),
			history: new Set(history),
			showHistoryHint: () => showHistoryKeybindingHint(this.services.keybindingService),
			flexibleHeight: true,
			flexibleMaxHeight: SearchWidget.INPUT_MAX_HEIGHT,
			showCommonFindToggles: true,
			inputBoxStyles: options.inputBoxStyles,
			toggleStyles: options.toggleStyles,
			hoverLifecycleOptions,
		};

		const searchInputContainer = dom.append(parent, dom.$('.search-container.input-box'));

		this.searchInput = this._register(
			new SearchFindInput(
				searchInputContainer,
				this.services.contextViewProvider,
				inputOptions,
				this.services.contextKeyService,
			)
		);

		this._register(this.searchInput.onKeyDown((keyboardEvent: IKeyboardEvent) => this.onSearchInputKeyDown(keyboardEvent)));
		this.searchInput.setValue(options.value || '');
		this.searchInput.setRegex(!!options.isRegex);
		this.searchInput.setCaseSensitive(!!options.isCaseSensitive);
		this.searchInput.setWholeWords(!!options.isWholeWords);
		this._register(this.searchInput.onCaseSensitiveKeyDown((keyboardEvent: IKeyboardEvent) => this.onCaseSensitiveKeyDown(keyboardEvent)));
		this._register(this.searchInput.onRegexKeyDown((keyboardEvent: IKeyboardEvent) => this.onRegexKeyDown(keyboardEvent)));
		this._register(this.searchInput.inputBox.onDidChange(() => this.onSearchInputChanged()));
		this._register(this.searchInput.inputBox.onDidHeightChange(() => this._onDidHeightChange.fire()));

		this._register(this.onReplaceValueChanged(() => {
			this._replaceHistoryDelayer.trigger(() => this.replaceInput?.inputBox.addToHistory());
		}));

		this.searchInputFocusTracker = this._register(dom.trackFocus(this.searchInput.inputBox.inputElement));
		this._register(this.searchInputFocusTracker.onDidFocus(async () => {
			this.searchInputBoxFocused.set(true);

			const useGlobalFindBuffer = this.searchConfiguration.globalFindClipboard;
			if (!this.ignoreGlobalFindBufferOnNextFocus && useGlobalFindBuffer) {
				const globalBufferText = await this.services.clipboardService.readFindText();
				if (globalBufferText && this.previousGlobalFindBufferValue !== globalBufferText) {
					this.searchInput?.inputBox.addToHistory();
					this.searchInput?.setValue(globalBufferText);
					this.searchInput?.select();
				}

				this.previousGlobalFindBufferValue = globalBufferText;
			}

			this.ignoreGlobalFindBufferOnNextFocus = false;
		}));
		this._register(this.searchInputFocusTracker.onDidBlur(() => this.searchInputBoxFocused.set(false)));


		this.showContextToggle = new Toggle({
			isChecked: false,
			title: this.services.keybindingService.appendKeybinding(nls.localize('showContext', "Toggle Context Lines"), SEARCH_WIDGET_COMMAND_IDS.toggleContextLines),
			icon: searchShowContextIcon,
			hoverLifecycleOptions,
			...defaultToggleStyles
		});
		this._register(this.showContextToggle.onChange(() => this.onContextLinesChanged()));

		if (options.showContextToggle) {
			this.contextLinesInput = new InputBox(searchInputContainer, this.services.contextViewProvider, { type: 'number', inputBoxStyles: defaultInputBoxStyles });
			this.contextLinesInput.element.classList.add('context-lines-input');
			this.contextLinesInput.value = '' + (this.searchConfiguration.searchEditor.defaultNumberOfContextLines ?? 1);
			this._register(this.contextLinesInput.onDidChange((value: string) => {
				if (value !== '0') {
					this.showContextToggle.checked = true;
				}
				this.onContextLinesChanged();
			}));
			dom.append(searchInputContainer, this.showContextToggle.domNode);
		}
	}

	private onContextLinesChanged() {
		this._onDidToggleContext.fire();

		if (this.contextLinesInput.value.includes('-')) {
			this.contextLinesInput.value = '0';
		}

		this._onDidToggleContext.fire();
	}

	public setContextLines(lines: number) {
		if (!this.contextLinesInput) { return; }
		if (lines === 0) {
			this.showContextToggle.checked = false;
		} else {
			this.showContextToggle.checked = true;
			this.contextLinesInput.value = '' + lines;
		}
	}

	private renderReplaceInput(parent: HTMLElement, options: ISearchWidgetOptions): void {
		this.replaceContainer = dom.append(parent, dom.$('.replace-container.disabled'));
		const replaceBox = dom.append(this.replaceContainer, dom.$('.replace-input'));

		this.replaceInput = this._register(new ContextScopedReplaceInput(replaceBox, this.services.contextViewProvider, {
			label: nls.localize('label.Replace', 'Replace: Type replace term and press Enter to preview'),
			placeholder: nls.localize('search.replace.placeHolder', "Replace"),
			appendPreserveCaseLabel: this.services.keybindingService.appendKeybinding('', SEARCH_WIDGET_COMMAND_IDS.togglePreserveCase),
			history: new Set(options.replaceHistory),
			showHistoryHint: () => showHistoryKeybindingHint(this.services.keybindingService),
			flexibleHeight: true,
			flexibleMaxHeight: SearchWidget.INPUT_MAX_HEIGHT,
			inputBoxStyles: options.inputBoxStyles,
			toggleStyles: options.toggleStyles,
			hoverLifecycleOptions
		}, this.services.contextKeyService, true));

		this._register(this.replaceInput.onDidOptionChange(viaKeyboard => {
			if (!viaKeyboard) {
				if (this.replaceInput) {
					this._onPreserveCaseChange.fire(this.replaceInput.getPreserveCase());
				}
			}
		}));

		this._register(this.replaceInput.onKeyDown((keyboardEvent) => this.onReplaceInputKeyDown(keyboardEvent)));
		this.replaceInput.setValue(options.replaceValue || '');
		this._register(this.replaceInput.inputBox.onDidChange(() => this._onReplaceValueChanged.fire()));
		this._register(this.replaceInput.inputBox.onDidHeightChange(() => this._onDidHeightChange.fire()));

		this.replaceAllAction = new ReplaceAllAction(this);
		this.replaceAllAction.label = SearchWidget.REPLACE_ALL_DISABLED_LABEL;
		this.replaceActionBar = this._register(new ActionBar(this.replaceContainer));
		this.replaceActionBar.push([this.replaceAllAction], { icon: true, label: false });
		this.onkeydown(this.replaceActionBar.domNode, (keyboardEvent) => this.onReplaceActionbarKeyDown(keyboardEvent));

		this.replaceInputFocusTracker = this._register(dom.trackFocus(this.replaceInput.inputBox.inputElement));
		this._register(this.replaceInputFocusTracker.onDidFocus(() => this.replaceInputBoxFocused.set(true)));
		this._register(this.replaceInputFocusTracker.onDidBlur(() => this.replaceInputBoxFocused.set(false)));
		this._register(this.replaceInput.onPreserveCaseKeyDown((keyboardEvent: IKeyboardEvent) => this.onPreserveCaseKeyDown(keyboardEvent)));
	}

	triggerReplaceAll(): Promise<void> {
		this._onReplaceAll.fire();
		return Promise.resolve();
	}

	private onToggleReplaceButton(): void {
		this.replaceContainer?.classList.toggle('disabled');
		if (this.isReplaceShown()) {
			this.toggleReplaceButton?.element.classList.remove(...ThemeIcon.asClassNameArray(searchHideReplaceIcon));
			this.toggleReplaceButton?.element.classList.add(...ThemeIcon.asClassNameArray(searchShowReplaceIcon));
		} else {
			this.toggleReplaceButton?.element.classList.remove(...ThemeIcon.asClassNameArray(searchShowReplaceIcon));
			this.toggleReplaceButton?.element.classList.add(...ThemeIcon.asClassNameArray(searchHideReplaceIcon));
		}
		this.toggleReplaceButton?.element.setAttribute('aria-expanded', this.isReplaceShown() ? 'true' : 'false');
		this.updateReplaceActiveState();
		this._onReplaceToggled.fire();
	}

	setValue(value: string) {
		this.searchInput?.setValue(value);
	}

	setReplaceAllActionState(enabled: boolean): void {
		if (this.replaceAllAction && (this.replaceAllAction.enabled !== enabled)) {
			this.replaceAllAction.enabled = enabled;
			this.replaceAllAction.label = enabled ? SearchWidget.REPLACE_ALL_ENABLED_LABEL(this.services.keybindingService) : SearchWidget.REPLACE_ALL_DISABLED_LABEL;
			this.updateReplaceActiveState();
		}
	}

	private updateReplaceActiveState(): void {
		const currentState = this.isReplaceActive();
		const newState = this.isReplaceShown() && !!this.replaceAllAction?.enabled;
		if (currentState !== newState) {
			this.replaceActive.set(newState);
			this._onReplaceStateChange.fire(newState);
			this.replaceInput?.inputBox.layout();
		}
	}

	private validateSearchInput(value: string): SearchMessage | null {
		if (value.length === 0) {
			return null;
		}
		if (!(this.searchInput?.getRegex())) {
			return null;
		}
		try {
			new RegExp(value, 'u');
		} catch (e) {
			return { content: e.message };
		}

		return null;
	}

	private onSearchInputChanged(): void {
		this.searchInput?.clearMessage();
		this.setReplaceAllActionState(false);

		if (this.searchConfiguration.searchOnType) {
			if (this.searchInput?.getRegex()) {
				try {
					const regex = new RegExp(this.searchInput.getValue(), 'ug');
					const matchienessHeuristic = `
								~!@#$%^&*()_+
								\`1234567890-=
								qwertyuiop[]\\
								QWERTYUIOP{}|
								asdfghjkl;'
								ASDFGHJKL:"
								zxcvbnm,./
								ZXCVBNM<>? `.match(regex)?.length ?? 0;

					const delayMultiplier =
						matchienessHeuristic < 50 ? 1 :
							matchienessHeuristic < 100 ? 5 : // expressions like `.` or `\w`
								10; // only things matching empty string


					this.submitSearch(true, this.searchConfiguration.searchOnTypeDebouncePeriod * delayMultiplier);
				} catch {
					// pass
				}
			} else {
				this.submitSearch(true, this.searchConfiguration.searchOnTypeDebouncePeriod);
			}
		}
	}

	private onSearchInputKeyDown(keyboardEvent: SearchKeyboardEvent) {
		if (keyboardEvent.equals(ctrlKeyMod | KEY_CODE.Enter)) {
			this.searchInput?.inputBox.insertAtCursor('\n');
			keyboardEvent.preventDefault();
		}

		if (keyboardEvent.equals(KEY_CODE.Enter)) {
			this.searchInput?.onSearchSubmit();
			this.submitSearch();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KEY_CODE.Escape)) {
			this._onSearchCancel.fire({ focus: true });
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KEY_CODE.Tab)) {
			if (this.isReplaceShown()) {
				this.replaceInput?.focus();
			} else {
				this.searchInput?.focusOnCaseSensitive();
			}
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KEY_CODE.UpArrow)) {
			// eslint-disable-next-line no-restricted-syntax
			stopPropagationForMultiLineUpwards(keyboardEvent, this.searchInput?.getValue() ?? '', this.searchInput?.domNode.querySelector('textarea') ?? null);
		}

		else if (keyboardEvent.equals(KEY_CODE.DownArrow)) {
			// eslint-disable-next-line no-restricted-syntax
			stopPropagationForMultiLineDownwards(keyboardEvent, this.searchInput?.getValue() ?? '', this.searchInput?.domNode.querySelector('textarea') ?? null);
		}

		else if (keyboardEvent.equals(KEY_CODE.PageUp)) {
			const inputElement = this.searchInput?.inputBox.inputElement;
			if (inputElement) {
				inputElement.setSelectionRange(0, 0);
				inputElement.focus();
				keyboardEvent.preventDefault();
			}
		}

		else if (keyboardEvent.equals(KEY_CODE.PageDown)) {
			const inputElement = this.searchInput?.inputBox.inputElement;
			if (inputElement) {
				const endOfText = inputElement.value.length;
				inputElement.setSelectionRange(endOfText, endOfText);
				inputElement.focus();
				keyboardEvent.preventDefault();
			}
		}
	}

	private onCaseSensitiveKeyDown(keyboardEvent: SearchKeyboardEvent) {
		if (keyboardEvent.equals(KEY_MOD.Shift | KEY_CODE.Tab)) {
			if (this.isReplaceShown()) {
				this.replaceInput?.focus();
				keyboardEvent.preventDefault();
			}
		}
	}

	private onRegexKeyDown(keyboardEvent: SearchKeyboardEvent) {
		if (keyboardEvent.equals(KEY_CODE.Tab)) {
			if (this.isReplaceShown()) {
				this.replaceInput?.focusOnPreserve();
				keyboardEvent.preventDefault();
			}
		}
	}

	private onPreserveCaseKeyDown(keyboardEvent: SearchKeyboardEvent) {
		if (keyboardEvent.equals(KEY_CODE.Tab)) {
			if (this.isReplaceActive()) {
				this.focusReplaceAllAction();
			} else {
				this._onBlur.fire();
			}
			keyboardEvent.preventDefault();
		}
		else if (keyboardEvent.equals(KEY_MOD.Shift | KEY_CODE.Tab)) {
			this.focusRegexAction();
			keyboardEvent.preventDefault();
		}
	}

	private onReplaceInputKeyDown(keyboardEvent: SearchKeyboardEvent) {
		if (keyboardEvent.equals(ctrlKeyMod | KEY_CODE.Enter)) {
			this.replaceInput?.inputBox.insertAtCursor('\n');
			keyboardEvent.preventDefault();
		}

		if (keyboardEvent.equals(KEY_CODE.Enter)) {
			this.submitSearch();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KEY_CODE.Tab)) {
			this.searchInput?.focusOnCaseSensitive();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KEY_MOD.Shift | KEY_CODE.Tab)) {
			this.searchInput?.focus();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KEY_CODE.UpArrow)) {
			// eslint-disable-next-line no-restricted-syntax
			stopPropagationForMultiLineUpwards(keyboardEvent, this.replaceInput?.getValue() ?? '', this.replaceInput?.domNode.querySelector('textarea') ?? null);
		}

		else if (keyboardEvent.equals(KEY_CODE.DownArrow)) {
			// eslint-disable-next-line no-restricted-syntax
			stopPropagationForMultiLineDownwards(keyboardEvent, this.replaceInput?.getValue() ?? '', this.replaceInput?.domNode.querySelector('textarea') ?? null);
		}
	}

	private onReplaceActionbarKeyDown(keyboardEvent: SearchKeyboardEvent) {
		if (keyboardEvent.equals(KEY_MOD.Shift | KEY_CODE.Tab)) {
			this.focusRegexAction();
			keyboardEvent.preventDefault();
		}
	}

	private async submitSearch(triggeredOnType = false, delay: number = 0): Promise<void> {
		this.searchInput?.validate();
		if (!this.searchInput?.inputBox.isInputValid()) {
			return;
		}

		const value = this.searchInput.getValue();
		const useGlobalFindBuffer = this.searchConfiguration.globalFindClipboard;
		if (value && useGlobalFindBuffer) {
			await this.services.clipboardService.writeFindText(value);
		}
		this._onSearchSubmit.fire({ triggeredOnType, delay });
	}

	getContextLines() {
		return this.showContextToggle.checked ? +this.contextLinesInput.value : 0;
	}

	modifyContextLines(increase: boolean) {
		const current = +this.contextLinesInput.value;
		const modified = current + (increase ? 1 : -1);
		this.showContextToggle.checked = modified !== 0;
		this.contextLinesInput.value = '' + modified;
	}

	toggleContextLines() {
		this.showContextToggle.checked = !this.showContextToggle.checked;
		this.onContextLinesChanged();
	}

	override dispose(): void {
		this.setReplaceAllActionState(false);
		super.dispose();
	}

	private get searchConfiguration(): ExplorerSearchWidgetSearchConfiguration {
		return this.services.configurationService.getSearchConfiguration();
	}
}

export function registerContributions() {
	// Explorer hosts the vendored widget outside the VS Code SearchView. The
	// upstream workbench command registration is intentionally parked until the
	// overlay mounts the widget and decides which actions should become real.
}

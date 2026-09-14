/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SWIMLANE_WIDTH, renderSCMHistoryItemGraph, renderSCMHistoryGraphPlaceholder, getHistoryItemIndex, historyItemHoverLabelForeground, historyItemHoverDefaultLabelBackground } from './scmHistory.ts';
import type { ISCMHistoryItem, ISCMHistoryItemRef, ISCMHistoryItemViewModel, ISCMHistoryItemGraphNode } from '../common/history.ts';
import { appendElement, renderFileSummary, renderCounts, groupBy, historyIconId, type HistoryFileIconResolver } from '../../pane-platform.ts';
import type { HistoryFileRow, HistoryFileTemplate, HistoryCommitRow, HistoryCommitTemplate, HistoryLoadMoreRow, HistoryLoadMoreTemplate, HistoryRow, HistoryTreeInput, HistoryChildrenReader, HistoryFileSummary, HistoryErrorRow } from '../../pane-platform.ts';
import { asCssVariable, foreground } from '../../platform.ts';

// Standalone rows/data source from the preserved pane. Workbench registrations,
// command services and editor dispatch are replaced by the typed TE2 host.
export class HistoryItemChangeRenderer {
	constructor(private readonly resolveIcon?: HistoryFileIconResolver) { }
	static readonly TEMPLATE_ID = 'history-item-change';
	get templateId(): string { return HistoryItemChangeRenderer.TEMPLATE_ID; }

	renderTemplate(container: HTMLElement): HistoryFileTemplate {
		const rowElement = container.parentElement;
		if (!rowElement) throw new Error('History file renderer requires a tree row');
		const element = appendElement(container, 'history-item-change');
		const graphPlaceholder = appendElement(element, 'graph-placeholder');
		const labelContainer = appendElement(element, 'label-container');
		const label = appendElement(labelContainer, 'history-file-name');
		const statistics = appendElement(element, 'history-file-statistics');
		return { rowElement, element, graphPlaceholder, label, statistics };
	}

	renderElement(node: { readonly element: HistoryFileRow }, _index: number, templateData: HistoryFileTemplate): void {
		const { historyItemViewModel, graphColumns } = node.element;
		this._renderGraphPlaceholder(templateData, historyItemViewModel, graphColumns);
		renderFileSummary(templateData, node.element, this.resolveIcon);
	}

	renderCompressedElements(): never {
		throw new Error('History file rows are incompressible');
	}

	private _renderGraphPlaceholder(templateData: HistoryFileTemplate, historyItemViewModel: ISCMHistoryItemViewModel, graphColumns: ISCMHistoryItemGraphNode[]): void {
		const graphPlaceholderSvgWidth = SWIMLANE_WIDTH * (graphColumns.length + 1);
		// The standalone tree has no workbench indent/twisty gutter. Graphs are
		// ordinary first-column content, sharing the commit row's exact origin.
		templateData.rowElement.style.marginLeft = '';
		templateData.graphPlaceholder.textContent = '';
		templateData.graphPlaceholder.style.left = '';
		templateData.graphPlaceholder.style.width = `${graphPlaceholderSvgWidth}px`;
		templateData.graphPlaceholder.appendChild(renderSCMHistoryGraphPlaceholder(graphColumns, getHistoryItemIndex(historyItemViewModel)));
	}

	disposeTemplate(templateData: HistoryFileTemplate): void {
		// Virtual rows are recycled by the tree; clear geometry owned by this renderer.
		templateData.rowElement.style.marginLeft = '';
		templateData.element.remove();
	}
}

export class HistoryItemRenderer {
	static readonly TEMPLATE_ID = 'history-item';
	get templateId(): string { return HistoryItemRenderer.TEMPLATE_ID; }

	constructor(private readonly badges: 'all' | 'filter' = 'all') { }

	renderTemplate(container: HTMLElement): HistoryCommitTemplate {
		const element = appendElement(container, 'history-item');
		const graphContainer = appendElement(element, 'graph-container');
		const label = appendElement(element, 'history-subject');
		const description = appendElement(element, 'history-description');
		const labelContainer = appendElement(element, 'label-container');
		return { element, graphContainer, label, description, labelContainer };
	}

	renderElement(node: { readonly element: HistoryCommitRow }, _index: number, templateData: HistoryCommitTemplate): void {
		const historyItemViewModel = node.element.historyItemViewModel;
		const historyItem = historyItemViewModel.historyItem;
		templateData.graphContainer.textContent = '';
		templateData.graphContainer.classList.toggle('current', historyItemViewModel.kind === 'HEAD');
		templateData.graphContainer.classList.toggle('incoming-changes', historyItemViewModel.kind === 'incoming-changes');
		templateData.graphContainer.classList.toggle('outgoing-changes', historyItemViewModel.kind === 'outgoing-changes');
		templateData.graphContainer.appendChild(renderSCMHistoryItemGraph(historyItemViewModel));
		templateData.label.textContent = historyItem.subject;
		templateData.label.classList.toggle('history-item-current', historyItemViewModel.kind === 'HEAD');
		templateData.description.textContent = [historyItem.displayId ?? historyItem.id.slice(0, 8), historyItem.author].filter(Boolean).join(' ');
		templateData.element.dataset.commitId = historyItem.id;
		this._renderBadges(historyItem, templateData);
	}

	renderCompressedElements(): never {
		throw new Error('Should never happen since node is incompressible');
	}

	private _renderBadges(historyItem: ISCMHistoryItem, templateData: HistoryCommitTemplate): void {
		{
			const labelConfig = this.badges;

			templateData.labelContainer.replaceChildren();

			const references = historyItem.references ?
				historyItem.references.slice(0) : [];

			// Name local branch heads inline; keep remote/tag groups compact.
			for (let i = 0; i < references.length;) {
				if (historyIconId(references[i].icon) === 'git-branch') {
					this._renderBadge([references[i]], true, templateData);
					references.splice(i, 1);
				} else i++;
			}

			// Group history item references by color
			const historyItemRefsByColor = groupBy(references, ref => ref.color ? ref.color : '');

			for (const [key, historyItemRefs] of Object.entries(historyItemRefsByColor)) {
				// If needed skip badges without a color
				if (key === '' && labelConfig !== 'all') {
					continue;
				}

				if (!historyItemRefs) {
					continue;
				}

				// Group history item references by icon
				const historyItemRefByIconId = groupBy(historyItemRefs, ref => historyIconId(ref.icon));
				for (const [key, historyItemRefs] of Object.entries(historyItemRefByIconId)) {
					// Skip badges without an icon
					if (key === '' || !historyItemRefs) {
						continue;
					}

					this._renderBadge(historyItemRefs, false, templateData);
				}
			}
		}
	}

	private _renderBadge(historyItemRefs: ISCMHistoryItemRef[], showDescription: boolean, templateData: HistoryCommitTemplate): void {
		if (historyItemRefs.length === 0 || !historyIconId(historyItemRefs[0].icon)) return;
		const first = historyItemRefs[0];
		const root = appendElement(templateData.labelContainer, 'label');
		root.style.color = first.color ? asCssVariable(historyItemHoverLabelForeground) : foreground;
		root.style.backgroundColor = asCssVariable(first.color ?? historyItemHoverDefaultLabelBackground);
		root.title = historyItemRefs.map(ref => ref.name).join('\n');
		const count = appendElement(root, 'count');
		count.style.display = historyItemRefs.length > 1 ? '' : 'none';
		count.textContent = historyItemRefs.length > 1 ? historyItemRefs.length.toString() : '';
		appendElement(root, 'icon').classList.add('codicon', 'codicon-' + historyIconId(first.icon));
		const description = appendElement(root, 'description');
		description.style.display = showDescription ? '' : 'none';
		description.textContent = showDescription ? first.name : '';
	}

	disposeTemplate(templateData: HistoryCommitTemplate): void { templateData.element.remove(); }
}

export class HistoryItemLoadMoreRenderer {
	static readonly TEMPLATE_ID = 'historyItemLoadMore';
	get templateId(): string { return HistoryItemLoadMoreRenderer.TEMPLATE_ID; }

	renderTemplate(container: HTMLElement): HistoryLoadMoreTemplate {
		const element = appendElement(container, 'history-item-load-more');
		const graphPlaceholder = appendElement(element, 'graph-placeholder');
		const historyItemPlaceholderContainer = appendElement(element, 'history-item-placeholder');
		const historyItemPlaceholderLabel = appendElement(historyItemPlaceholderContainer, 'history-load-label');
		return { element, graphPlaceholder, historyItemPlaceholderContainer, historyItemPlaceholderLabel };
	}

	renderElement(element: { readonly element: HistoryLoadMoreRow }, _index: number, templateData: HistoryLoadMoreTemplate): void {
		templateData.graphPlaceholder.textContent = '';
		templateData.graphPlaceholder.style.width = `${SWIMLANE_WIDTH * (element.element.graphColumns.length + 1)}px`;
		templateData.graphPlaceholder.appendChild(renderSCMHistoryGraphPlaceholder(element.element.graphColumns));
		templateData.historyItemPlaceholderLabel.textContent = { idle: 'Scroll for more history', loading: 'Loading...', error: 'Retry loading more' }[element.element.state];
		templateData.element.setAttribute('aria-busy', String(element.element.state === 'loading'));
	}

	renderCompressedElements(): never { throw new Error('Should never happen since node is incompressible'); }
	disposeTemplate(templateData: HistoryLoadMoreTemplate): void { templateData.element.remove(); }
}

export class ListDelegate {
	getHeight(): number { return 22; }
	getTemplateId(element: HistoryRow): string {
		switch (element.type) {
			case 'historyItemViewModel': return HistoryItemRenderer.TEMPLATE_ID;
			case 'historyItemChangeViewModel': return HistoryItemChangeRenderer.TEMPLATE_ID;
			case 'historyItemLoadMore': return HistoryItemLoadMoreRenderer.TEMPLATE_ID;
			case 'historyItemError': return 'history-item-error';
			case 'historyItemDetails': return 'history-item-details';
		}
	}
}

export class SCMHistoryTreeDataSource {
	private readonly abort = new AbortController();
	private readonly fileReads = new Map<string, Promise<readonly HistoryFileSummary[]>>();
	constructor(private readonly readChildren: HistoryChildrenReader, private readonly onReadError: (error: unknown) => void = () => {}, private readonly mobile = false) { }

	private comparisonKey(row: HistoryCommitRow): string {
		const item = row.historyItemViewModel.historyItem;
		return JSON.stringify([item.id, item.parentIds[0] ?? null]);
	}

	private async readFiles(commitId: string, parentId: string | null): Promise<readonly HistoryFileSummary[]> {
		// Normalize synchronous adapter failures into the same retryable read path.
		return this.readChildren({ commitId, parentId }, this.abort.signal);
	}

	async getChildren(inputOrElement: HistoryTreeInput | HistoryRow): Promise<HistoryRow[]> {
		const children: HistoryRow[] = [];
		if (this.abort.signal.aborted) return children;
		if (inputOrElement.type === 'historyRoot') {
			// Cache only retained commit summaries within this immutable generation.
			const retained = new Set(inputOrElement.rows.flatMap(row => row.type === 'historyItemViewModel' ? [this.comparisonKey(row)] : []));
			for (const key of this.fileReads.keys()) if (!retained.has(key)) this.fileReads.delete(key);
			children.push(...inputOrElement.rows);
		} else if (inputOrElement.type === 'historyItemViewModel') {
			if (this.mobile) children.push({ type: 'historyItemDetails', owner: inputOrElement });
			const historyItem = inputOrElement.historyItemViewModel.historyItem;
			// Like upstream, ordinary commit children compare against the first parent.
			// Root commits explicitly name an absent parent, never HEAD or disk.
			const key = this.comparisonKey(inputOrElement);
			let request = this.fileReads.get(key);
			if (!request) {
				const pending = this.readFiles(historyItem.id, historyItem.parentIds[0] ?? null).catch(error => {
					if (this.fileReads.get(key) === pending) this.fileReads.delete(key);
					if (this.abort.signal.aborted) return [];
					this.onReadError(error);
					throw error;
				});
				this.fileReads.set(key, pending);
				request = pending;
			}
			let historyItemChanges: readonly HistoryFileSummary[];
			try { historyItemChanges = await request; }
			catch {
				if (this.abort.signal.aborted) return children;
				// A failed read is not an empty commit. Keep an explicit retry row;
				// do not send expected service failures to upstream's global handler.
				return [...children, { type: 'historyItemError', owner: inputOrElement, graphColumns: inputOrElement.historyItemViewModel.outputSwimlanes }];
			}
			if (this.abort.signal.aborted) return children;
			children.push(...historyItemChanges.map(change => ({
				path: change.path,
				previousPath: change.previousPath,
				status: change.status,
				counts: change.counts,
				historyItemViewModel: inputOrElement.historyItemViewModel,
				graphColumns: inputOrElement.historyItemViewModel.outputSwimlanes,
				type: 'historyItemChangeViewModel' as const,
			})));
		}
		return children;
	}

	hasChildren(element: HistoryTreeInput | HistoryRow): boolean {
		return element.type === 'historyRoot' || element.type === 'historyItemViewModel';
	}

	dispose(): void { this.abort.abort(); this.fileReads.clear(); }
}

// TE2 retry affordance reuses the upstream continuation-row geometry.
export class HistoryItemErrorRenderer {
	readonly templateId = 'history-item-error';
	private readonly continuation = new HistoryItemLoadMoreRenderer();
	renderTemplate(container: HTMLElement): HistoryLoadMoreTemplate { return this.continuation.renderTemplate(container); }
	renderElement(node: { readonly element: HistoryErrorRow }, index: number, template: HistoryLoadMoreTemplate): void {
		this.continuation.renderElement({ element: { type: 'historyItemLoadMore', state: 'error', graphColumns: node.element.graphColumns } }, index, template);
		template.historyItemPlaceholderLabel.textContent = 'Could not load files. Retry';
	}
	renderCompressedElements(): never { throw new Error('History error rows are incompressible'); }
	disposeTemplate(template: HistoryLoadMoreTemplate): void { this.continuation.disposeTemplate(template); }
}

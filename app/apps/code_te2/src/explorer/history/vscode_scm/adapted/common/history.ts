/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ColorIdentifier, HistoryIcon, HistoryMarkdown } from '../../platform.ts';

export const SCMIncomingHistoryItemId = 'scm-graph-incoming-changes';
export const SCMOutgoingHistoryItemId = 'scm-graph-outgoing-changes';

export interface ISCMHistoryOptions {
	readonly skip?: number;
	readonly limit?: number | { id?: string };
	readonly historyItemRefs?: readonly string[];
	readonly filterText?: string;
}

export interface ISCMHistoryItemStatistics {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface ISCMHistoryItemRef {
	readonly id: string;
	readonly name: string;
	readonly revision?: string;
	readonly category?: string;
	readonly description?: string;
	readonly color?: ColorIdentifier;
	readonly icon?: HistoryIcon;
}

export interface ISCMHistoryItemRefsChangeEvent {
	readonly added: readonly ISCMHistoryItemRef[];
	readonly removed: readonly ISCMHistoryItemRef[];
	readonly modified: readonly ISCMHistoryItemRef[];
	readonly silent: boolean;
}

export interface ISCMHistoryItem {
	readonly id: string;
	readonly parentIds: string[];
	readonly subject: string;
	readonly message: string;
	readonly displayId?: string;
	readonly author?: string;
	readonly authorEmail?: string;
	readonly authorIcon?: HistoryIcon;
	readonly timestamp?: number;
	readonly statistics?: ISCMHistoryItemStatistics;
	readonly references?: ISCMHistoryItemRef[];
	readonly tooltip?: HistoryMarkdown | Array<HistoryMarkdown> | undefined;
}

export interface ISCMHistoryItemGraphNode {
	readonly id: string;
	readonly color: ColorIdentifier;
}

export interface ISCMHistoryItemViewModel {
	readonly historyItem: ISCMHistoryItem;
	readonly inputSwimlanes: ISCMHistoryItemGraphNode[];
	readonly outputSwimlanes: ISCMHistoryItemGraphNode[];
	readonly kind: 'HEAD' | 'node' | 'incoming-changes' | 'outgoing-changes';
}

export interface ISCMHistoryItemChange {
	readonly uri: string;
	readonly originalUri?: string;
	readonly modifiedUri?: string;
}

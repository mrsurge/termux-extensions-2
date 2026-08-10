/*
 * Adapted from:
 * - worktrees/vscode-te2-diff/src/vs/platform/markers/common/markers.ts
 * - app/static/vendor/monaco-editor-core/esm/vs/platform/markers/common/markers.js
 *
 * This local vendor copy is intentionally scoped to the editor diagnostics lane.
 */

export interface UriComponentsLike {
  external?: string;
  fsPath?: string;
  scheme?: string;
  authority?: string;
  path?: string;
}

export interface RelatedInformationLike {
  resource: string | UriComponentsLike;
  message?: string;
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
}

export interface MarkerCodeTargetLike {
  value: string;
  target: string | UriComponentsLike;
}

export type MarkerCodeLike = string | MarkerCodeTargetLike;

export interface MarkerDataLike {
  code?: MarkerCodeLike;
  severity?: number;
  message?: string;
  source?: string;
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
  modelVersionId?: number;
  relatedInformation?: RelatedInformationLike[];
  tags?: number[];
  origin?: string;
}

export interface MarkerLike extends MarkerDataLike {
  owner: string;
  resource: string;
}

export interface ResourceMarkerLike {
  resource: string;
  marker: MarkerDataLike;
}

export interface MarkerReadOptionsLike {
  owner?: string;
  resource?: string;
  severities?: number;
  take?: number;
}

export interface MarkerStatisticsLike {
  errors: number;
  warnings: number;
  infos: number;
  unknowns: number;
}

export const MarkerSeverity = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8,
} as const;

export type MarkerSeverityValue = (typeof MarkerSeverity)[keyof typeof MarkerSeverity];

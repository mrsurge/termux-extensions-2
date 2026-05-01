interface DebugPartsLike {
  git: string | null;
  draft: string | null;
  diag: string | null;
  flags: string | null;
  mirror: string | null;
  trace: string | null;
  extra: string | null;
}

interface TraceLike {
  mirror_bind_total: number;
  mirror_active: number;
  unsaved_reason: string;
  gb_req_total: number;
  gb_req_immediate: number;
  gb_req_debounced: number;
  gb_last_source: string;
}

interface MirrorStateLike {
  rx: number;
  ap: number;
  drop_self: number;
  drop_sha: number;
  drop_hot: number;
}

export function setDebugPart<K extends keyof DebugPartsLike>(
  debugParts: DebugPartsLike,
  key: K,
  value: string | null | undefined,
  updateDebug: (extra?: string | null) => void,
): void {
  debugParts[key] = value || null;
  updateDebug();
}

export function syncTraceDebug(
  trace: TraceLike,
  setDebugTrace: (value: string) => void,
): void {
  setDebugTrace(
    'trace=mb' + trace.mirror_bind_total +
    '/a' + trace.mirror_active +
    ' us=' + trace.unsaved_reason +
    ' gb=' + trace.gb_req_total +
    '/' + trace.gb_req_immediate +
    '/' + trace.gb_req_debounced +
    ' src=' + trace.gb_last_source,
  );
}

export function syncMirrorDebug(
  mirrorState: MirrorStateLike,
  setDebugMirror: (value: string) => void,
): void {
  setDebugMirror(
    'mir=rx' + mirrorState.rx +
    '/ap' + mirrorState.ap +
    '/self' + mirrorState.drop_self +
    '/sha' + mirrorState.drop_sha +
    '/hot' + mirrorState.drop_hot,
  );
}

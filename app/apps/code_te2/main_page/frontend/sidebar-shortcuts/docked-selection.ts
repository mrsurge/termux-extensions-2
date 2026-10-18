// Local rendering history only: never a second foreground or membership owner.
export class DockedSelection {
  private history: string[] = [];

  resolve<T extends { key: string }>(
    eligible: readonly T[],
    active: T | null,
    fallback: T | null,
  ): T | null {
    const byKey = new Map(eligible.map((item) => [item.key, item]));
    this.history = this.history.filter((key) => byKey.has(key));
    const selected = (active && byKey.get(active.key)) ||
      this.history.map((key) => byKey.get(key)).find(Boolean) ||
      (fallback && byKey.get(fallback.key)) || eligible[0] || null;
    if (selected) {
      this.history = [selected.key, ...this.history.filter((key) => key !== selected.key)];
    }
    return selected;
  }
}

// Host blur precedes the activeElement update when focus enters a foreign frame.
export function bindDockedFocus(
  win: Window,
  doc: Document,
  onFocus: () => void,
): () => void {
  let pending: number | null = null;
  const onBlur = () => {
    if (pending !== null) win.clearTimeout(pending);
    pending = win.setTimeout(() => { pending = null; onFocus(); }, 0);
  };
  win.addEventListener("blur", onBlur);
  doc.addEventListener("focusin", onFocus);
  return () => {
    win.removeEventListener("blur", onBlur);
    doc.removeEventListener("focusin", onFocus);
    if (pending !== null) win.clearTimeout(pending);
    pending = null;
  };
}

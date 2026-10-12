// Presentation-only selection; callers supply the currently displayed order.
export function selectPaths(selected, order, anchor, path, { shift = false, additive = false, toggle = false } = {}) {
  const next = new Set(additive || (toggle && !shift) ? selected : []);
  const start = order.indexOf(anchor);
  const end = order.indexOf(path);
  if (shift && start >= 0 && end >= 0) {
    for (const item of order.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(item);
    return { selected: next, anchor };
  }
  if (toggle || additive) {
    if (next.has(path)) next.delete(path);
    else next.add(path);
  } else next.add(path);
  return { selected: next, anchor: path };
}

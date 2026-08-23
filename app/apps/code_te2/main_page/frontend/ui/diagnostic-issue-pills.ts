export interface DiagnosticIssueCounts {
  errors: number;
  warnings: number;
  hints: number;
  total: number;
}

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function diagnosticIssueCounts(payload: unknown): DiagnosticIssueCounts {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const errors = boundedCount(record.errors);
  const warnings = boundedCount(record.warnings);
  const hints = boundedCount(record.hints);
  return {
    errors,
    warnings,
    hints,
    total: errors + warnings + hints,
  };
}

export function renderDiagnosticIssuePills(
  container: HTMLElement,
  payload: unknown,
): DiagnosticIssueCounts {
  const counts = diagnosticIssueCounts(payload);
  const doc = container.ownerDocument;
  const children: HTMLElement[] = [];

  if (counts.errors > 0) {
    const pill = doc.createElement('span');
    pill.className = 'fe-issues-dot error';
    pill.textContent = String(counts.errors);
    pill.title = `${counts.errors} error${counts.errors === 1 ? '' : 's'}`;
    children.push(pill);
  }
  if (counts.warnings > 0) {
    const pill = doc.createElement('span');
    pill.className = 'fe-issues-dot warning';
    pill.textContent = String(counts.warnings);
    pill.title = `${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`;
    children.push(pill);
  }

  container.replaceChildren(...children);
  return counts;
}

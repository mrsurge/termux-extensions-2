interface PlanModalElements {
  planModalEl: HTMLElement | null;
  planCloseBtn: HTMLElement | null;
  planDismissBtn: HTMLElement | null;
  planBodyEl: HTMLElement | null;
}

interface PlanDocumentState {
  plan_exists?: boolean;
  plan_content?: string;
}

interface PlanModalState {
  planState?: PlanDocumentState | null;
}

interface PlanModalContext {
  elements: PlanModalElements;
  getState(): PlanModalState | null | undefined;
  renderMarkdownInto(target: HTMLElement | null | undefined, markdown: string): void;
  highlightCode(target: HTMLElement | null | undefined): void;
}

interface PlanModalBinding {
  openPlanModal(): Promise<void>;
  closePlanModal(): void;
  renderPlanModal(): void;
  isPlanModalOpen(): boolean;
}

export function bindPlanModal(ctx: PlanModalContext): PlanModalBinding {
  const {
    elements,
    getState,
    renderMarkdownInto,
    highlightCode,
  } = ctx;

  const {
    planModalEl,
    planCloseBtn,
    planDismissBtn,
    planBodyEl,
  } = elements;

  function renderPlanModal() {
    if (!planBodyEl) return;
    const planState = getState()?.planState || {};
    planBodyEl.innerHTML = '';

    if (!planState?.plan_exists) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No plan available.';
      planBodyEl.appendChild(empty);
      return;
    }

    const content = typeof planState.plan_content === 'string' ? planState.plan_content : '';
    if (!content.trim()) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'Plan exists, but there is no plan document to render.';
      planBodyEl.appendChild(empty);
      return;
    }

    planBodyEl.classList.add('markdown-body');
    renderMarkdownInto(planBodyEl, content);
    highlightCode(planBodyEl);
  }

  function closePlanModal() {
    if (!planModalEl) return;
    planModalEl.classList.add('hidden');
  }

  function isPlanModalOpen() {
    return planModalEl instanceof HTMLElement && !planModalEl.classList.contains('hidden');
  }

  async function openPlanModal(): Promise<void> {
    if (!planModalEl) return;
    renderPlanModal();
    planModalEl.classList.remove('hidden');
  }

  planCloseBtn?.addEventListener('click', closePlanModal);
  planDismissBtn?.addEventListener('click', closePlanModal);
  planModalEl?.addEventListener('click', (evt) => {
    if (evt.target === planModalEl) {
      closePlanModal();
    }
  });

  return {
    openPlanModal,
    closePlanModal,
    renderPlanModal,
    isPlanModalOpen,
  };
}

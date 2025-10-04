// Shared toast & notification utilities
if (!window.teUI) window.teUI = {};

(() => {
  const STYLE_ID = 'te-notifications-style';
  const TOAST_CONTAINER_ID = 'te-toast-container';
  const CARD_CONTAINER_ID = 'te-notification-container';
  const DEFAULT_TOAST_DURATION = 3200;

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --te-toast-bg: var(--card, #1f2937);
        --te-toast-fg: var(--card-foreground, #f9fafb);
        --te-toast-success: var(--success, #15803d);
        --te-toast-error: var(--destructive, #b91c1c);
        --te-toast-warning: var(--warning, #d97706);
      }
      .te-toast-container {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        z-index: 2000;
        pointer-events: none;
      }
      .te-toast {
        background: var(--te-toast-bg);
        color: var(--te-toast-fg);
        padding: 10px 16px;
        border-radius: 8px;
        border: 1px solid var(--border, rgba(148, 163, 184, 0.4));
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        font-size: 0.95rem;
        line-height: 1.3;
        max-width: min(90vw, 420px);
        pointer-events: auto;
        position: relative;
      }
      .te-toast.success { background: var(--te-toast-success); color: var(--foreground, #fff); }
      .te-toast.error { background: var(--te-toast-error); color: var(--foreground, #fff); }
      .te-toast.warning { background: var(--te-toast-warning); color: var(--foreground, #000); }
      .te-toast-close {
        position: absolute;
        top: 4px;
        right: 8px;
        border: none;
        background: none;
        color: inherit;
        font-size: 1.1rem;
        cursor: pointer;
      }
      .te-card-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 1999;
        pointer-events: none;
        max-width: min(90vw, 360px);
      }
      .te-notification-card {
        background: var(--card, #1f2937);
        color: var(--card-foreground, #f9fafb);
        border: 1px solid var(--border, rgba(148, 163, 184, 0.4));
        border-radius: 10px;
        padding: 14px 16px 12px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.4);
        pointer-events: auto;
        position: relative;
      }
      .te-notification-card.success { border-color: var(--success, #15803d); }
      .te-notification-card.error { border-color: var(--destructive, #b91c1c); }
      .te-notification-card.warning { border-color: var(--warning, #d97706); }
      .te-notification-title {
        font-weight: 600;
        margin: 0 0 6px;
        font-size: 0.95rem;
      }
      .te-notification-message {
        font-size: 0.9rem;
        margin: 0 0 6px;
        opacity: 0.9;
      }
      .te-notification-progress {
        width: 100%;
        height: 4px;
        border-radius: 9999px;
        background: rgba(148, 163, 184, 0.24);
        overflow: hidden;
        margin: 8px 0 6px;
      }
      .te-notification-progress-fill {
        height: 100%;
        width: 0%;
        background: var(--primary, #3b82f6);
        transition: width 180ms ease;
      }
      .te-notification-footer {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .te-notification-button {
        background: none;
        border: 1px solid var(--border, rgba(148, 163, 184, 0.4));
        color: inherit;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.85rem;
      }
      .te-notification-button:hover {
        background: rgba(148, 163, 184, 0.12);
      }
      .te-card-dismiss {
        position: absolute;
        top: 6px;
        right: 8px;
        border: none;
        background: none;
        color: inherit;
        font-size: 1rem;
        cursor: pointer;
        opacity: 0.7;
      }
      .te-card-dismiss:hover { opacity: 1; }
    `;
    document.head.appendChild(style);
  };

  const ensureContainer = (id, className) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = className;
      document.body.appendChild(el);
    }
    return el;
  };

  const toast = (message, opts = {}) => {
    if (!message) return;
    ensureStyle();
    const container = ensureContainer(TOAST_CONTAINER_ID, 'te-toast-container');
    const { duration = DEFAULT_TOAST_DURATION, variant = 'info', persistent = false, onClose } = opts;
    const toastEl = document.createElement('div');
    toastEl.className = `te-toast ${variant}`;
    toastEl.textContent = message;

    if (persistent) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'te-toast-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', () => {
        toastEl.remove();
        if (typeof onClose === 'function') onClose();
      });
      toastEl.appendChild(closeBtn);
    }

    container.appendChild(toastEl);

    if (!persistent) {
      setTimeout(() => {
        toastEl.remove();
        if (typeof onClose === 'function') onClose();
      }, duration);
    }
  };

  const cards = new Map();

  const renderCard = (config) => {
    ensureStyle();
    const container = ensureContainer(CARD_CONTAINER_ID, 'te-card-container');
    let card = cards.get(config.id);
    if (!card) {
      card = document.createElement('div');
      card.className = 'te-notification-card';
      card.dataset.id = config.id;
      container.appendChild(card);
      cards.set(config.id, card);
    }

    card.className = `te-notification-card ${config.variant || 'info'}`;
    card.innerHTML = '';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'te-card-dismiss';
    dismissBtn.innerHTML = '&times;';
    dismissBtn.title = config.dismissLabel || 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      removeNotification(config.id, { emitEvent: true });
      if (typeof config.onDismiss === 'function') config.onDismiss();
    });
    card.appendChild(dismissBtn);

    if (config.title) {
      const title = document.createElement('div');
      title.className = 'te-notification-title';
      title.textContent = config.title;
      card.appendChild(title);
    }

    const message = document.createElement('div');
    message.className = 'te-notification-message';
    message.textContent = config.message || '';
    card.appendChild(message);

    if (config.progress) {
      const progress = document.createElement('div');
      progress.className = 'te-notification-progress';
      const fill = document.createElement('div');
      fill.className = 'te-notification-progress-fill';
      const completed = Number(config.progress.completed || 0);
      const total = Number(config.progress.total || 0);
      const pct = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
      fill.style.width = `${pct}%`;
      progress.appendChild(fill);
      card.appendChild(progress);
    }

    if (Array.isArray(config.actions) && config.actions.length) {
      const footer = document.createElement('div');
      footer.className = 'te-notification-footer';
      config.actions.forEach((action) => {
        const btn = document.createElement('button');
        btn.className = 'te-notification-button';
        btn.textContent = action.label || 'Action';
        btn.addEventListener('click', () => {
          if (typeof action.onClick === 'function') action.onClick(config.id, card);
        });
        footer.appendChild(btn);
      });
      card.appendChild(footer);
    }

    card.dataset.status = config.status || 'info';
    card.dataset.variant = config.variant || 'info';
    if (config.meta) card.dataset.meta = JSON.stringify(config.meta);
  };

  const removeNotification = (id, options = {}) => {
    const card = cards.get(id);
    if (card) {
      card.remove();
      cards.delete(id);
      if (options.emitEvent) {
        document.dispatchEvent(new CustomEvent('te-notification-close', { detail: { id } }));
      }
    }
  };

  const notify = (config) => {
    if (!config || !config.id) {
      console.warn('[teUI] notify requires an id');
      return;
    }
    renderCard(config);
    document.dispatchEvent(new CustomEvent('te-notification-update', { detail: { id: config.id, config } }));
  };

  const getActiveNotifications = () => {
    return Array.from(cards.entries()).map(([id, el]) => {
      const meta = el.dataset.meta ? JSON.parse(el.dataset.meta) : undefined;
      return {
        id,
        status: el.dataset.status,
        variant: el.dataset.variant,
        message: el.querySelector('.te-notification-message')?.textContent || '',
        title: el.querySelector('.te-notification-title')?.textContent || '',
        meta,
      };
    });
  };

  window.teUI.toast = toast;
  window.teUI.notify = notify;
  window.teUI.dismiss = removeNotification;
  window.teUI.getActiveNotifications = getActiveNotifications;
})();

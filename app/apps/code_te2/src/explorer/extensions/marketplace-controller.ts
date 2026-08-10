import type { JsonObject } from "../../rpc/transport.ts";
import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from "../rpc/contract.ts";
import { getErrorMessage } from "../utils/errors.ts";

interface MarketplaceBindings {
  button: HTMLButtonElement | null;
  overlay: HTMLElement | null;
}

interface MarketplaceControllerDeps {
  requestExplorer(
    method: ExplorerRpcMethod,
    payload: JsonObject,
    timeoutMs?: number,
  ): Promise<JsonObject>;
  closeSearchOverlay(reason?: string): void;
  confirm(message: string): Promise<boolean>;
}

interface MarketplaceSummary {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  iconUrl: string | null;
  installedVersion: string | null;
  downloadCount: number | null;
  averageRating: number | null;
  verified: boolean;
}

interface MarketplaceDetail extends MarketplaceSummary {
  extensionKind: string[];
  engine: string | null;
  license: string | null;
  repository: string | null;
  homepage: string | null;
  installSupported: boolean;
  unsupportedReason: string | null;
}

type MarketplaceTimer = ReturnType<typeof window.setTimeout> | null;

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_PAGE_SIZE = 20;
const SEARCH_TIMEOUT_MS = 15_000;
const MUTATION_TIMEOUT_MS = 180_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseSummary(value: unknown): MarketplaceSummary | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const namespace = stringValue(value.namespace);
  const name = stringValue(value.name);
  const version = stringValue(value.version);
  if (!id || !namespace || !name || !version) return null;
  return {
    id,
    namespace,
    name,
    displayName: stringValue(value.displayName) || id,
    version,
    description: stringValue(value.description) || "",
    iconUrl: stringValue(value.iconUrl),
    installedVersion: stringValue(value.installedVersion),
    downloadCount: numberValue(value.downloadCount),
    averageRating: numberValue(value.averageRating),
    verified: value.verified === true,
  };
}

function parseDetail(value: unknown): MarketplaceDetail | null {
  const summary = parseSummary(value);
  if (!summary || !isRecord(value)) return null;
  return {
    ...summary,
    extensionKind: stringList(value.extensionKind),
    engine: stringValue(value.engine),
    license: stringValue(value.license),
    repository: stringValue(value.repository),
    homepage: stringValue(value.homepage),
    installSupported: value.installSupported === true,
    unsupportedReason: stringValue(value.unsupportedReason),
  };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function createMarketplaceIcon(
  document: Document,
  item: MarketplaceSummary,
  className: string,
): HTMLSpanElement {
  const glyph = createElement(document, "span", className);
  const showFallback = (): void => {
    glyph.replaceChildren("🧩");
  };
  if (!item.iconUrl) {
    showFallback();
    return glyph;
  }

  const image = createElement(document, "img", "fe-marketplace-icon-image");
  image.src = item.iconUrl;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", showFallback, { once: true });
  glyph.appendChild(image);
  return glyph;
}

export function createExplorerMarketplaceController(
  deps: MarketplaceControllerDeps,
) {
  let button: HTMLButtonElement | null = null;
  let overlay: HTMLElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let statusElement: HTMLElement | null = null;
  let resultsElement: HTMLElement | null = null;
  let loadMoreButton: HTMLButtonElement | null = null;
  let detailElement: HTMLElement | null = null;
  let detailBody: HTMLElement | null = null;

  let visible = false;
  let query = "";
  let items: MarketplaceSummary[] = [];
  let total = 0;
  let loading = false;
  let loadingMore = false;
  let searchError: string | null = null;
  let searchTimer: MarketplaceTimer = null;
  let searchGeneration = 0;

  let selectedId: string | null = null;
  let detail: MarketplaceDetail | null = null;
  let detailOpen = false;
  let detailLoading = false;
  let detailError: string | null = null;
  let actionError: string | null = null;
  let mutationActive = false;
  let detailGeneration = 0;

  function clearSearchTimer(): void {
    if (searchTimer !== null) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  function setVisible(next: boolean): void {
    visible = next;
    if (overlay) {
      overlay.style.display = next ? "flex" : "none";
      overlay.setAttribute("aria-hidden", next ? "false" : "true");
    }
    button?.setAttribute("aria-expanded", next ? "true" : "false");
  }

  function renderStatus(): void {
    if (!statusElement) return;
    statusElement.className = "fe-marketplace-status";
    if (loading) {
      statusElement.textContent = "Searching Open VSX…";
      statusElement.classList.add("is-loading");
      return;
    }
    if (searchError) {
      statusElement.textContent = searchError;
      statusElement.classList.add("is-error");
      return;
    }
    if (query.trim().length < 2) {
      statusElement.textContent = "Type at least 2 characters to search Open VSX.";
      return;
    }
    if (items.length === 0) {
      statusElement.textContent = "No extensions found.";
      return;
    }
    statusElement.textContent = `${items.length} of ${total} extensions`;
  }

  function updateItemsInstalledVersion(
    extId: string,
    installedVersion: string | null,
  ): void {
    items = items.map((item) =>
      item.id.toLowerCase() === extId.toLowerCase()
        ? { ...item, installedVersion }
        : item,
    );
  }

  function renderResults(): void {
    renderStatus();
    if (!resultsElement) return;
    const scrollTop = resultsElement.scrollTop;
    resultsElement.replaceChildren();
    const document = resultsElement.ownerDocument;

    for (const item of items) {
      const row = createElement(document, "button", "fe-marketplace-result");
      row.type = "button";
      row.dataset.extensionId = item.id;
      row.setAttribute("aria-label", `View ${item.displayName}`);

      row.appendChild(
        createMarketplaceIcon(
          document,
          item,
          "fe-marketplace-result-glyph",
        ),
      );

      const text = createElement(document, "span", "fe-marketplace-result-text");
      const title = createElement(document, "span", "fe-marketplace-result-title");
      title.textContent = item.displayName;
      if (item.verified) {
        const verified = createElement(
          document,
          "span",
          "fe-marketplace-verified",
        );
        verified.textContent = "✓";
        verified.title = "Verified publisher";
        title.appendChild(verified);
      }
      text.appendChild(title);

      const identity = createElement(
        document,
        "span",
        "fe-marketplace-result-id",
      );
      identity.textContent = `${item.id} · ${item.version}`;
      text.appendChild(identity);

      if (item.description) {
        const description = createElement(
          document,
          "span",
          "fe-marketplace-result-description",
        );
        description.textContent = item.description;
        text.appendChild(description);
      }

      const metadata = createElement(
        document,
        "span",
        "fe-marketplace-result-meta",
      );
      const bits: string[] = [];
      if (item.installedVersion) {
        bits.push(`Installed ${item.installedVersion}`);
      }
      if (item.downloadCount !== null) {
        bits.push(`${formatCount(item.downloadCount)} downloads`);
      }
      if (item.averageRating !== null) {
        bits.push(`${item.averageRating.toFixed(1)} ★`);
      }
      metadata.textContent = bits.join(" · ");
      text.appendChild(metadata);
      row.appendChild(text);

      row.addEventListener("click", () => {
        void openDetail(item.id, row);
      });
      resultsElement.appendChild(row);
    }

    resultsElement.scrollTop = scrollTop;
    if (loadMoreButton) {
      const hasMore = items.length < total;
      loadMoreButton.style.display = hasMore ? "block" : "none";
      loadMoreButton.disabled = loadingMore;
      loadMoreButton.textContent = loadingMore ? "Loading…" : "Load more";
    }
  }

  function appendDetailField(label: string, value: string | null): void {
    if (!detailBody || !value) return;
    const document = detailBody.ownerDocument;
    const row = createElement(document, "div", "fe-marketplace-detail-field");
    const key = createElement(document, "span", "fe-marketplace-detail-key");
    key.textContent = label;
    const text = createElement(document, "span", "fe-marketplace-detail-value");
    text.textContent = value;
    row.append(key, text);
    detailBody.appendChild(row);
  }

  function appendExternalLink(label: string, url: string | null): void {
    if (!detailBody || !url) return;
    const document = detailBody.ownerDocument;
    const row = createElement(document, "div", "fe-marketplace-detail-field");
    const key = createElement(document, "span", "fe-marketplace-detail-key");
    key.textContent = label;
    const link = createElement(document, "a", "fe-marketplace-detail-link");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url;
    row.append(key, link);
    detailBody.appendChild(row);
  }

  function renderDetailActions(document: Document, current: MarketplaceDetail): void {
    if (!detailBody) return;
    const actions = createElement(document, "div", "fe-marketplace-detail-actions");
    const installed = current.installedVersion;

    if (current.installSupported && (!installed || installed !== current.version)) {
      const install = createElement(document, "button", "fe-btn");
      install.type = "button";
      install.disabled = mutationActive;
      install.textContent = installed ? "Update" : "Install";
      install.addEventListener("click", () => {
        void installSelected();
      });
      actions.appendChild(install);
    }

    if (installed) {
      const uninstall = createElement(
        document,
        "button",
        "fe-btn fe-marketplace-danger",
      );
      uninstall.type = "button";
      uninstall.disabled = mutationActive;
      uninstall.textContent = "Uninstall";
      uninstall.addEventListener("click", () => {
        void uninstallSelected();
      });
      actions.appendChild(uninstall);
    }

    if (!installed && !current.installSupported) {
      const disabled = createElement(document, "button", "fe-btn");
      disabled.type = "button";
      disabled.disabled = true;
      disabled.textContent = "Install unavailable";
      actions.appendChild(disabled);
    }

    if (mutationActive) {
      const progress = createElement(
        document,
        "span",
        "fe-marketplace-action-progress",
      );
      progress.textContent = "Applying extension change…";
      actions.appendChild(progress);
    }
    detailBody.appendChild(actions);
  }

  function renderDetail(): void {
    if (!detailElement || !detailBody) return;
    detailElement.classList.toggle("is-open", detailOpen);
    detailElement.setAttribute("aria-hidden", detailOpen ? "false" : "true");
    detailBody.replaceChildren();
    const document = detailBody.ownerDocument;

    if (detailLoading) {
      const loadingElement = createElement(
        document,
        "div",
        "fe-marketplace-detail-message",
      );
      loadingElement.textContent = "Loading extension details…";
      detailBody.appendChild(loadingElement);
      return;
    }
    if (detailError) {
      const error = createElement(
        document,
        "div",
        "fe-marketplace-detail-message is-error",
      );
      error.textContent = detailError;
      detailBody.appendChild(error);
      return;
    }
    if (!detail) return;

    const heading = createElement(
      document,
      "div",
      "fe-marketplace-detail-heading",
    );
    heading.appendChild(
      createMarketplaceIcon(
        document,
        detail,
        "fe-marketplace-result-glyph fe-marketplace-detail-icon",
      ),
    );
    const headingText = createElement(
      document,
      "div",
      "fe-marketplace-detail-heading-text",
    );
    const title = createElement(document, "h3", "fe-marketplace-detail-title");
    title.textContent = detail.displayName;
    headingText.appendChild(title);

    const identity = createElement(document, "div", "fe-marketplace-detail-id");
    identity.textContent = detail.id;
    headingText.appendChild(identity);
    heading.appendChild(headingText);
    detailBody.appendChild(heading);

    if (detail.description) {
      const description = createElement(
        document,
        "p",
        "fe-marketplace-detail-description",
      );
      description.textContent = detail.description;
      detailBody.appendChild(description);
    }

    appendDetailField("Available", detail.version);
    appendDetailField("Installed", detail.installedVersion || "Not installed");
    appendDetailField(
      "Extension kind",
      detail.extensionKind.length ? detail.extensionKind.join(", ") : "Unknown",
    );
    appendDetailField("VS Code engine", detail.engine);
    appendDetailField("License", detail.license);
    appendDetailField(
      "Downloads",
      detail.downloadCount === null ? null : formatCount(detail.downloadCount),
    );
    appendDetailField(
      "Rating",
      detail.averageRating === null
        ? null
        : `${detail.averageRating.toFixed(1)} / 5`,
    );
    appendExternalLink("Repository", detail.repository);
    appendExternalLink("Homepage", detail.homepage);

    const support = createElement(
      document,
      "div",
      `fe-marketplace-support ${detail.installSupported ? "is-supported" : "is-unsupported"}`,
    );
    support.textContent = detail.installSupported
      ? "Workspace extensions are installed into the Code TE2 extension host."
      : detail.unsupportedReason || "This extension is not supported.";
    detailBody.appendChild(support);

    if (actionError) {
      const error = createElement(
        document,
        "div",
        "fe-marketplace-action-error",
      );
      error.textContent = actionError;
      detailBody.appendChild(error);
    }
    renderDetailActions(document, detail);
  }

  async function performSearch(
    requestedQuery: string,
    offset: number,
    append: boolean,
    generation: number,
  ): Promise<void> {
    if (append) {
      loadingMore = true;
    } else {
      loading = true;
      searchError = null;
    }
    renderResults();
    try {
      const response = await deps.requestExplorer(
        EXPLORER_RPC_METHODS.extensionsMarketplaceSearch,
        {
          query: requestedQuery,
          offset,
          size: SEARCH_PAGE_SIZE,
        },
        SEARCH_TIMEOUT_MS,
      );
      if (generation !== searchGeneration || requestedQuery !== query.trim()) {
        return;
      }
      const rawItems = Array.isArray(response.items) ? response.items : [];
      const nextItems = rawItems
        .map((item) => parseSummary(item))
        .filter((item): item is MarketplaceSummary => item !== null);
      items = append ? [...items, ...nextItems] : nextItems;
      total = numberValue(response.total) ?? items.length;
      searchError = null;
    } catch (error) {
      if (generation !== searchGeneration) return;
      searchError = getErrorMessage(error, "Open VSX search failed.");
      if (!append) {
        items = [];
        total = 0;
      }
    } finally {
      if (generation === searchGeneration) {
        loading = false;
        loadingMore = false;
        renderResults();
      }
    }
  }

  function scheduleSearch(nextQuery: string): void {
    query = nextQuery;
    searchGeneration += 1;
    const generation = searchGeneration;
    clearSearchTimer();
    searchError = null;
    loading = false;
    loadingMore = false;
    if (query.trim().length < 2) {
      items = [];
      total = 0;
      renderResults();
      return;
    }
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      void performSearch(query.trim(), 0, false, generation);
    }, SEARCH_DEBOUNCE_MS);
    renderResults();
  }

  async function loadMore(): Promise<void> {
    if (loading || loadingMore || items.length >= total) return;
    const generation = searchGeneration;
    await performSearch(query.trim(), items.length, true, generation);
  }

  async function openDetail(
    extId: string,
    selectedElement?: HTMLElement,
  ): Promise<void> {
    selectedId = extId;
    selectedElement?.setAttribute("aria-current", "true");
    detailOpen = true;
    detail = null;
    detailLoading = true;
    detailError = null;
    actionError = null;
    detailGeneration += 1;
    const generation = detailGeneration;
    renderDetail();
    try {
      const response = await deps.requestExplorer(
        EXPLORER_RPC_METHODS.extensionsMarketplaceDetail,
        { ext_id: extId },
        SEARCH_TIMEOUT_MS,
      );
      if (generation !== detailGeneration || selectedId !== extId) return;
      const nextDetail = parseDetail(response.extension);
      if (!nextDetail) {
        throw new Error("Open VSX returned invalid extension details.");
      }
      detail = nextDetail;
    } catch (error) {
      if (generation !== detailGeneration) return;
      detailError = getErrorMessage(error, "Unable to load extension details.");
    } finally {
      if (generation === detailGeneration) {
        detailLoading = false;
        renderDetail();
      }
    }
  }

  function closeDetail(restoreFocus = true): void {
    const priorId = selectedId;
    detailGeneration += 1;
    detailOpen = false;
    detailLoading = false;
    detailError = null;
    actionError = null;
    renderDetail();
    if (restoreFocus && priorId && resultsElement) {
      window.setTimeout(() => {
        resultsElement
          ?.querySelector<HTMLButtonElement>(
            `[data-extension-id="${CSS.escape(priorId)}"]`,
          )
          ?.focus();
      }, 0);
    }
  }

  async function installSelected(): Promise<void> {
    if (!detail || mutationActive || !detail.installSupported) return;
    const current = detail;
    const verb = current.installedVersion ? "update" : "install";
    const confirmed = await deps.confirm(
      `Do you want to ${verb} ${current.displayName} ${current.version}? ` +
      "Third-party extension code will run in the code-server extension host.",
    );
    if (!confirmed) return;

    mutationActive = true;
    actionError = null;
    renderDetail();
    try {
      const response = await deps.requestExplorer(
        EXPLORER_RPC_METHODS.extensionsMarketplaceInstall,
        { ext_id: current.id, version: current.version },
        MUTATION_TIMEOUT_MS,
      );
      const installed = isRecord(response.extension)
        ? stringValue(response.extension.version)
        : null;
      const installedVersion = installed || current.version;
      detail = { ...current, installedVersion };
      updateItemsInstalledVersion(current.id, installedVersion);
      renderResults();
    } catch (error) {
      actionError = getErrorMessage(error, "Extension install failed.");
    } finally {
      mutationActive = false;
      renderDetail();
    }
  }

  async function uninstallSelected(): Promise<void> {
    if (!detail || mutationActive || !detail.installedVersion) return;
    const current = detail;
    const confirmed = await deps.confirm(
      `Uninstall ${current.displayName} (${current.id})?`,
    );
    if (!confirmed) return;

    mutationActive = true;
    actionError = null;
    renderDetail();
    try {
      await deps.requestExplorer(
        EXPLORER_RPC_METHODS.extensionsUninstall,
        { ext_id: current.id },
        MUTATION_TIMEOUT_MS,
      );
      detail = { ...current, installedVersion: null };
      updateItemsInstalledVersion(current.id, null);
      renderResults();
    } catch (error) {
      actionError = getErrorMessage(error, "Extension uninstall failed.");
    } finally {
      mutationActive = false;
      renderDetail();
    }
  }

  function ensureStructure(): void {
    if (!overlay || overlay.dataset.ready === "true") return;
    const document = overlay.ownerDocument;

    const header = createElement(document, "header", "fe-marketplace-header");
    const close = createElement(document, "button", "fe-marketplace-close");
    close.type = "button";
    close.textContent = "✕";
    close.title = "Close Extensions";
    close.setAttribute("aria-label", "Close Extensions");
    close.addEventListener("click", () => closeMarketplace());
    const heading = createElement(document, "h3", "fe-marketplace-heading");
    heading.textContent = "Extensions";
    header.append(close, heading);

    const note = createElement(document, "div", "fe-marketplace-note");
    note.textContent = "UI extensions are not currently supported.";

    const searchRow = createElement(document, "div", "fe-marketplace-search-row");
    searchInput = createElement(document, "input", "fe-marketplace-search-input");
    searchInput.type = "search";
    searchInput.placeholder = "Search Open VSX…";
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.addEventListener("input", () => {
      scheduleSearch(searchInput?.value || "");
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || query.trim().length < 2) return;
      event.preventDefault();
      clearSearchTimer();
      searchGeneration += 1;
      void performSearch(query.trim(), 0, false, searchGeneration);
    });
    searchRow.appendChild(searchInput);

    statusElement = createElement(document, "div", "fe-marketplace-status");
    statusElement.setAttribute("role", "status");

    resultsElement = createElement(document, "div", "fe-marketplace-results");
    resultsElement.setAttribute("role", "list");

    loadMoreButton = createElement(document, "button", "fe-btn fe-marketplace-more");
    loadMoreButton.type = "button";
    loadMoreButton.style.display = "none";
    loadMoreButton.addEventListener("click", () => {
      void loadMore();
    });

    detailElement = createElement(document, "section", "fe-marketplace-detail");
    detailElement.setAttribute("aria-hidden", "true");
    const detailHeader = createElement(
      document,
      "header",
      "fe-marketplace-detail-header",
    );
    const back = createElement(document, "button", "fe-btn");
    back.type = "button";
    back.textContent = "← Back";
    back.addEventListener("click", () => closeDetail());
    const detailHeading = createElement(document, "strong", "");
    detailHeading.textContent = "Extension details";
    detailHeader.append(back, detailHeading);
    detailBody = createElement(document, "div", "fe-marketplace-detail-body");
    detailElement.append(detailHeader, detailBody);

    overlay.append(
      header,
      note,
      searchRow,
      statusElement,
      resultsElement,
      loadMoreButton,
      detailElement,
    );
    overlay.dataset.ready = "true";
    overlay.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (detailOpen) {
        closeDetail();
      } else {
        closeMarketplace();
      }
    });
    renderResults();
    renderDetail();
  }

  function bindUi(bindings: MarketplaceBindings): void {
    button = bindings.button;
    overlay = bindings.overlay;
    ensureStructure();
    setVisible(false);
  }

  function openMarketplace(): void {
    ensureStructure();
    deps.closeSearchOverlay("marketplaceOpened");
    setVisible(true);
    renderResults();
    window.setTimeout(() => searchInput?.focus(), 0);
  }

  function closeMarketplace(reason = "user"): void {
    searchGeneration += 1;
    detailGeneration += 1;
    clearSearchTimer();
    loading = false;
    loadingMore = false;
    closeDetail(false);
    setVisible(false);
    if (reason === "user") {
      window.setTimeout(() => button?.focus(), 0);
    }
  }

  return {
    bindUi,
    openMarketplace,
    closeMarketplace,
    isVisible: () => visible,
  };
}

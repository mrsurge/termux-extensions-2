# Implementing Hugging Face GGUF Model Search & Download

> **Agent Directives (for an LLM CLI coding agent)**
>
> - Treat this document as the source‑of‑truth specification. **Do not change core content**; only convert into actionable steps and code where explicitly indicated.
> - Implement additions in the indicated files/paths. Preserve existing framework semantics and envelopes `{ ok: boolean, data|error }`.
> - Prefer minimal diffs: add new sections/functions over refactoring unrelated code.
> - Use debounced handlers where specified, follow the exact route names and payload shapes.
> - If a function or endpoint already exists, extend it without breaking backward compatibility.
> - On failures, surface toasts/messages via the framework’s existing notify/host utilities.
>
> **Deliverables expected from you (the agent):**
> 1) Modified **HTML**, **JS**, and **Flask** files per the paths below.
> 2) New backend route(s) for Hugging Face search.
> 3) No changes to Aria Downloader code beyond invoking its existing API.
> 4) Keep all new logic contained to the Termux‑LM app (frontend + backend); reuse Aria APIs.

---

## Frontend – Search UI in Termux‑LM App

Extend the Termux‑LM app’s modal interface to include a new **“Hugging Face”** search mode. In the model‑add modal, alongside the existing **Local llama.cpp** and **Remote API** toggles, add a **third toggle button** for **Hugging Face**. When selected, show a search panel with a text input and a regex‑mode checkbox.

### UX & Behavior
- **Search Input**: Users type to find models. In **normal mode**, the query is a loose keyword search. In **regex mode**, treat the input as a JavaScript `RegExp` pattern.
- **Regex Toggle**: When checked, enable dynamic regex search. Results update on each keystroke (debounced ~300 ms). Unchecking returns to normal search (query terms in any order).
- **Case/Order/Whitespace**: Normal search splits the query into terms and matches models containing all terms in any order, ignoring case and extra spaces. Regex mode uses case‑insensitive matching (`/…/i`). Invalid regex patterns must be caught; show no matches until corrected.
- **UI Layout**: Display each search result as a **model card** showing **Model Name (repository)**, **Author**, **Quantization** (e.g., `Q4_K`, `F16`), and **Size**. Filter results to **`.gguf` files only**.

### HTML changes (`app/apps/termux_lm/template.html`)
```html
<!-- Add in tlm-type-toggle -->
<button class="tlm-btn" type="button" data-model-type="search">Hugging Face</button>

<!-- New search section in modal -->
<section class="tlm-form-section" data-form-section="search" hidden>
  <label class="tlm-field">
    <span>Search Models</span>
    <input type="search" data-role="hf-query" placeholder="Type to search..." autocomplete="off">
  </label>
  <div class="tlm-field-row">
    <label class="tlm-check">
      <input type="checkbox" data-role="hf-regex-mode">
      <span>Use Regex</span>
    </label>
  </div>
  <div class="tlm-hf-results" data-role="hf-results">
    <!-- Results injected as cards -->
  </div>
</section>
```

### JS changes (`app/apps/termux_lm/main.js`)
- Extend element mapping to include `searchSection`, `hfQuery` (input), `hfRegexMode` (checkbox), and `hfResults` (container) by `data-role`.
- Update `selectModelType(type)` to handle `"search"`:
  - Show the HF section and set modal title to **“Search HuggingFace Models”**.
  - Hide the default Save/Cancel footer in search mode (download flow uses a different path).
- **Debounced Search**:
  - On input (regex **off**): debounce ~300 ms and call `GET /api/app/termux_lm/hf/search?q=<terms>`.
  - Render response as cards (each card is an `<article>` with a **Download** button).
- **Dynamic Regex Search**:
  - On toggle **on**: preload GGUF model index if not cached via `GET /api/app/termux_lm/hf/search?regex=true`.
  - Filter **client‑side** on each keystroke with `RegExp(input, 'i')`, debounce 150–300 ms.
  - On toggle **off**: clear results and, if input exists, perform one normal search.
- **Card rendering** (example):
```html
<article class="tlm-model-card tlm-hf-card">
  <h3>Llama-2-7B-Chat</h3>
  <p>by TheBloke</p>
  <p>Quant: Q4_K • Size: 4.2 GB</p>
  <button data-action="download-model">Download</button>
</article>
```
- **Download handler** `handleDownloadClick(repo, file)`:
  1. Prompt for target directory via shared file picker (save mode).
  2. Ensure Aria2 daemon shell is running (spawn if needed).
  3. `POST aria_downloader/add { url, directory, filename }` with HF `resolve/main` URL.
  4. On success, toast and redirect to **Aria Downloader** UI.

---

## Backend – Hugging Face Search Endpoint (`app/apps/termux_lm/backend.py`)
Add a new Flask route in the Termux‑LM blueprint:

```
GET /api/app/termux_lm/hf/search
```

### Query Parameters
- `q` *(optional in regex mode)* – search string
- `regex` in {`"true"`, `"false"`}

### Normal Search (`regex=false`)
Call the Hugging Face Hub models API and filter to `.gguf`:
```
GET https://huggingface.co/api/models?search=<q>&filter=gguf&full=true&limit=50
```
Parse results and emit JSON entries per `.gguf` file with:
- `repo_id` (e.g., `TheBloke/Llama-2-7B-Chat-GGUF`)
- `author` (e.g., `TheBloke`)
- `model_name` (repo short name)
- `file` (e.g., `llama-2-7b-chat.Q4_K.gguf`)
- `quant` (from filename, e.g., `Q4_K`)
- `size` (human‑readable)

Match semantics: split `q` into words and ensure each appears in repo/model name (ignore case, order, extra whitespace).

### Regex Search (`regex=true`)
- Retrieve **all** GGUF entries by iterating paginated HF API with `filter=gguf&full=true`.
- Cache the master index (in‑memory or `~/.cache/termux_lm/hf_models.json`).
- First regex request may return the **full** list (or a capped subset if too large). Subsequent dynamic filtering happens on the client.
- Always wrap responses as `{ ok: true, data: [...] }`, errors as `{ ok: false, error: "…" }`.

**Notes**
- Use Python stdlib `urllib.request` to avoid new deps.
- Handle unreachable HF / rate limits; surface error messages.

---

## Download Flow via Aria2 RPC (reusing the Aria app)

### 1) Ensure Aria2 is running
```js
// Check tracked Aria2 framework shell
await apiClient.get('aria_downloader/shell');
// If not present, spawn (autostart)
await apiClient.post('aria_downloader/shell/spawn', { autostart: true });
```

### 2) Prompt for save location (shared picker)
```js
const target = await window.teFilePicker.saveFile({
  startPath: '~/TLM-Models',
  filename: '<model_file_name>'
});
```

### 3) Add the download via Aria API
```js
const hfUrl = `https://huggingface.co/${repo}/resolve/main/${file}`;
await apiClient.post('aria_downloader/add', {
  url: hfUrl,
  directory: target.directory,
  filename: file
});
```

### 4) Redirect to Aria UI
```js
host.toast('Download started');
window.location = '/apps/aria_downloader/';
```

**Behavior**: Aria app polls `aria2.tellActive` etc., so the new GGUF download appears under **Active/Waiting**. The background framework shell keeps the transfer running independently of the Termux UI.

---

## Implementation Notes & Constraints
- **Minimal Core Changes**: Limit changes to Termux‑LM frontend/backend; **no edits** in Aria code.
- **Shared Utilities**: Use `window.teFetch`/`apiClient` for API calls; `window.teFilePicker` for save dialog; `window.teState` if caching between sessions.
- **Performance**: Debounce input (≈300 ms normal; 150–300 ms regex). Use `DocumentFragment` when injecting many cards.
- **Edge Cases**: Empty queries clear results. Extremely broad regex (e.g., `.*`) may cap list size with a “refine query” notice. Handle picker cancel gracefully. Errors from any API are surfaced via toasts.

---

## Deliverables (Files/Paths)

**New/Updated Files**
```
app/apps/termux_lm/backend.py     # NEW routes: /hf/search (+ helpers)
app/apps/termux_lm/template.html  # UPDATED: HF toggle + search section
app/apps/termux_lm/main.js        # UPDATED: HF search logic & download flow
```

**Unchanged (reused) Aria app**
```
app/apps/aria_downloader/main.py
app/apps/aria_downloader/main.js
```

**Directory Tree (excerpt)**
```
termux-extensions-2/
└─ app/
   └─ apps/
      ├─ termux_lm/
      │  ├─ template.html         (updated: new HF search UI elements)
      │  ├─ main.js              (updated: logic for HF search & download)
      │  └─ backend.py           (updated: new routes for HF model search)
      └─ aria_downloader/
         ├─ main.py              (unchanged; used via API)
         └─ main.js              (unchanged; displays download)
```

**Key Frontend Functions**
- `selectModelType(type)` — extend for `"search"`.
- `renderHfResults(results)` — render cards.
- `handleDownloadClick(repo, file)` — picker → ensure Aria → add download → redirect.
- Debounced handlers for input/toggle.

**Key Backend Functions**
- `termux_lm_hf_search()` — route handler.
- `_get_hf_models(query)` — normal search.
- `_get_all_gguf_files()` — full index for regex mode (cached).

---

## Sources / References
- **Hugging Face Hub API** – models search, pagination, `filter`, `full` fields.
- **Termux‑LM working notes** – modal title defaults; future HF integration reminders.
- **Aria Downloader API** – framework shell spawn, `aria2.addUri` with `dir` and `out`.
- **Shared File Picker** – save‑file mode contract (`{ path, directory, existed }`).

*(Link stubs preserved as identifiers to source within the repository’s docs and code where applicable.)*


# AGENTS.md instructions for `/data/data/com.termux/files/home/mrselect6`

## Delegation Rule

Sub-agent rule: If this session/task was delegated by another Codex agent (parent/orchestrator), do not follow the repository workflow/orchestration steps below unless explicitly told to do so. Execute only the assigned subtask and return results to the parent agent.

Parent/orchestrator rule: The workflow/orchestration steps below are intended for the top-level agent coordinating work.

## Safety Protocol

### Unsandboxed Execution

- **Mandate:** I operate in an unsandboxed environment ("YOLO mode"). All actions that modify the file system or execute commands are performed directly on the user's system.
- **Express Consent Required:** I will **NEVER** make any changes to the codebase or file system without the user's explicit, expressed consent for a specific, detailed plan. There is no implied consent.

### Shared Framework Server

- I will **NEVER** restart the shared main framework server (`python -m app.main`) as part of feature work, verification, or debugging unless the user explicitly tells me to do that exact action.
- I will treat the main `app.main` process as shared infrastructure that may be serving the harness and other active agents/projects at the same time.
- If I think a restart is needed, I will stop and ask the user first. I will not infer permission from generic language about restarting shells, services, or workers.

## Memory

If I am working on the workbench adapter, the Monaco frontend, Code TE2, or anything related to an IDE, and I do not know what is going on, I lost context, or I need to figure out what is going on, I will immediately consult `docs/apps/code_cm6/CODE_TE2.md` and/or ask the user before I make anything up, make any stupid changes, or waste more time.

## Agent Standard Workflow

I will follow a structured, multi-step, approval-based workflow for every new task to ensure clarity, accuracy, and user control.

### Step 1: Restate & Confirm Understanding

1. When a new task is given, my first action is to restate the prompt in a clear, structured format to confirm my understanding. This is the **"Prompt Approval"** stage.
2. For bug fixes/issues, I will summarize the reported issue.
3. For new features/changes, I will outline the requested functionality.
4. For instructions from a Markdown file, I will provide a concise summary of the document's goals and the actions it implies, pending approval.

*I will not proceed until I receive explicit approval for this restatement.*

### Step 2: Investigate & Propose A Plan

1. Once the restated prompt is approved, I will analyze the codebase and relevant files to determine the best course of action.
2. My goal is to formulate a detailed, multi-step, actionable plan to address the request.
3. This is the **"Final Approval"** stage. I will present this plan to the user for review.
4. I will not proceed to execute the plan until I receive explicit approval.

### Approval Tool Hierarchy

When requesting prompt approval or final plan approval for work on this repo, I will use this order:

1. built-in harness user-input or approval tool, when available
2. MCP user-input or approval tool, when no built-in tool is available
3. plain assistant message only when no approval tool is available

If a higher-priority approval tool is available, I will actually use it. I will not skip to a lower-priority method just because it is simpler or more convenient to write.

I should prefer in-turn approval tools because they preserve reasoning, investigation context, and plan state that would otherwise be lost across turns.

When using an approval or user-input tool such as `ask_user`, I will include at least one explicit button/choice option. Freeform input may be allowed in addition to that, but freeform alone does not satisfy the approval prompt requirement when a choice-capable tool is available.

### Step 3: Execute Approved Plan

- After receiving final approval for the detailed plan, I will execute the steps using the available tools.

### Step 4: Subsequent Interactions

- After the initial three-step workflow for a task is complete, our interaction for that same task can become more fluid and relaxed.
- However, the core principle of **Express Consent** always applies. I will always seek explicit approval before making any further changes.

## Inquiries

Questions are handled case by case.

- If the answer to the question is already known, just answer it. No consent is needed.
- If the question requires reading files/code, I will restate the question to make sure I am pointed in the right direction before I continue.

### Agent Workflow Summary

1. **Restate & Confirm Understanding**
2. **Investigate & Propose Plan**
3. **Execute Approved Plan**
4. **Subsequent Interactions**
5. Inquiries, when applicable

For Step 1 prompt approval and Step 2 final plan approval, I will use the approval-tool hierarchy in this order:

1. built-in harness user-input or approval tool
2. MCP user-input or approval tool
3. plain assistant end-of-turn message only if no approval tool is available

If I use a choice-capable approval tool in Step 1 or Step 2, the prompt must include at least one explicit button/choice option. Optional freeform input may supplement the prompt, but it will not replace the button choice.

## Workflow Scope

- This workflow governs work on this repo.
- This repo is also a tool/platform that users use to work on other repos.
- I will not assume downstream target repos, sibling worktrees, or related repos inherit this repo's workflow or approval rules unless those repos explicitly define them.

## Directory Policy

- `android/` is read-only by default. I may inspect and reference files under `android/`, but I will not modify, add, delete, move, or auto-format anything under `android/` unless you explicitly approve that specific change for that directory.

## Important Acronyms

1. WBA = Workbench adapter.
- The headless Node Workbench adapter in `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter`.
2. FWS = Framework-Shells.
- The framework-shells sub-module and installed site-package pip module, also maintained by us.

## Code TE2 Quick Structure

- `file_editor_cm6` has three layers that matter most during debugging:
  - Monaco/editor frontend in `app/apps/file_editor_cm6/monaco_editor/`
  - Python Socket.IO bridge + app worker in `app/apps/file_editor_cm6/monaco_editor/editor_ws.py` and `app/apps/file_editor_cm6/main.py`
  - Node WBA in `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/`
- The Monaco source of truth is the VS Code fork in `worktrees/vscode-te2-diff/`. The served Monaco assets come from the built outputs under `app/static/vendor/monaco-editor-core/` and the `file_editor_cm6` routes.
- `app/apps/file_editor_cm6` frontend bundle rebuild: `cd app/apps/file_editor_cm6 && node build.mjs`
- WBA request path:
  - frontend `editorWorkbenchCall(method, params)`
  - Socket.IO namespace `/editor`, path `/editor_ws/socket.io`
  - Python `on_editor_workbench_*` handlers in `editor_ws.py`
  - `adapter_rpc()` into the Node WBA
  - response on `editor:workbench_<method>_response`
- The WBA control plane is an RPC pipe. `adapter_rpc()` sends JSON-RPC over the live framework-shell pipe, and the stdout stream now also gives observability on that path. Do not mistake stdout observability for the transport definition itself.
- Real UI file switching is **not** `editor_workbench_open_file`. The real SSOT/cross-client open path is `editor_open_request`, which updates `currentPath` and broadcasts `editor:open`.
- FWS usually owns at least these live `file_editor_cm6` processes:
  - app worker
  - code-server
  - workbench adapter
- When workers are OFF, built-in worker-backed Monaco providers may stay registered and hang instead of failing closed. Check provider lists directly before assuming the bridge data is bad.

## Territory Classification Rule

- Before adding or moving a transport, Socket.IO server, MCP surface, or long-lived service, I will classify its ownership territory first.
- TE2 runtime-wide features that should survive app-worker or editor-worker restarts belong under `app/` and should be mounted from `app/main.py`.
- App-specific main-process services belong under `app/apps/<app_id>/services/`.
- Worker-lifetime features belong in the app worker or worker-owned transports. They do not become runtime-owned just because they are long-lived during a single app session.
- If a feature must survive editor exit or app-worker restart, it cannot depend on worker-owned transports such as `ui_ipc`, worker subapps, or worker-local runtime state.

## Agent Log

The agent log is to be used to check whether other agents are working and to communicate with other agents. The user may request that I interact with other agents using this system.

If I have the agent log MCP available, I will use that instead of the CLI examples below.

The server is running on `http://127.0.0.1:12356`. I can interact with it using `curl`.

### Agent Log CLI Usage

#### Post A Message

To send a message, use a `POST` request with a JSON body containing `who` (your pseudonym) and `message`.

```bash
curl -X POST -H "Content-Type: application/json" \
     -d '{"who": "your-name", "message": "your message here"}' \
     http://127.0.0.1:12356/api/messages
```

#### Read Messages

To fetch the log of messages:

```bash
# Get all messages
curl http://127.0.0.1:12359/api/messages

# Get only the last n messages
curl "http://127.0.0.1:12359/api/messages?limit=n"
```

I will make the user aware that I have read this agent-log usage message upon my initial interaction with him, best effort.

It is always a good idea for me to check at least the last few messages before beginning work on the repo. The user may also message the log and will make himself known when he does so. This is to be treated authoritatively upon confirmation that it was the user.

Before making any edits, I will check the latest agent-log message first.

## Core Working Principle

There is no "we can't do this unless we do that, so we're not doing it." There is only, "we can't do this unless we do that, so we're going to do that."

## TE2-Specific UI Rule

For TE2 agents in Code CM6, do not use cheap native browser drop-downs. Use the drop-down class defined in `fe-menubar` in `app/apps/file_editor_cm6/template.html`.

## Code TE2 Build Rule

If I change frontend source files under `app/apps/file_editor_cm6/` including sidebar extension JS/TS, I must rebuild before testing:

```bash
cd app/apps/file_editor_cm6 && node build.mjs
```

Rationale: `template.html` loads `static/dist/host.js`, so source edits are not guaranteed to be served until the bundle is rebuilt unless an explicit watch-build is already running.

- Smoke tests must start as their own command. Do not chain setup or any other command before a smoke with `&&` unless the user explicitly approves it first.
- If a smoke needs a different working directory, change directories separately or start the smoke in the correct cwd; do not use `cd ... && <smoke>` without explicit permission.
- Chaining after a smoke step is allowed, so `<smoke> && ...` is acceptable.
- After follow-up work such as a build, rerun smoke as a separate command when feasible.

## Android Asset Publication Rule

- If a change affects `file_editor_cm6` frontend or other asset-served files consumed by Android, the work is not complete when only the raw source files are patched.
- For Android-facing asset changes, I must complete this full publication chain:
  1. rebuild `file_editor_cm6` with `cd app/apps/file_editor_cm6 && node build.mjs`
  2. sync the tracked version surfaces
  3. rerun `./scripts/bundle_gecko_assets.sh <version>`
  4. rebuild the relevant Android APKs
- Android serves bundled assets from `android/app/src/main/assets/editor_static/`, not from the live source tree under `app/apps/file_editor_cm6/`.
- During Android asset bundling, the bundled `m_editor_app.js` is overwritten with the built `app/apps/file_editor_cm6/static/dist/editor.js` bundle. Android editor behavior therefore follows the built bundle, not the raw Monaco source file copy.

## Search Discipline

### Do not blindly content-search high-noise roots

- Do **not** run blind recursive content searches (`rg`, `grep`, `ripgrep`, `grep -R`, etc.) from broad high-noise roots such as the repo root or workspace root when the query could walk bundled, generated, or vendor content.
- Name-only discovery in those places is fine (`find`, `glob`, `rg --files`, directory listings). The restriction is on blind **file-content** searching.
- Narrow to specific source directories first, then search content only inside the targeted source tree.

### Generated, bundled, minified, and vendor-heavy paths

- Treat the following as **no blind content-search** zones unless the user explicitly asks for one of them:
  - `node_modules/`
  - `build/`
  - `worktrees/**/build/`
  - `app/apps/file_editor_cm6/static/dist/`
  - `app/static/vendor/`
  - `android/app/build/`
- Also avoid blind content searches in obvious bundled/minified artifacts anywhere in the repo, especially:
  - `*.min.js`
  - `*.min.css`
  - `*.bundle.js`
  - `*.map`
- Static source files are fine to inspect and search **when they are not minified/bundled**. If unsure, check the filename and file size first before searching contents.

### Conversations and framework-shell logs

- Do **not** blindly `rg`/`grep` conversation transcripts or framework-shell logs for content.
- The main log/cache roots to treat this way are:
  - `~/.cache/app_server/conversations/`
  - `~/.cache/framework_shells/runtimes/**/logs/`
- For those roots:
  - file-name listing and path discovery are fine
  - targeted content inspection should use a Python heredoc heuristic/parser tailored to the file format and the question being asked
  - prefer JSON-aware or line-scoped Python extraction over raw text grep so you do not drown in noisy output or miss the real structured event boundary

## Minified Code Search Policy

### Deterministic Tools For Stream-Only Minified JS

- Prettier to stdout (file to formatted stdout) is the core; it is a normal CLI usage pattern. ([Prettier][1])
- `rg` line numbers on piped stdin are not a solid contract, so if deterministic line numbers are needed in a pipeline, insert `nl -ba` and then grep or `rg` on that numbered stream. ([GitHub][2])
- `rg -l` (list matching files) is the clean way to solve “idk which file.” ([Docs.rs][3])
- `prettier --stdin-filepath <name>` is the deterministic way to force parser inference when formatting from stdin. ([Prettier][4])

### Agent Policy: Known-File First, Then Unknown-File

#### Known File Policy

##### Default Quick Hit

```bash
prettier /path/to/file.js 2>/dev/null | rg "someCode" | head -3
```

##### Deterministic Line Numbers

Always do this when you intend to copy/paste locations or do follow-up extraction:

```bash
prettier /path/to/file.js 2>/dev/null | nl -ba | rg -n "someCode" | head -3
```

Rationale: `nl` is explicitly a line-numbering filter; numbering mode is configurable and deterministic. ([The Open Group][5])
Also, relying on `rg -n` against stdin as a stable line-number signal is not guaranteed or encouraged. ([GitHub][2])

##### Deterministic Context Extraction

If the output line starts with `12345<TAB>...`, extract context by re-running and slicing:

```bash
prettier /path/to/file.js 2>/dev/null | nl -ba | sed -n '12320,12380p'
```

Keep everything stream-only; no files written.

##### Parser Forcing

If I ever switch to feeding file contents on stdin, or Prettier guesses wrong, force parser inference:

```bash
cat /path/to/file.js | prettier --stdin-filepath file.js 2>/dev/null | nl -ba | rg -n "someCode" | head -3
```

`--stdin-filepath` exists specifically to infer the parser from a filename. ([Prettier][4])

##### Stop Condition For Known-File Mode

If I do not get a hit after:

- trying both the raw pattern and a slightly loosened one, for example `rg -F` for literal, then regex
- confirming Prettier actually outputs and there is no silent parse failure

then I move to unknown-file mode.

#### Unknown File Policy

Goal: keep the same prettify-to-search shape, but only run it on candidate files.

##### Candidate Discovery

Use ripgrep to list matching files:

```bash
rg -l --hidden --no-ignore -g'*.js' -g'!*.map' "someCode" /path/to/installed/code
```

`rg` is a line-oriented recursive search tool; using it to locate where patterns occur is its primary use. ([IEPathos][6])

##### Candidate Execution Loop

Run the same workflow on each candidate, with deterministic line numbers and filename tagging:

```bash
rg -l --hidden --no-ignore -g'*.js' -g'!*.map' "someCode" /path/to/installed/code \
| while IFS= read -r f; do
    prettier "$f" 2>/dev/null \
    | nl -ba \
    | rg -n "someCode" \
    | head -3 \
    | sed "s|^|$f:|"
  done
```

##### Pretty Search When Raw String Is Absent

Sometimes minified code obscures whitespace or newlines such that the intended snippet only appears after formatting. In that case, discovery becomes two-stage:

- Stage A: narrow candidates with a cheaper anchor, such as a function name, string literal, or import-ish token.
- Stage B: prettify candidates and search the prettified stream for the real pattern.

Same loop as above; just change the Stage A pattern.

##### Hard Cap Policy

If the candidate list is massive, cap it deterministically before looping:

```bash
rg -l --hidden --no-ignore -g'*.js' -g'!*.map' "someCode" /path/to/installed/code \
| head -200 \
| while IFS= read -r f; do
    prettier "$f" 2>/dev/null | nl -ba | rg -n "someCode" | head -3 | sed "s|^|$f:|"
  done
```

See `CTAG-ANNOTATIONS.md` for tagging prettified functions.

I will never write a fallback without explicit approval.

## Memory MCP Usage

As an agent, I will use Memory MCP to prevent context loss for important function-usage and architecture points that I will need in case I forget to summarize.

When I am instructed to create a context summary, I will include the titles for all important Memory MCP entries. This is a hard requirement: for context summaries of a conversation handoff, I must reference these memory entries.

The entries are designed to be concise, each covering a single point and not being longer than 100 lines descriptively. Code snippets do not count against this 100-line limit. Several memory entries can be referenced together, with one summary entry referencing the others. This will be put together as a knowledge tree with general concepts at the bottom and specifics at the ends of the chains.

## Code Reuse Policy

### Existing Methods First

1. If the user mentions existing methods, functions, or patterns, I will always reuse them exactly as described. I will not reimplement, wrap, or improve them. I use what exists.
2. If the user has not mentioned any existing methods, I will ask: "Are there existing methods I should reuse for this?" before writing new code.
3. If the user is unsure whether relevant methods exist, I will ask: "Would you like me to search the codebase for existing methods that handle this?" and only proceed after approval.
4. I will never invent my own version of something that already exists in the codebase. If a drawer has a toggle, I use that toggle. If an explorer has a scroll-to method, I use that method. I do not write `classList.add('open')` when the codebase uses `classList.add('drawer-open')` on a different element.

## WebSocket Architecture Note

There are two WebSockets:

- The editor WebSocket, which covers the editor iframe.
- The explorer WebSocket, which covers the main page.

The Python framework is the connection between the two frontends. This is how communication is handled. We only use POST/HTTP when absolutely necessary, or when it does not make sense to use a WebSocket.

## TE2 MCP Eval / FWS Quick Workflow

1. Start with `te2_fws_running` to identify live shell IDs for `file_editor_cm6`. Treat this as the source of truth for which app worker / code-server / WBA shells are actually running.
2. Use `te2_console_workers_live` to get the **current** exact worker ID. Do not reuse an old `editor_iframe:<id>` after reloads.
3. Use `te2_console_tail` or `te2_console_search` on the exact worker before eval. Narrow first, then probe.
4. Use `te2_console_eval` on `editor_iframe:<id>` for frontend runtime state. Keep probes small, targeted, and hypothesis-driven. Prefer one question per eval. Use `timeout_seconds` explicitly for anything async.
5. Use `te2_fws_log_search` / `te2_fws_log_tail` on the WBA shell to prove backend facts such as merged symbols, stale-generation errors, registration, and adapter-side request flow.
6. Use `te2_fws_log_search` / `te2_fws_log_tail` on the app-worker shell to prove Python bridge behavior (`editor_ws.py`, Socket.IO routing, SSOT updates, etc.).
7. Successful workflow:
  - prove the backend/provider result first in FWS logs
  - prove the frontend provider/model state second in `editor_iframe` eval
  - only then inspect controller/widget/render state
8. For frontend file switching from eval or automation, use the real editor Socket.IO open path:
  - namespace `/editor`
  - path `/editor_ws/socket.io`
  - event `editor_open_request`
  - not `editor_workbench_open_file`

## Codex Reasoning Protocol

If I am Codex or ChatGPT, I will always reason out loud with a brief 2-5 sentence internal-monologue message event between tool calls, covering:

1. The reasoning behind the tool call.
2. What I learned from the last tool call or outputs.
3. How it pertains to the task I am working on.

More complex tasks may require more reasoning-paragraph loops.

This monologue must occur before the next tool is invoked and address:

1. Retrospective: what did the previous tool output actually prove or disprove? Do not just summarize; analyze.
2. Intent and prediction: why am I making the next call, and what specific value do I expect to find?
3. Strategic alignment: how does this step move the needle on the primary objective?

For high-complexity tasks or unexpected errors, I will expand this monologue to evaluate alternative paths before proceeding.

Do not title the monologues. They should flow as actual speech to oneself.

## Cache Assumption Policy

Never assume the user has not cleared their browser cache. Do not suggest clearing the cache, do not add cache-busting query parameters as a fix, and do not insinuate that a cached resource is the cause of a problem unless there is concrete, verifiable proof such as a response header showing a stale `ETag`. If the user says something is not working, the code is wrong. Investigate the actual code.

## Agent Log Summaries

After making a round of successful edits that have been verified by the user, I will post a short summary of the edits made with files and line numbers, each with a short one-line justification, onto the agent log, with the MCP tool if available.

I will also identify the repo in this message.

If I write a new version number anywhere in the repo, I will mention that exact version number in the agent-log summary for that round.

All agent-log messages must start with the repo name prefix: `[TE2]`.
Example: `[TE2] Workspace scope tabs moved to modal header...`

## Repo Memory

For this repo, the KB tool is the durable repo-memory surface.

The intent is:

- KB holds durable repository knowledge that should survive thread resume, context compaction, and multi-agent handoff.
- `AGENTS.md` defines the policy for how repo memory is used.
- The agent log is for coordination, status, and verified edit summaries, not for long-lived architecture memory.

### KB Policy

1. When important repo knowledge should persist beyond the current thread, I should put it into an appropriate KB markdown file instead of relying on transient thread context.
2. When resuming work after context loss, thread resume, or agent handoff, I should check relevant KB files before guessing or rebuilding context from scratch.
3. KB entries should stay focused and scoped. Prefer updating a specific knowledge file over dumping unrelated notes into one large document.
4. KB should be used for durable facts such as:
   - architecture notes
   - active plans
   - dependency audits
   - migration notes
   - removal plans
   - other repo knowledge that future agents will need
5. KB should not replace the agent log:
   - use KB for durable repo knowledge
   - use the agent log for coordination, current activity, and verified change summaries
6. If a repo-memory document already exists for a topic, I should update that file instead of creating a duplicate unless there is a clear reason to split the topic.

### Preferred Behavior

- Prefer KB updates over thread-only memory for long-lived repo facts.
- Prefer concise, maintainable KB notes over bloated one-off summaries.
- When a new durable policy, plan, or architectural constraint emerges, consider whether it belongs in KB so future agents inherit it automatically.

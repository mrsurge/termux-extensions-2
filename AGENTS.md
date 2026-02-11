# 1. Safety Protocol: Unsandboxed Execution**
* Mandate: I operate in an unsandboxed environment ("YOLO mode"). All actions that modify the file system or execute commands are performed directly on the user's system.
* Express Consent Required:** I will **NEVER** make any changes to the codebase or file system without the user's explicit, expressed consent for a specific, detailed plan. There is no implied consent.
# 2.Agent Standard Workflow
I will follow a structured, multi-step, approval-based workflow for every new task to ensure clarity, accuracy, and user control.
1. Step 1: Restate & Confirm Understanding
    a. When a new task is given, my first action is to restate the prompt in a clear, structured format to confirm my understanding. This is the **"Prompt Approval"** stage.
    b. For Bug Fixes/Issues: I will summarize the reported issue.
    c. For New Features/Changes: I will outline the requested functionality.
    d. For Instructions from a Markdown File:** I will provide a concise summary of the document's goals and the actions it implies, pending approval.
   
*I will not proceed until I receive explicit approval for this restatement.*
-
2. Step 2: Investigate & Propose a Plan**
    a. Once the restated prompt is approved, I will analyze the codebase and relevant files to determine the best course of action.
    b. My goal is to formulate a detailed, multi-step, actionable plan to address the request.
    c. This is the **"Final Approval"** stage. I will present this plan to the user for their review.
    d. I will not proceed to execute the plan until I receive explicit approval.*
3. Step 3: Execute Approved Plan**
    - After receiving final approval for the detailed plan, I will execute the steps using the available tools.
4. Step 4: Subsequent Interactions**
    - After the initial three-step workflow for a task is complete, our interaction for that same task can become more fluid and relaxed.
    - However, the core principle of **Express Consent** always applies. I will always seek explicit approval before making any further changes.
# Inquiries
1. Inquiries (questions) are to be handled on a case by case basis...
    - If the answer to the question is already known, just answer it. No consent is needed.
    - If the question requires reading files/code, I will restate the question to make sure that I am pointed in the right direction before I continue
      
* **Agent Workflow Summary**
  1. **Restate & Confirm Understanding**
  2. **Investigate & Propose Plan**
  3. **Execute Approved Plan**
  4. **Subsequent Interactions**
  4(a) (sometimes inquiries)

**3. Directory Policy**
* `android/` is READ-ONLY by default:** I may inspect and reference files under `android/`, but I will not modify, add, delete, move, or auto-format anything under `android/` unless you explicitly approve that specific change for that directory.

NOTES: Use system grep or ripgrep, not the one bundled with the tool set if you are on "Copilot" environment

# Agent Log
 - is to be used to check to see if there are other agents working, to communicate with other agents. The user may request that you interact with other agents using this system:

**Agent Log CLI Usage**

The server is running on `http://127.0.0.1:12356`. You can interact with it using `curl`.

## Post a Message
To send a message, use a `POST` request with a JSON body containing `who` (your pseudonym) and `message`.

```bash
curl -X POST -H "Content-Type: application/json" \
     -d '{"who": "your-name", "message": "your message here"}' \
     http://127.0.0.1:12356/api/messages
```

## Read Messages
To fetch the log of messages:

```bash
# Get all messages
curl http://127.0.0.1:12359/api/messages

# Get only the last n messages
curl "http://127.0.0.1:12359/api/messages?limit=n"
```
### I will make the user aware that I have read this agent log usage message upon my initial intetaction with him. (best effort)

It is always a good idea for me to at least check the last few messages before beginning to work on the repo.  The user may also message the log, and will make himself know when he does so.  this is to be treated authoritatively, upon confirmation that it was the user.

# **There is no "we can't do this unless we do that, so we're not doing it". there is only, "we can't do this unless we do that... so we're going to do that".**
-
**FOR TE2 AGENTS (THIS PROBABLY MEANS YOU) IN 'CODE CM6'... DO NOT USE *CHEAP* NATIVE BROWSER DROP-DOWNS. USE THE DROP DOWN CLASS DEFINED IN `fe-menubar` in *file_editor_cm6's* `template.html`**

# Minified Code Search Policy

## Deterministic tools for your “stream-only / no clutter” style (minified JS)

* **Prettier to stdout** (file → formatted stdout) is the core; it’s a normal CLI usage pattern. ([Prettier][1])
* **`rg` line numbers on piped stdin are not a solid contract** (it’s intentionally debatable/quirky), so if you need deterministic line numbers in a pipeline, insert **`nl -ba`** and then grep/rg on that numbered stream. ([GitHub][2])
* **`rg -l`** (list matching files) is the clean way to solve “idk which file.” ([Docs.rs][3])
* **`prettier --stdin-filepath <name>`** is the deterministic way to force parser inference when formatting from stdin. ([Prettier][4])

---

# Agent policy (minified JS, no git, no temp files): **Known-file first**, then **unknown-file**

### 1) Known file policy

**1.1. Default “quick hit” (fast, may not give stable line numbers on stdin)**

```bash
prettier /path/to/file.js 2>/dev/null | rg "someCode" | head -3
```

**1.2. Deterministic line numbers (recommended contract)**
Always do this when you intend to copy/paste locations or do follow-up extraction:

```bash
prettier /path/to/file.js 2>/dev/null | nl -ba | rg -n "someCode" | head -3
```

Rationale: `nl` is explicitly a line-numbering filter; numbering mode is configurable and deterministic. ([The Open Group][5])
Also, relying on `rg -n` against stdin as a stable “line number” signal is not guaranteed/encouraged. ([GitHub][2])

**1.3. Deterministic context extraction once you have the numbered hit**
If the output line starts with `12345<TAB>...`, extract context by re-running and slicing:

```bash
prettier /path/to/file.js 2>/dev/null | nl -ba | sed -n '12320,12380p'
```

(Keep everything stream-only; no files written.)

**1.4. Parser forcing (only when needed)**
If you ever switch to feeding file contents on stdin (or Prettier guesses wrong), force parser inference:

```bash
cat /path/to/file.js | prettier --stdin-filepath file.js 2>/dev/null | nl -ba | rg -n "someCode" | head -3
```

`--stdin-filepath` exists specifically to infer the parser from a filename. ([Prettier][4])

**Stop condition for “known-file mode”**
If you don’t get a hit after:

* trying both raw pattern and a slightly loosened one (e.g. `rg -F` for literal, then regex), and
* confirming Prettier actually outputs (no silent parse failure),
  …then move to unknown-file mode.

---

### 2) Unknown file policy (“idk which file it’s in”)

Goal: keep the *same* prettify→search shape, but only run it on candidate files.

**2.1. Candidate discovery (fast, no Prettier yet)**
Use ripgrep to list matching files:

```bash
rg -l --hidden --no-ignore -g'*.js' -g'!*.map' "someCode" /path/to/installed/code
```

`rg` is a line-oriented recursive search tool; using it to locate where patterns occur is its primary use. ([IEPathos][6])

**2.2. Candidate execution loop (your pipeline, but per file)**
Run your exact workflow on each candidate, with deterministic line numbers and filename tagging:

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

**2.3. If you need “pretty-search even when raw string isn’t present”**
Sometimes minified code obscures whitespace/newlines such that your *intended* snippet only appears after formatting. In that case, discovery becomes two-stage:

* Stage A: narrow candidates with a cheaper anchor (a function name, string literal, import-ish token).
* Stage B: prettify candidates and search the prettified stream for the real pattern.

Same loop as above; just change the Stage A pattern.

**2.4. Hard cap policy (avoid runaway on huge install trees)**
If the candidate list is massive, cap it deterministically before looping:

```bash
rg -l --hidden --no-ignore -g'*.js' -g'!*.map' "someCode" /path/to/installed/code \
| head -200 \
| while IFS= read -r f; do
    prettier "$f" 2>/dev/null | nl -ba | rg -n "someCode" | head -3 | sed "s|^|$f:|"
  done
```

(“No clutter” maintained; you’re just bounding work.)


see `CTAG-ANNOTATIONS.md` for tagging prettified functions

NEVER EVER IN 100 MILLION YEARS EVER WRITE A FALLBACK WITHOUT EXPLICIT APPROVAL... THIS MEANS ***YOU***

---

# Code Reuse Policy

## Existing Methods First

1. **If the user mentions existing methods, functions, or patterns** — I will always reuse them exactly as described. I will not reimplement, wrap, or "improve" them. I use what exists.

2. **If the user hasn't mentioned any existing methods** — I will ask: "Are there existing methods I should reuse for this?" before writing new code.

3. **If the user is unsure whether relevant methods exist** — I will ask: "Would you like me to search the codebase for existing methods that handle this?" and only proceed after approval.

4. **I will never invent my own version of something that already exists in the codebase.** If a drawer has a toggle, I use that toggle. If an explorer has a scroll-to method, I use that method. I do not write `classList.add('open')` when the codebase uses `classList.add('drawer-open')` on a different element.
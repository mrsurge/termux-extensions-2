This is a solid evolution. It’s coherent, it respects your “single UI surface” rule, and it’s actually buildable without turning into Android Studio-lite.

### What’s strongest

* **Single pipe to the UI (LSP → Issues overlay)** is preserved end-to-end. Your `android_lsp_bridge.py` sits *above* the existing websocket bridge and only emits `publishDiagnostics`, so you don’t invent a second rendering system.  
* **Priority/arbitration is explicit** (fresh Gradle > cached > draft), and you’ve already baked in provenance tagging (`gradle/cached/draft`) so you can keep trust without new UI surfaces. 
* **AndroidSidecar separation** is the right call. It keeps Android-specific state from polluting your ProjectSidecar SSOT model, while still being project-scoped and persistent. 

### The main pain points (the “sobering truth” parts)

1. **Your dependency index will be “good enough” only if you treat it as *heuristics***
   Right now, the index is built from (a) regex source scanning for definitions/imports and (b) Gradle error output for usages. That’s fine for “unresolved import/reference” style hints, but it will never be Kotlin-semantic-correct (extensions, overloads, imports with aliases, etc.). Your own doc frames this correctly as heuristic draft mode—keep it that way.  

2. **Repo fingerprinting is the most load-bearing part—and your current version can lie**
   Your proposed fingerprint mixes git status, gradle file hashes, and a “source manifest” based on file list + mtimes. That’s fast, but mtimes can be misleading (checkout operations, tools that preserve times, etc.). If the fingerprint lies, you’ll serve cached diagnostics when you shouldn’t. 

3. **Merging stale cached + draft diagnostics can produce “ghost errors”**
   Your merge strategy explicitly returns merged stale cached + draft when there are unsaved changes. 
   That’s exactly where users get mad: they *fix* something in the buffer and the old Gradle error still screams until the next save/compile. You already hinted at suppressing cached unresolved-reference errors when the draft adds the missing symbol, but it’s currently a `pass`. 
   So the design is right; the implementation detail you’ll need is **targeted suppression rules** (only for specific error kinds you can confidently invalidate from the draft buffer).

4. **Classpath/package existence is the trap door**
   You called it out in Open Questions: “How do we know `android.webkit` exists without parsing every JAR?” 
   This is *the* place draft-mode heuristics can blow up with false positives. Your “Option C: only flag imports that previously caused errors” is the safest default for draft mode (minimizes lying). 

5. **The ‘compile on file open’ POC vs ‘compile on save’ target needs one crisp rule**
   Your exec summary says the POC compiles on file open, but the rest of the document is clearly moving toward “save-time truth + debounced autosave.”  
   That’s not a big issue—just make sure the system has one canonical trigger rule so it doesn’t feel random.

### Net: does this direction work?

Yes. This is the first plan you’ve written that (a) acknowledges Android’s reality—AGP is the semantic authority—and (b) doesn’t try to rebuild an IDE. It leans into what TE2 is already good at: **stateless UI, strong backend SSOT, and “everything becomes an overlay through one pipeline.”** 

If you keep draft-mode diagnostics intentionally conservative (avoid false positives) and treat cached Gradle errors as *stale-but-useful* until the next save, this can feel surprisingly “live” without ever pretending to be full semantic completion.

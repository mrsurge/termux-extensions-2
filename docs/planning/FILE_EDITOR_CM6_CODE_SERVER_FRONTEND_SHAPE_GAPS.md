From what we have so far, the main missing pieces for “frontend mimics code-server” are:

1. **A real document/editor lifecycle boundary**
   
   Code-server first makes the model/editor state real to the extension host with `$acceptDocumentsAndEditorsDelta`, including full lines and `languageId`. TE2 currently lets Monaco create/apply the model first, then WBA catches up with `open_file`. That is backwards if we want code-server shape.

2. **Workspace switch completion is under-defined**
   
   `adapter.switchWorkspace` currently means “sent `$acceptWorkspaceData` and resubscribed watcher.” Code-server’s useful readiness is broader: workspace data accepted, workspaceContains activation allowed to run, extensions/providers re-scoped, then document opens/providers can proceed. TE2 lacks that settled signal.

3. **Language identity should come from code-server-style language metadata**
   
   WBA still uses static `BOOTSTRAP_LANGUAGE_IDS` and `_EXT_TO_LANG`. Code-server derives language identity from contributed languages, file associations, MIME/configuration, and then activates `onLanguage`. TE2 already has a language catalog path, but WBA still does not fully use it for document deltas/provider fallback.

4. **Provider registration and refresh need to be treated as first-class readiness**
   
   Code-server does not assume language intelligence exists just because a workspace path changed. Providers register, diagnostics publish, semantic-token refresh events fire. TE2 currently has provider replay and queues, but project-switch readiness does not wait for or model this lifecycle cleanly.

5. **Monaco boot applies state too early**
   
   Boot snapshot/model creation happens before WBA/editor socket/language catalog/provider installation. If mimicking code-server, the frontend should avoid presenting an active model as language-intelligence-ready before the WBA document/editor lifecycle has run.

6. **Open/model sync and provider requests are still blurred**
   
   Code-server split is clear: document open/change pushes state; hover/completion/symbols/etc request providers later. TE2 has gates, but the same readiness machinery is still being used to recover from ordering problems instead of enforcing this sequence as the normal path.

Short version: TE2 has much of the machinery, but the ordering is wrong. The missing shape is a code-server-like lifecycle state machine: workspace accepted/settled, language metadata ready, document/editor delta accepted, then provider requests.

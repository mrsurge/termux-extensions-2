1. Diff Editor crashes with console error sometimes 2/10/2026
- This is the console error:

```
23:56:36.240 [DraftDiff] apply /data/data/com.termux/files/home/mrselect6/docs/apps/code_cm6/CODE_TE2.md hunks=0 lines=1312 ms=2 m_editor_app.js:2817:17
23:56:36.240 [DraftDiff] summary add=0 del=0 decorations=0 zones=0 overlaps=0 m_editor_app.js:2939:19
00:00:31.360 Uncaught Error: can't access property "offsetNode", hitResult is null

_doHitTestWithCaretPositionFromPoint@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:37652:13
doHitTest@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:37699:25
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/controller/mouseTarget.js/HitTestRequest/this.hitTestResult<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:37212:64
get value@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:3970:32
get target@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:37199:11
_createMouseTarget@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:37299:13
createMouseTarget@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:37285:41
_execute@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39864:50
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/controller/dragScrolling.js/_execute/this._animationFrameDisposable<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39877:114
execute@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:10997:16
animationFrameRunner@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11021:15
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/base/browser/dom.js/scheduleAtNextAnimationFrame/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11036:72
FrameRequestCallback*scheduleAtNextAnimationFrame@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11036:24
_execute@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39877:42
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/controller/dragScrolling.js/_execute/this._animationFrameDisposable<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39877:114
execute@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:10997:16
animationFrameRunner@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11021:15
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/base/browser/dom.js/scheduleAtNextAnimationFrame/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11036:72
FrameRequestCallback*scheduleAtNextAnimationFrame@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11036:24
_execute@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39877:42
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/controller/dragScrolling.js/DragScrollingOperation/this._animationFrameDisposable<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39726:118
execute@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:10997:16
animationFrameRunner@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11021:15
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/base/browser/dom.js/scheduleAtNextAnimationFrame/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11036:72
FrameRequestCallback*scheduleAtNextAnimationFrame@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:11036:24
DragScrollingOperation@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39726:42
LeftRightDragScrollingOperation@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39818:39
_createDragScrollingOperation@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39815:16
start@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39706:34
_onMouseDownThenMove@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:40161:44
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/controller/mouseHandler.js/start/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:40227:120
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/editorDom.js/startMonitoring/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:34742:30
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/base/browser/globalPointerMoveMonitor.js/startMonitoring/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:33194:16
EventListener.handleEvent*DomListener@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:10941:20
addDisposableListener@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:10392:10
startMonitoring@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:33188:25
startMonitoring@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:34741:40
start@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:40227:34
_onMouseDown@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:40100:36
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/controller/mouseHandler.js/MouseHandler/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39934:89
worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/editor/browser/editorDom.js/onMouseDown/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:34683:19
EventListener.handleEvent*DomListener@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:10941:20
addDisposableListener@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:10392:10
onMouseDown@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:34682:16
MouseHandler@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:39934:36
PointerHandler@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:41384:41
View2@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:59245:47
_createView@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:81662:22
_attachModel@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:81574:42
setModel@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.js:80582:16
ensureDiffEditorWithPrefs@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_editor/m_editor_app.js:2525:20
applyGitBaselines@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_editor/m_editor_app.js:2306:7
connectEditorSocket/<@http://localhost:8089/api/app/file_editor_cm6/ui/monaco_editor/m_editor_app.js:3462:26
I.prototype.emit@http://localhost:8089/static/vendor/socket.io.min.js:6:7218
    unexpectedErrorHandler errors.ts:26
    setTimeout handler*worktrees/vscode-te2-diff/out-monaco-editor-core/esm/vs/base/common/errors.js/ErrorHandler/this.unexpectedErrorHandler errors.ts:20
    onUnexpectedError errors.ts:41
    onUnexpectedError errors.ts:66
    execute dom.ts:312
    animationFrameRunner dom.ts:351
    scheduleAtNextAnimationFrame dom.ts:369
    scheduleAtNextAnimationFrame dom.ts:369
    _execute dragScrolling.ts:216
    _animationFrameDisposable dragScrolling.ts:216
    execute dom.ts:310
    animationFrameRunner dom.ts:351
    scheduleAtNextAnimationFrame dom.ts:369
    scheduleAtNextAnimationFrame dom.ts:369
    _execute dragScrolling.ts:216
    _animationFrameDisposable dragScrolling.ts:73
    execute dom.ts:310
    animationFrameRunner dom.ts:351
    scheduleAtNextAnimationFrame dom.ts:369
    scheduleAtNextAnimationFrame dom.ts:369
    DragScrollingOperation dragScrolling.ts:73
    LeftRightDragScrollingOperation dragScrolling.ts:166
    _createDragScrollingOperation dragScrolling.ts:162
    start dragScrolling.ts:40
    _onMouseDownThenMove mouseHandler.ts:430
    start mouseHandler.ts:507
    startMonitoring editorDom.ts:259
    startMonitoring globalPointerMoveMonitor.ts:102
    DomListener dom.ts:142
    addDisposableListener dom.ts:163
    startMonitoring globalPointerMoveMonitor.ts:91
    startMonitoring editorDom.ts:254
    start mouseHandler.ts:503
    _onMouseDown mouseHandler.ts:331
    MouseHandler mouseHandler.ts:133
    onMouseDown editorDom.ts:166
    DomListener dom.ts:142
    addDisposableListener dom.ts:163
    onMouseDown editorDom.ts:165
    MouseHandler mouseHandler.ts:133
    PointerHandler pointerHandler.ts:150
    View2 view.ts:288
    _createView codeEditorWidget.ts:1851
    _attachModel codeEditorWidget.ts:1753
    setModel codeEditorWidget.ts:507
    ensureDiffEditorWithPrefs m_editor_app.js:2525
    applyGitBaselines m_editor_app.js:2306
    connectEditorSocket m_editor_app.js:3462
    emit index.js:136
errors.ts:26:12
    unexpectedErrorHandler errors.ts:26
    (Async: setTimeout handler)
    unexpectedErrorHandler errors.ts:20
    onUnexpectedError errors.ts:41
    onUnexpectedError errors.ts:66
    execute dom.ts:312
    animationFrameRunner dom.ts:351
    scheduleAtNextAnimationFrame dom.ts:369
    (Async: FrameRequestCallback)
    scheduleAtNextAnimationFrame dom.ts:369
    _execute dragScrolling.ts:216
    _animationFrameDisposable dragScrolling.ts:216
    execute dom.ts:310
    animationFrameRunner dom.ts:351
    scheduleAtNextAnimationFrame dom.ts:369
    (Async: FrameRequestCallback)
    scheduleAtNextAnimationFrame dom.ts:369
    _execute dragScrolling.ts:216
    _animationFrameDisposable dragScrolling.ts:73
    execute dom.ts:310
    animationFrameRunner dom.ts:351
    scheduleAtNextAnimationFrame dom.ts:369
    (Async: FrameRequestCallback)
    scheduleAtNextAnimationFrame dom.ts:369
    DragScrollingOperation dragScrolling.ts:73
    LeftRightDragScrollingOperation dragScrolling.ts:166
    _createDragScrollingOperation dragScrolling.ts:162
    start dragScrolling.ts:40
    _onMouseDownThenMove mouseHandler.ts:430
    start mouseHandler.ts:507
    startMonitoring editorDom.ts:259
    startMonitoring globalPointerMoveMonitor.ts:102
    (Async: EventListener.handleEvent)
    DomListener dom.ts:142
    addDisposableListener dom.ts:163
    startMonitoring globalPointerMoveMonitor.ts:91
    startMonitoring editorDom.ts:254
    start mouseHandler.ts:503
    _onMouseDown mouseHandler.ts:331
    MouseHandler mouseHandler.ts:133
    onMouseDown editorDom.ts:166
    (Async: EventListener.handleEvent)
    DomListener dom.ts:142
    addDisposableListener dom.ts:163
    onMouseDown editorDom.ts:165
    MouseHandler mouseHandler.ts:133
    PointerHandler pointerHandler.ts:150
    View2 view.ts:288
    _createView codeEditorWidget.ts:1851
    _attachModel codeEditorWidget.ts:1753
    setModel codeEditorWidget.ts:507
    ensureDiffEditorWithPrefs m_editor_app.js:2525
    applyGitBaselines m_editor_app.js:2306
    connectEditorSocket m_editor_app.js:3462
    emit index.js:136
```

2. Diff Editor doest change with git status update (it should) 2/10/2026
- this is more of a feature request... but it *is* also inconsistent behavior.

3. 'Review Edits' element/teb in the explorer (that shows draft edits through out the current project) stopped working 2/10/2026 
- displays nothing
- uses drafting system (draft sidecars)
- document drafts still working
- dangerous, because this is the best point of broad observability for unsaved work for users (just imagine wanting to save a large document, but unsure if there are any other undrafted items in it)
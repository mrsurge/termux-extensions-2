# Monaco Sticky Scroll Technical Documentation

## 1. Overview

The Sticky Scroll feature in Monaco Editor (and by extension VS Code) is a UI enhancement that keeps the header of the current code scope visible at the top of the viewport when the user scrolls past it. This helps users maintain context within large files, complex functions, or deeply nested structures like JSON objects or CSS rules.

The implementation is a self-contained editor contribution that orchestrates a specific overlay widget. This widget renders lines of code that are "stuck" to the top. The feature is highly configurable, supporting different models for determining scope (Outline, Indentation, Folding), and handles complex interactions like navigation, folding, and link clicking.

This document provides a comprehensive deep dive into the technical architecture, model calculation strategies, rendering pipeline, state management, and interaction handling of the Sticky Scroll feature.

## 2. Architecture and Core Components

The Sticky Scroll feature is built upon a modular architecture involving a Controller, a Widget (View), and a Provider (Model).

### 2.1 The Controller (`StickyScrollController`)

The `StickyScrollController` is the central brain of the operation. It implements `IEditorContribution`, which allows it to be instantiated and managed with the editor's lifecycle.

**Responsibilities:**
- **Lifecycle Management**: It initializes the widget and the provider, and cleans them up upon disposal.
- **State Coordination**: It bridges the gap between the `StickyScrollProvider` (which calculates *what* should be shown) and the `StickyScrollWidget` (which *shows* it).
- **Event Handling**: It listens to editor events (scrolling, layout changes, model changes) and user interactions (mouse clicks, keyboard navigation) to trigger updates.
- **Focus Management**: It manages the focus state of the sticky scroll widget, allowing users to navigate through the sticky lines using the keyboard.

**Key Interactions:**
- It listens to `onDidChangeConfiguration` to react to settings changes (e.g., enabling/disabling the feature, changing the max line count).
- It calls `_renderStickyScroll()` whenever the editor scrolls or the content changes, which triggers the pipeline to update the widget.

### 2.2 The View (`StickyScrollWidget`)

The `StickyScrollWidget` is a pure UI component that implements `IOverlayWidget`. It is responsible for drawing the sticky lines and managing their DOM elements.

**Responsibilities:**
- **DOM Construction**: It creates the HTML structure for the sticky lines, including line numbers and the code content itself.
- **Rendering**: It uses the `StickyScrollWidgetState` to determine which lines to render and where to position them.
- **Layout**: It ensures the widget resizes correctly when the editor layout changes (e.g., adjusting for the sidebar or minimap).
- **Style Management**: It handles z-indexing to ensure lines stack correctly and applies CSS classes for styling.

**Structure:**
The widget's DOM is divided into:
- `_lineNumbersDomNode`: Holds the line numbers for the sticky lines.
- `_linesDomNode`: Holds the actual code content.
- `_linesDomNodeScrollable`: A container that syncs horizontal scrolling with the editor.

### 2.3 The Provider (`StickyLineCandidateProvider`)

The `StickyLineCandidateProvider` (and the underlying `StickyModelProvider`) acts as the data source. It determines which lines in the current viewport are valid candidates to be "stuck".

**Responsibilities:**
- **Model Generation**: It interacts with the `StickyModelProvider` to build a hierarchical tree of scopes (the `StickyModel`).
- **Intersection Calculation**: It calculates which scopes intersect with the current viewport.
- **Filtering**: It filters out scopes that shouldn't be shown (e.g., those hidden by folding).

### 2.4 The Component Diagram

```
[StickyScrollController] <---> [CodeEditor]
       |          |
       v          v
[StickyScrollWidget]     [StickyLineCandidateProvider]
       |                          |
       |                          v
       |               [StickyModelProvider]
       |                          |
       |                +---------+----------+
       |                |         |          |
       |           [Outline] [Folding] [Indentation]
       v
    (DOM Updates)
```

## 3. Model Calculation and Scope Detection

The core intelligence of the sticky scroll feature lies in how it determines which lines are "scopes". This is handled by the `StickyModelProvider` in `stickyScrollModelProvider.ts`.

### 3.1 Model Provider Strategy pattern

The `StickyModelProvider` uses a strategy pattern to support different methods of scope detection, defined by the `ModelProvider` enum:
1.  **Outline Model**: Uses the language server's document symbol provider. This is the most accurate for languages with rich tooling (e.g., TypeScript, C#).
2.  **Folding Provider**: Uses the syntax folding ranges. Useful as a fallback or for languages with good folding support but no symbol provider.
3.  **Indentation Model**: Uses indentation levels. This is a generic fallback that works for almost any structured text.

### 3.2 The `StickyModel` Structure

Regardless of the source, the data is normalized into a `StickyModel` containing a tree of `StickyElement` nodes.

**`StickyElement`:**
- `range`: The `StickyRange` (start and end line) of the scope.
- `children`: A list of nested `StickyElement` nodes.
- `parent`: A reference to the parent element (used for traversal).

### 3.3 Candidate Intersection Algorithm

Once the `StickyModel` is built, the `StickyLineCandidateProvider` uses it to find lines for the current viewport. This happens in `getCandidateStickyLinesIntersecting`.

**The Algorithm:**
1.  **Binary Search**: It performs a binary search on the `children` of the current `StickyElement` to find the child that contains the start of the visible range.
2.  **Recursive Traversal**: It traverses down the tree. For each node, it checks if the node's range overlaps with the top of the viewport.
3.  **Validation**: It checks:
    - Does the scope end after the viewport starts?
    - Is the scope visible (not hidden by manual folding)?
    - Is the line already added?
4.  **Collection**: Valid lines are added to a list of `StickyLineCandidate` objects.
5.  **Depth**: The recursion continues to `depth + 1`, allowing nested scopes to be stacked.

### 3.4 Handling Updates

The model update process is asynchronous and cancellable (`CancellationToken`).
- Triggers: Model content changes, configuration changes, or provider updates (e.g., new symbols available).
- Debouncing: Updates are debounced (e.g., `RunOnceScheduler`) to prevent performance degradation during rapid typing.

## 4. The Rendering Mechanism

The rendering process transforms the list of `StickyLineCandidate` objects into the visual overlay. This is orchestrated by `StickyScrollController._renderStickyScroll`.

### 4.1 State Calculation (`findScrollWidgetState`)

Before rendering, the controller calculates the desired state of the widget:
1.  **Get Visible Ranges**: It asks the editor for the currently visible line ranges.
2.  **Get Candidates**: It queries the `StickyLineCandidateProvider` with the full visible range.
3.  **Filter & Limit**: It iterates through candidates, checking their vertical position relative to the scroll top.
    - `topOfElement`: The logical top of the candidate line.
    - `topOfBeginningLine`: The screen-space top of the candidate line.
    - `bottomOfEndLine`: The screen-space bottom of the candidate scope.
4.  **Push Condition**: A line is added to `startLineNumbers` if it is "above" the current viewport top but its scope extends "below" the viewport top.
5.  **Max Lines**: It stops collecting when `maxStickyLines` is reached.

**The "Pushing" Effect:**
The method also calculates `lastLineRelativePosition`. This is critical for the visual effect where a new incoming scope "pushes" the old sticky header up.
- If the bottom of a sticky scope (`bottomOfElement`) is approaching the bottom of the sticky widget stack (`bottomOfEndLine`), the offset is calculated.
- This negative offset is applied to the widget's position, creating the smooth displacement animation.

### 4.2 Widget Rendering (`StickyScrollWidget._renderRootNode`)

The widget updates the DOM based on the new state (`StickyScrollWidgetState`).

**Reconciliation:**
- The widget attempts to reuse existing DOM nodes.
- `_findIndexToRebuildFrom`: It compares the new list of line numbers with the old list to find the first divergence point.
- It only destroys and recreates DOM nodes from that index onwards, improving performance.

**Line Rendering:**
For each line to be rendered:
1.  **View Model Access**: It accesses the editor's `IViewModel` to get rendering data (tokens, decorations, colorization).
2.  **`RenderLineInput`**: It constructs a `RenderLineInput` object, mimicking the main editor's line rendering logic.
3.  **`renderViewLine`**: It calls the shared `renderViewLine` function (used by the main editor) to generate the HTML. This ensures the sticky line looks *exactly* like the code in the editor (syntax highlighting, fonts, etc.).
4.  **DOM Assembly**: The generated HTML is wrapped in a `span` with `sticky-line-content` class and appended to the widget.
5.  **Line Numbers**: A separate `span` is created for the line number, respecting the editor's line number configuration (On, Relative, Interval).

### 4.3 Folding Icons

The widget also renders folding icons if configured.
- It checks the `FoldingModel` to see if the sticky line is the start of a folding region.
- It adds a click listener to toggle the fold state directly from the sticky header.
- The icon state (collapsed/expanded) matches the actual editor state.

## 5. Interaction and Event Handling

The sticky scroll isn't just a passive display; it's interactive.

### 5.1 Mouse Interactions

**Clicking:**
- **Navigation**: Clicking a sticky line jumps the editor to that line (`_revealPosition`).
- **Focus**: Clicking focuses the editor on that line.
- **Folding**: Clicking the folding chevron toggles the region.

**Hovering:**
- **Definition Preview**: The `ClickLinkGesture` is used. If the user hovers over a symbol in the sticky line while holding a modifier (e.g., Cmd/Ctrl), it triggers the "Go to Definition" provider.
- **Underline**: Valid links are underlined, mimicking standard editor link behavior.

### 5.2 Keyboard Navigation

The controller manages a specific context key `stickyScrollFocused`.

**Focus Trap:**
- When `FocusStickyScroll` is triggered, focus moves from the editor text area to the sticky widget.
- The `_focusDisposableStore` tracks this state.

**Navigation Commands:**
- `SelectNextStickyScrollLine` (Down Arrow): Moves focus to the next sticky line.
- `SelectPreviousStickyScrollLine` (Up Arrow): Moves focus to the previous sticky line.
- `GoToStickyScrollLine` (Enter): Jumps to the currently focused sticky line and returns focus to the editor.
- `SelectEditor` (Escape): Returns focus to the editor without moving the cursor.

### 5.3 Context Menu

Right-clicking the sticky widget triggers a specific context menu (`MenuId.StickyScrollContext`). This allows users to quickly toggle the feature or change its settings directly from the widget.

## 6. Performance Considerations

### 6.1 Layout & Resizing
The widget listens to `onDidLayoutChange`. It carefully calculates widths to match the editor's content box, ensuring the sticky lines align perfectly with the text below, even when the sidebar is resized or scrollbars appear.

### 6.2 Debouncing and Cancellation
- **Model Updates**: Are debounced (50ms) to avoid blocking the main thread during typing.
- **Async Tokens**: `CancellationToken` is used extensively. If the user scrolls or types while a model calculation is in progress, the old calculation is cancelled immediately to save resources.

### 6.3 Render Optimization
- **Partial Rebuilds**: As mentioned in 4.2, the widget only rebuilds changed lines.
- **Hidden Widget**: If the height is 0, the widget is set to `display: none` to remove it from the browser's composite layer.

## 7. Configuration Options

The behavior is controlled by `EditorOption.stickyScroll`:
- `enabled`: Global toggle.
- `maxLineCount`: Maximum number of lines to stack (default 5).
- `defaultModel`: Preferred model (Outline, Indentation, Folding).
- `scrollWithEditor`: Whether the widget scrolls horizontally with the editor.

These options are reactive. The `StickyScrollController` observes `onDidChangeConfiguration` and triggers a full rebuild (`readConfiguration`) when critical options change.

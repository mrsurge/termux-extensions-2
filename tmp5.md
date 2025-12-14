# Final Analysis: Sticky Scroll Flicker Fix

## Assessment of Existing Analysis
I have reviewed the code in `app/apps/file_editor_cm6/static/js/explorer_extensions/sticky_scopes.js` and the analysis documents (`tmp.md`, `tmp2.md`, `tmp3.md`, `tmp4.md`).

**Conclusion:** The analysis in **`tmp3.md`** (Sticky Scroll Flicker Bug: Revised Analysis) is **CORRECT** and provides the most complete understanding of the issue. `tmp4.md` correctly validates and reinforces these findings.

The breakdown is:
1.  **Oscillation (The Trigger):** The focus probe (`computeFocusNode`) and the CSS transforms (`applyPushTransforms`) create a feedback loop. The probe reads the DOM position, the code applies a transform based on that read, the transform moves the element, and the next frame's probe reads the *moved* element, causing the calculated scope chain to flip back and forth (e.g., length 3 → 2 → 3).
2.  **Visual Glitch (The Artifact):** When the chain length temporarily drops (e.g., 3 → 2), `ensureSlotCount` *immediately* removes the DOM elements for the 3rd slot and its underlay. This removes the opaque mask, allowing the underlying tree content (like `pkg.tgz` in the example) to bleed through for a single frame before the chain flips back. This rapid creation/deletion of the mask creates the "flicker".

## The Plan

The solution proposed in `tmp3.md` (State Machine + Locked Slot Count) is the correct path forward. It decouples the visual transition from the noisy focus probe data.

### 1. State Machine Implementation
We will transform the `sticky_scopes.js` logic to include a state machine:
-   **`STABLE`**: Normal operation. Probe determines chain. If a "push-out" is detected (overlap < 0) AND the chain key changes, enter `PUSHING`.
-   **`PUSHING`**:
    -   **Lock the Chain:** Ignore the focus probe. Force the renderer to use the `transitionLockedChain` (the chain as it was *before* the swap).
    -   **Lock the Slot Count:** Force `ensureSlotCount` to maintain the number of slots/underlays from the locked chain, preventing premature removal of the mask.
    -   **Wait for Completion:** Stay in this state until the push transform is "complete" (the element is pushed fully out of view, e.g., `<= -rowStepPx`) OR a safety timeout (e.g., 10 frames) is reached.
-   **`SWAP_PENDING`**: A transition state to allow one clean frame before returning to `STABLE`.

### 2. Slot Count Protection
Crucially, we must modify `ensureSlotCount` (or how it's called) to respect a `minSlots` parameter derived from the locked state, ensuring `stickySlots.pop()` is not called while we are animating the exit of a scope.

## Next Steps
No further analysis is required. The fix involves modifying `app/apps/file_editor_cm6/static/js/explorer_extensions/sticky_scopes.js` to implement the state machine described above.

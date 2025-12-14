# Sticky Scroll Flicker Analysis & Solution

## Code Analysis

The current implementation of sticky scopes in `sticky_scopes.js` relies on a frame-by-frame recalculation of the "sticky chain" based on visual geometry (`document.elementsFromPoint`). This creates a feedback loop:

1.  **Geometry Read:** `computeFocusNode` determines the current chain based on element positions.
2.  **State Update:** The chain determines which scopes are sticky.
3.  **Visual Write:** `applyPushTransforms` moves the sticky scopes (and effectively the visual "bottom" of the sticky stack) using CSS transforms.
4.  **Feedback:** In the next frame, `computeFocusNode` uses the *new* visual positions (affected by the transforms) to calculate the chain.

When a scope is being "pushed out" by an incoming sibling, the `lastBottomTranslateY` changes rapidly. This alters the probe offset in `computeStickyChainWithOffset`, potentially causing the probe to hit a different element (e.g., skipping the pushing scope or hitting a child). This causes the chain to oscillate between "N scopes" and "N-1 scopes".

Furthermore, `ensureSlotCount` immediately removes DOM elements (slots and underlays) when the chain length decreases.

```javascript
// sticky_scopes.js:281
while (stickySlots.length > count) {
  const slot = stickySlots.pop();
  slot?.remove(); // Immediate removal
  // ...
  const underlay = stickyUnderlays.pop();
  underlay?.remove(); // Immediate removal
}
```

If the chain oscillates (e.g., 3 -> 2 -> 3), the underlay for the 3rd scope is removed in the "2" frame. This reveals the underlying tree content that was previously masked, causing a visual "flash" or "bleed-through" of content that shouldn't be visible yet.

## Veracity of Claims in tmp2.md and tmp3.md

*   **tmp2.md (Initial Analysis):** Correctly identified the "frame-level race condition" and the feedback loop between the focus probe and transforms. The proposed "State Machine" solution is sound.
*   **tmp3.md (Revised Analysis):** Correctly identified the compounding issue of "Premature Underlay Removal". The observation that the "flicker" involves seeing underlying content (like `pkg.tgz`) because the masking underlay is removed is highly plausible and consistent with the code in `ensureSlotCount`. The refined solution (State Machine + Locked Slot Count) addresses both the oscillation and the visual artifacts.

**Verdict:** The analysis in `tmp3.md` is accurate and the proposed solution is robust.

## Proposed Solution

I reinforce the solution proposed in `tmp3.md`. We must implement a **Transition State Machine** that decouples the visual animation from the geometric probing during push transitions.

### Core Logic Changes

1.  **State Machine:** Introduce states `STABLE`, `PUSHING`, and `SWAP_PENDING`.
2.  **Lock Chain & Slot Count:** When a push transition begins (`PUSHING` state):
    *   Lock the `chain` to the *outgoing* state (the longer chain).
    *   Lock the `slotCount` to the *outgoing* length.
    *   Ignore `computeFocusNode` results for chain determination (only use them to detect when to *start* the transition).
3.  **Deferred Removal:** Only allow the chain length (and thus slot count) to decrease after the push animation has completed (or a timeout occurs). This ensures the underlay remains in place until the scope is visually pushed off-screen.

### Implementation Sketch

Modify `updateNow` in `sticky_scopes.js`:

```javascript
// Module-level state
let transitionState = 'STABLE';
let transitionLockedChain = null;
let transitionLockedSlotCount = 0;
let transitionFrameCount = 0;
const TRANSITION_MIN_FRAMES = 3;

// Inside updateNow...
const rawChain = computeStickyChainWithOffset();
// ...

if (transitionState === 'STABLE') {
  const pushState = measurePushes(stickySourceLis);
  // Detect if we are pushing out and the chain wants to change
  if (pushState.activeCount > 0 && rawKey !== lastKey) {
    transitionState = 'PUSHING';
    transitionLockedChain = stickySourceLis.slice();
    transitionLockedSlotCount = stickySourceLis.length;
    transitionFrameCount = 0;
    chain = transitionLockedChain;
    key = lastKey;
  } else {
    chain = rawChain;
    key = rawKey;
  }
} else if (transitionState === 'PUSHING') {
  // Force the locked chain
  chain = transitionLockedChain;
  key = lastKey;
  transitionFrameCount++;

  // Check if push is done
  const pushState = measurePushes(transitionLockedChain);
  const deepestPush = pushState.pushes[pushState.pushes.length - 1] || 0;
  const pushComplete = deepestPush <= -rowStepPx + PUSH_SWAP_READY_EPS_PX;

  if (pushComplete || transitionFrameCount > 10) { // Safety timeout
    transitionState = 'SWAP_PENDING';
    transitionFrameCount = 0;
  }
} else if (transitionState === 'SWAP_PENDING') {
  // One frame to stabilize before unlocking
  chain = rawChain;
  key = rawKey;
  transitionState = 'STABLE';
  transitionLockedChain = null;
  transitionLockedSlotCount = 0;
}

// Crucial: Prevent slot reduction during PUSHING
let targetSlotCount = chain.length;
if (transitionState === 'PUSHING') {
  targetSlotCount = Math.max(targetSlotCount, transitionLockedSlotCount);
}
ensureSlotCount(targetSlotCount);
```

This approach solves the root cause by breaking the feedback loop and ensures visual continuity by maintaining the masking underlays during the transition.

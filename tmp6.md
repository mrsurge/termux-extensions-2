# Sticky Scroll Flicker: Analysis of Failed Fix

**Date:** 2025-12-13
**Status:** Analysis of why the previous State Machine fix failed.

## The Problem
The user reports the **exact same issue** persists despite the implementation of the State Machine and Slot Count Locking.
Visual evidence (`step5.png` / `step6.png`) describes:
1.  Underlying content (`pkg.tgz`) appearing where the sticky header should be.
2.  Rapid alternation between chain states.
3.  Double rendering of headers.

## Why the Previous Fix Failed
The previous fix correctly identified **what** needed to happen (Lock Chain + Lock Slots), but it failed at **when** to trigger it.

The trigger logic was:
```javascript
if (scrollDirection === 'down' && wantsSwap) {
  const pushState = measurePushes(stickySourceLis);
  if (pushState.activeCount > 0) { // <--- FAILURE POINT
    transitionState = 'PUSHING';
    // ... lock ...
  }
}
```

**The Fatal Flaw:**
`pushState.activeCount > 0` requires the overlap to be strictly less than `-0.5px` (epsilon).
However, the **Focus Probe** (`computeFocusNode`) operates on DOM geometry with a 1-frame lag in its offset adjustment (`lastBottomTranslateY`).

**The Sequence of Failure:**
1.  **Frame N:** The "Next Sibling" (`android`) is at `top: 100px`. The "Sticky Bottom" is at `100px`. Overlap is `0`.
2.  **Frame N+1:** User scrolls 2px. `android` moves to `98px`.
    *   **Probe:** The probe offset (calculated from Frame N's 0px push) sees `android` which has moved up. It hits `android` instead of `seti-icons`. **`wantsSwap` becomes TRUE.**
    *   **Trigger Check:** We calculate `pushState`. `overlap` might be calculated as `-2px` (active) OR, due to sub-pixel rendering or slight inconsistencies between `getBoundingClientRect` and the probe's hit-test logic, it might be calculated as `0px` or `0.1px` (inactive).
    *   **Scenario A (The miss):** If `measurePushes` returns overlap > -0.5px (e.g. 0px), the `activeCount` check fails.
    *   **Result:** We **DO NOT** enter `PUSHING`. We proceed to **Swap the Chain**.
3.  **The Damage:**
    *   The chain swaps to the shorter version (`[root, _tmp]`).
    *   `seti-icons` is removed. Its underlay is removed.
    *   **Visual:** `pkg.tgz` (child of `seti-icons`) is now visible because the mask is gone.
    *   **Logic:** The "push" is now effectively over because `seti-icons` is no longer in the sticky stack to be pushed.

## The Correct Fix
We must make the State Machine **Predictive** or at least **Defensive**.

We cannot rely solely on `activeCount > 0`. If the chain `wantsSwap` (meaning the probe thinks we've moved on), we must check if we are **close** to a push.

If the *outgoing* chain has a sibling that is "approaching" (e.g., overlap < 5px or even < 10px), we must assume the probe is **wrong** (premature) and lock the state to `PUSHING`.

This compensates for the race condition between the Probe (which jumps the gun) and the Transform logic.

## Plan
1.  Modify `measurePushes` to return a `minOverlap` (or `closestDist`).
2.  Update the Trigger Logic in `updateNow`:
    ```javascript
    const PROXIMITY_THRESHOLD_PX = 5; // Buffer for probe inaccuracy
    // ...
    const pushState = measurePushes(stickySourceLis);
    // Trigger if actively pushing OR if we are dangerously close
    const isClose = pushState.closestOverlap < PROXIMITY_THRESHOLD_PX;
    
    if (pushState.activeCount > 0 || isClose) {
       transitionState = 'PUSHING';
       // ... lock ...
    }
    ```
3.  This ensures we catch the transition *before* or *exactly when* the probe flips, keeping the old chain alive to animate out gracefully.
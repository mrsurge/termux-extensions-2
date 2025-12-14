# Sticky Scroll Flicker: Post-Mortem & Final Fix Analysis

**Date:** 2025-12-13
**Status:** Analysis of why the State Machine implementation failed and the required correction.

## Evidence Review
I have reviewed `step5.png` and `step6.png`. They provide conclusive proof of the failure mode:

1.  **Step 5 (The "Bleed-Through"):**
    -   We see `_tmp > pkg.tgz` visible directly.
    -   **Diagnosis:** The `seti-icons` sticky header (which should cover `pkg.tgz`) was removed *instantly* when the chain swapped. The "State Machine" failed to engage/lock the old chain.
2.  **Step 6 (The "Double Vision"):**
    -   We see `android` as a sticky header AND `android` as a DOM row below it.
    -   **Diagnosis:** The chain swapped to the new state (showing `android`) before the previous scope (`seti-icons`) had finished pushing out. The smooth transition was skipped.

## Why the Current Fix Failed
The code *has* the State Machine logic, but the **Trigger Condition** is flawed.

Current Logic (lines 485-487):
```javascript
if (scrollDirection === 'down' && wantsSwap) {
  const pushState = measurePushes(stickySourceLis);
  if (pushState.activeCount > 0) { // <--- THE BUG
    transitionState = 'PUSHING';
    // ... lock ...
  }
}
```

**The Race Condition:**
1.  The **Focus Probe** is slightly "ahead" of the visual push. It detects the next sibling (`android`) and flips `wantsSwap` to `true`.
2.  At this exact frame, the **Push Overlap** might be `0px` (or `-0.1px` rounded to `0`).
3.  `pushState.activeCount` requires `overlap < -0.5px`.
4.  **Result:** The check `activeCount > 0` returns **FALSE**.
5.  **Catastrophe:** The code bypasses the `PUSHING` lock. It proceeds to swap the chain immediately. `ensureSlotCount` destroys the `seti-icons` slot. The flicker occurs.

## The Correct Analysis & Solution
We cannot trust `activeCount > 0` alone because the probe is too eager. If the probe *wants* to swap, we must check if we are *close* to a push, not just *in* one.

If `wantsSwap` is true, it implies we are at a boundary. We must force the `PUSHING` state if the outgoing chain has a sibling approaching the boundary, even if it hasn't crossed it yet.

### Proposed Logic Correction
1.  **Measure Proximity:** `measurePushes` needs to report how close the nearest sibling is (`closestOverlap`).
2.  **Defensive Trigger:** Trigger the lock if:
    -   `activeCount > 0` (Already pushing)
    -   **OR** `closestOverlap < PROXIMITY_THRESHOLD` (e.g., 5px).

This ensures that even if the probe jumps the gun by a few pixels, we catch it and force the smooth transition animation (locking the old chain) instead of allowing the destructive swap.

## Conclusion
The previous analysis identified the right *mechanism* (State Machine) but missed the sensitivity of the *trigger*. The fix requires loosening the trigger to include a "proximity buffer" to compensate for the probe/render race condition.

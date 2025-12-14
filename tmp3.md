# Sticky Scroll Flicker Bug: Revised Analysis

**Date:** 2025-12-13  
**Analyst:** AI Assistant (second pass after image review)  
**Status:** Root cause refined — two compounding issues identified

---

## Revision Summary

After re-examining the actual screenshots (Steps 1-6), I'm revising my original analysis. The core diagnosis (frame-level chain oscillation) was correct, but I missed a **second compounding issue** that explains the severity of the visual artifacts.

---

## The Two Compounding Problems

### Problem 1: Chain Oscillation (Original Diagnosis — Still Valid)

The focus probe reads DOM geometry that doesn't match the logical chain state during CSS transform animations. This causes the chain to flip between:
- `[root, _tmp, seti-icons]` (3 scopes)
- `[root, _tmp]` (2 scopes)

...at 60fps during push transitions.

### Problem 2: Premature Underlay Removal (NEW — Explains Visual Severity)

**What I missed initially:** When `ensureSlotCount()` reduces the slot count (from 3 to 2), it **immediately removes** the underlay elements:

```javascript
while (stickySlots.length > count) {
  const slot = stickySlots.pop();
  slot?.remove();  // ← Immediate DOM removal
  stickyRows.pop();

  const underlay = stickyUnderlays.pop();
  underlay?.remove();  // ← Immediate DOM removal
}
```

This creates a **race condition within a race condition**:
1. Frame A: Chain = 3 scopes, underlays mask content properly
2. Frame B: Chain oscillates to 2 scopes, third underlay is **deleted**
3. Frame B: Content behind where the third underlay was **bleeds through**
4. Frame C: Chain oscillates back to 3 scopes, underlay is **recreated**
5. Visual result: rapid flashing of content that should be hidden

---

## Visual Evidence Reinterpretation

### Step 5 (Key Insight)

In my original analysis I said the focus probe was hitting `pkg.tgz`. Looking more carefully at the screenshot:

- `pkg.tgz` appears **at the wrong indent level** (same indent as where `seti-icons` should be)
- This is NOT the focus probe hitting the wrong element
- This is the **underlay being removed**, allowing the underlying DOM content to show through
- The `seti-icons` sticky slot was deleted, so there's nothing masking `pkg.tgz` in the tree

**The smoking gun:** `pkg.tgz` is visible at an indent level that matches the tree's actual DOM position, not the sticky overlay's position. If it were a focus probe issue, we'd see a wrong sticky row—not raw tree content.

### Step 6 (Confirmation)

`android` appears **twice**:
1. **Top instance:** At shallow indent under `mrselect5` — this is the **sticky slot** (chain jumped to `[root, android]`)
2. **Bottom instance:** At correct tree indent — this is the **real DOM row**

This confirms:
- The chain swapped forward prematurely (skipped the `seti-icons` push-out animation)
- The underlay coverage is now wrong (doesn't extend far enough to hide the second `android`)

---

## Why the Current Gating Logic Fails

Lines 478-497 attempt to hold the chain during pushes:

```javascript
if ((isMultiPush && isPushingOut) || (isPushingOut && !swapReady)) {
  chain = stickySourceLis;
  key = lastKey;
}
```

This logic **does** prevent the chain key from changing on *some* frames, but:

1. **It doesn't prevent slot count reduction.** The chain identity is held, but if the raw chain is shorter, `ensureSlotCount()` still runs with the smaller count on frames where the gate doesn't trigger.

2. **The gate has gaps.** The conditions `isPushingOut && !swapReady` have a narrow overlap zone where neither condition is true, allowing chain swaps mid-animation.

3. **`KEY_STABILITY_FRAMES` runs after the push gate.** Even if the push gate holds the chain, the stability logic can override it back to the raw chain.

---

## Refined Solution: State Machine + Deferred Cleanup

### Core Fix (State Machine)

Same as my original Option 1, but with explicit slot count protection:

```javascript
let transitionState = 'STABLE'; // 'STABLE' | 'PUSHING' | 'SWAP_PENDING'
let transitionLockedChain = null;
let transitionLockedSlotCount = 0;  // NEW: Lock slot count too
let transitionFrameCount = 0;
const TRANSITION_MIN_FRAMES = 3;

// In updateNow(), after computing rawChain:

if (transitionState === 'STABLE') {
  const pushState = measurePushes(stickySourceLis);
  const hasActivePush = pushState.activeCount > 0;
  
  if (hasActivePush && rawKey !== lastKey) {
    transitionState = 'PUSHING';
    transitionLockedChain = stickySourceLis.slice();
    transitionLockedSlotCount = stickySourceLis.length;  // NEW
    transitionFrameCount = 0;
    chain = transitionLockedChain;
    key = lastKey;
  } else {
    chain = rawChain;
    key = rawKey;
  }
  
} else if (transitionState === 'PUSHING') {
  chain = transitionLockedChain;
  key = lastKey;
  transitionFrameCount += 1;
  
  // NEW: Prevent slot count from shrinking during transition
  // ensureSlotCount() will be called with transitionLockedSlotCount
  
  const pushState = measurePushes(transitionLockedChain);
  const deepestPush = pushState.pushes[pushState.pushes.length - 1] || 0;
  const pushComplete = deepestPush <= -rowStepPx + PUSH_SWAP_READY_EPS_PX;
  
  if (pushComplete || transitionFrameCount >= TRANSITION_MIN_FRAMES) {
    transitionState = 'SWAP_PENDING';
    transitionFrameCount = 0;
  }
  
} else if (transitionState === 'SWAP_PENDING') {
  chain = rawChain;
  key = rawKey;
  transitionState = 'STABLE';
  transitionLockedChain = null;
  transitionLockedSlotCount = 0;
  // NOW it's safe to reduce slot count via ensureSlotCount(chain.length)
}

// Later, when calling ensureSlotCount:
const slotCount = transitionState === 'PUSHING' 
  ? Math.max(chain.length, transitionLockedSlotCount)
  : chain.length;
ensureSlotCount(slotCount);
```

### Why This Fixes Both Problems

1. **Chain oscillation:** Locked during `PUSHING` state, focus probe results ignored
2. **Premature underlay removal:** Slot count cannot decrease until `SWAP_PENDING` → `STABLE` transition

The push animation completes visually (scope slides up and off-screen), THEN the slot/underlay is removed. No bleed-through possible.

---

## Alternative: Animated Underlay Removal

Instead of deferring removal, animate the outgoing underlay's opacity/height:

```javascript
function removeSlotAnimated(index) {
  const slot = stickySlots[index];
  const underlay = stickyUnderlays[index];
  
  // Fade out over 150ms
  slot.style.transition = 'opacity 150ms';
  underlay.style.transition = 'opacity 150ms';
  slot.style.opacity = '0';
  underlay.style.opacity = '0';
  
  setTimeout(() => {
    slot.remove();
    underlay.remove();
  }, 150);
}
```

This is more complex and has timing edge cases, so I still recommend the state machine approach.

---

## Summary of Changes from Original Analysis

| Aspect | Original (tmp2.md) | Revised (tmp3.md) |
|--------|-------------------|-------------------|
| Root cause | Focus probe feedback loop | Focus probe feedback loop **+** premature underlay removal |
| Step 5 interpretation | Probe hitting `pkg.tgz` | Underlay deleted, tree content bleeding through |
| Solution scope | Lock chain during push | Lock chain **AND** slot count during push |
| Confidence | 95% | 98% |

---

## Implementation Priority

1. **Add state machine** (breaks the oscillation loop)
2. **Lock slot count during PUSHING** (prevents underlay bleed-through)
3. **Reset to STABLE on scroll-up** (existing direction logic)
4. **Add safety timeout** (max 10 frames in transition)

Total code delta: ~90 lines (slightly more than original estimate due to slot count locking).

---

## Diagnostic Overlay (Unchanged Recommendation)

Still highly recommended for validation:

```
Chain: [mrselect5, _tmp, seti-icons]
State: PUSHING (frame 2/3)
Slots: 3 (locked)
Push[0]: 0px
Push[1]: 0px  
Push[2]: -15px ← ACTIVE
Scroll: ↓ 347px
```

This would show exactly when the state machine engages and whether slot count is being protected.

---

## Conclusion

The flicker bug is caused by **two compounding race conditions**:

1. **Chain identity oscillation** — the focus probe sees different elements frame-to-frame during push animations
2. **Slot/underlay deletion timing** — when the chain shrinks, underlays are removed immediately, exposing content that should be masked

The state machine fix addresses both issues by treating the entire push transition as an atomic operation: chain identity AND slot count are frozen until the animation completes.

The existing push-gating logic (lines 478-497) was 80% of the way there but missed the slot count protection. The state machine is the clean completion of that approach.

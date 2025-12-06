# Simultaneous Scope Transition with Push-Up Animation

**Date:** 2025-12-06  
**Problem:** Push-up animation doesn't trigger because the old scope is cleared in the same frame the new scope activates.

## The Core Issue

Current flow when Section B reaches the header while Section A is displayed:

```
Frame N:   Section A active, Section B approaching
Frame N+1: Section A CLEARED, Section B REGISTERED  ← instant swap, no animation
```

The push-up animation needs **overlap**—a window where both scopes exist so the outgoing scope can animate out while the incoming scope waits.

## Solution: Transitioning Scope State

Instead of a binary active/inactive state, introduce a **transitioning** state for the outgoing scope:

```
Frame N:   Section A active (normal)
Frame N+1: Section A transitioning (pushing up), Section B pending
Frame N+2: Section A transitioning (more pushed up), Section B pending  
Frame N+3: Section A removed, Section B active
```

### Implementation Approach

#### Option A: Dual-Scope Rendering for Siblings

When a sibling scope is about to replace the current one at the same depth:

1. **Detect sibling transition**: New scope at same depth with different `startLine`
2. **Keep both temporarily**: Don't clear the old scope immediately
3. **Render outgoing with push-up**: The old scope gets negative `translateY`
4. **Render incoming below**: The new scope slides in from below the old one
5. **Complete transition**: When old scope is fully pushed out, remove it

```javascript
// In slot registration logic
if (shouldActivate) {
  const existing = this.slots.get(scope.depth);
  if (existing && existing.startLine !== scope.startLine) {
    // Sibling replacement detected!
    // Don't clear immediately - mark for transition
    existing.transitioning = true;
    existing.replacement = scope;
    // DON'T register the new scope yet
  } else {
    this.slots.register(scope);
  }
}
```

#### Option B: Render Queue with Animation Delay

Maintain a separate "outgoing" scope that renders with push-up animation:

```javascript
// State
this.outgoingScope = null;  // Scope being pushed out
this.outgoingProgress = 0;  // 0 to 1, animation progress

// When clearing a slot due to sibling replacement
if (shouldClear && reason === 'sibling_replacement') {
  this.outgoingScope = existing;
  this.outgoingProgress = 0;
  // Clear from slots but keep rendering
}

// In render loop
if (this.outgoingScope) {
  // Render outgoing scope with push-up based on progress
  const pushOffset = -lineHeight * this.outgoingProgress;
  renderScopeLayer(this.outgoingScope, pushOffset);
  
  // Advance animation
  this.outgoingProgress += 0.15; // ~6 frames to complete
  if (this.outgoingProgress >= 1) {
    this.outgoingScope = null;
  }
}
```

#### Option C: CSS Transition-Driven (Recommended)

Let CSS handle the animation timing. The JS just needs to:
1. Add the new scope
2. Mark the old scope for exit
3. CSS transitions handle the rest

```javascript
// When sibling detected, render BOTH scopes in the same slot position
// Old scope gets class 'exiting', new scope gets class 'entering'

// CSS
".cm-sticky-layer.exiting": {
  transform: "translateY(-100%)",
  opacity: "0",
  transition: "transform 150ms ease-out, opacity 150ms ease-out",
  pointerEvents: "none",
}

".cm-sticky-layer.entering": {
  animation: "slideIn 150ms ease-out",
}

@keyframes slideIn {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

## Detailed Implementation for Option C

### Step 1: Track Pending Transitions

```javascript
constructor(view) {
  // ... existing code ...
  this.pendingTransitions = new Map(); // depth -> { outgoing, incoming, startTime }
}
```

### Step 2: Detect Sibling Replacement

```javascript
// In the activation loop
if (shouldActivate) {
  const existing = this.slots.get(scope.depth);
  if (existing && existing.startLine !== scope.startLine) {
    // Sibling at same depth - start transition
    this.pendingTransitions.set(scope.depth, {
      outgoing: existing,
      incoming: scope,
      startTime: performance.now(),
    });
    // Keep existing in slot for now; will swap after animation
  } else if (!existing) {
    this.slots.register(scope);
  }
}
```

### Step 3: Render Both During Transition

```javascript
// In render section
activeScopes.forEach((scope, idx) => {
  const transition = this.pendingTransitions.get(scope.depth);
  
  if (transition && transition.outgoing.startLine === scope.startLine) {
    // This is the outgoing scope - render with exit animation
    const layer = this.createLayer(scope, idx, { exiting: true });
    this.dom.appendChild(layer);
    
    // Also render the incoming scope
    const incomingLayer = this.createLayer(transition.incoming, idx, { entering: true });
    this.dom.appendChild(incomingLayer);
  } else {
    // Normal render
    const layer = this.createLayer(scope, idx, {});
    this.dom.appendChild(layer);
  }
});
```

### Step 4: Complete Transition After Animation

```javascript
// After render, check for completed transitions
const TRANSITION_DURATION = 150; // ms

for (const [depth, transition] of this.pendingTransitions) {
  const elapsed = performance.now() - transition.startTime;
  if (elapsed >= TRANSITION_DURATION) {
    // Animation complete - swap scopes
    this.slots.clear(depth);
    this.slots.register(transition.incoming);
    this.pendingTransitions.delete(depth);
  }
}
```

## The Key Insight

The problem isn't the offset timing—it's that the **slot system enforces mutual exclusion**. At any moment, only ONE scope can occupy a depth slot.

For smooth sibling transitions, we need to **temporarily break this rule** and allow both the outgoing and incoming scope to render simultaneously during the ~150ms animation window.

## Alternative: Push-Up Without Slot Overlap

If we want to keep strict slot exclusivity, we can trigger the push-up animation **before** the new scope activates:

```javascript
// Detect "incoming sibling" by looking ahead in candidateScopes
const incomingSibling = candidateScopes.find(s => 
  s.depth === existing.depth && 
  s.startLine !== existing.startLine &&
  s.startLine > existing.startLine
);

if (incomingSibling) {
  // Calculate how close the sibling's heading is to the header bottom
  const siblingLineObj = state.doc.line(incomingSibling.startLine);
  const siblingBlock = view.lineBlockAt(siblingLineObj.from);
  const siblingTopViewport = siblingBlock.top - scrollTop;
  const headerBottom = activeScopes.length * lineHeight;
  
  const distanceToHeader = siblingTopViewport - headerBottom;
  
  if (distanceToHeader < lineHeight * 3) {
    // Sibling is close - start push-up on current scope
    // Push amount proportional to proximity
    const pushProgress = 1 - (distanceToHeader / (lineHeight * 3));
    topOffset = -lineHeight * pushProgress;
  }
}
```

This approach:
- Detects incoming sibling before it activates
- Starts pushing the current scope up as sibling approaches
- When sibling finally activates and replaces, current scope is already mostly pushed out
- No slot overlap needed

## Recommendation

**Use the "look-ahead" approach** (last section). It:
- Keeps the slot system simple (one scope per depth)
- Triggers push-up based on incoming sibling proximity
- Provides smooth visual transition without architectural changes
- Is easier to tune (adjust the `lineHeight * 3` threshold)

The key is detecting the incoming sibling and computing push-up offset based on its distance from the header, rather than based on the current scope's end position.

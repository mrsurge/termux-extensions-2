# Two Sticky Scroll Strategies for Code CM6

## 1) n+1 (Early Trigger) — Current Approach
- **Trigger rule:** For a scope at `startLine`, activate when `refLine` crosses `startLine - (depth + 2)` (lead-in per depth).
- **Effect:** Header appears 1–2 lines *before* content hits the top; mitigates obstruction when the stack occupies vertical space.
- **Strengths:** Predictable, cheap (line math), works without pixel-perfect geometry; good for coarse scroll environments.
- **Weaknesses:** Can misfire with partial/incorrect parse trees; “pile-up” when siblings aren’t detected; coarse (line-level) so it can flip on small jitter; needs heuristic hysteresis/linger tuning.
- **Best use:** When parsing is unreliable or expensive; when you want conservative early context and don’t require pixel-exact docking.

## 2) Monaco-Style Geometric Docking
- **Trigger rule:** For depth `d`, header “slot” is at `d * lineHeight`. Activate when the source line’s Y-position reaches that slot (contact-based).
- **Effect:** Header docks exactly when it would visually overlap; nested scopes slide under/into the stack; no arbitrary lead-in.
- **Strengths:** Pixel-accurate; naturally avoids obstruction; smoother with high-DPI/continuous scrolling; less reliant on heuristics.
- **Weaknesses:** Needs reliable line-to-pixel geometry (`lineBlockAtHeight`) and stable scope ranges; still depends on a good scope model (symbols/folding/indent); more sensitive to wrap and layout changes.
- **Best use:** When geometry data is trustworthy and you want Monaco-like “docking” visuals with minimal early pop-in.

## Practical Path for Code CM6
- **Short term:** Keep n+1 but harden sibling handoff with a precomputed top-level index (or fallback when parse is partial/error), plus small linger/hysteresis smoothing.
- **Alternate mode (experiment):** Add a feature flag to switch to Monaco docking for Python/JS, using pixel contact and a cached scope index for siblings. Compare flicker/pile-up rates and UX.


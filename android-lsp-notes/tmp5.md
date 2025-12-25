# Review: `framework_shells_implementation_plan.md` (Does it hold up?)

This is a written copy of my analysis from chat. **No execution steps are included.**

---

## Overall verdict

The plan is **mostly technically feasible** and aligns with the “package-first hard split” direction, but as written it has **one major architectural gap** and a few **policy/stance mismatches** that will bite during implementation.

---

## What holds up (sound pieces)

- **Package structure**: the proposed `framework_shells/` layout is reasonable and maps well to the existing monolith in `app/libs/framework_shells.py`.
- **Runtime isolation primitives**: secret → runtime_id + api token + record signature is implementable with stdlib (`hashlib`/`hmac`) and matches your “multiple runtimes/clones” goal.
- **dtach persistence**: using dtach as the persistence layer for “tmux-like attach” says the right thing architecturally and reuses the patterns already proven by:
  - `scripts/init.sh` (`dtach -A ... --rcfile ...`)
  - `scripts/run_in_session.sh` (`dtach -p` injection)
- **Sessions & Shortcuts migration direction**: moving from polling to snapshot + events is the correct UX direction.

---

## Major gap: the event bus is in-process only (TE2 is multi-process)

The proposed `EventBus` is a **singleton inside a Python process**. TE2 runs multiple Python processes (framework + app workers).

Implication:

- If an **app worker process** instantiates/uses a `FrameworkShellManager` and emits events, those events **will not** reach the framework’s Sessions & Shortcuts websocket (different process, different singleton).

To make “event-driven updates” actually hold up in TE2, you need to choose one of these models:

1. **Single control-plane manager** (recommended for your SSOT philosophy)
   - Only the framework process owns the manager + event bus.
   - App workers never create managers; they call the framework (HTTP/WS) for spawn/terminate/write/list.
2. **Cross-process event transport**
   - An out-of-process bus exists (IPC server, socketio, or a small WS hub).
   - All processes publish to it; UIs subscribe to it.

Right now the plan reads like “drop in a singleton event bus” which is not sufficient across processes.

---

## Policy mismatch: “purge foreign records” will sabotage iteration

Phase 2 proposes purging “foreign” records during adoption:

- This is not just “no fallbacks”; it’s aggressive cleanup.
- It will make it harder to use TE2 to edit TE2 while both old/new systems exist during the split.

Better default policy for this phase:

- **Do not adopt** foreign/legacy shells
- **Do not purge/kill** them automatically
- Optionally mark them as “unmanaged/legacy” in UI, and provide an explicit cleanup action later.

---

## Execution-stance mismatch: dual auth surface and “no secret = no enforcement”

The plan currently includes:

- accepting both `Authorization: Bearer` and `X-Framework-Key`
- “no secret → no enforcement”
- acceptance tests like “both headers work”

That’s a compatibility/fallback posture. If the branch stance is “new new; deal with it”, then the plan should pick **one** control-surface auth mechanism and migrate TE2 immediately.

---

## Minor factual drift

- The storage layout section says `run_id` “not persisted to file currently”, but TE2 already has a `~/.cache/te_framework/run_id` path in play via supervisor/startup scripts.

---

## Summary: what to change in the plan (high impact)

1. Add an explicit section deciding the **event bus model** (single-manager vs cross-process bus).
2. Replace “purge foreign records” with “ignore foreign/legacy by default”.
3. Pick **one auth surface** and remove “both headers” acceptance tests if you want the hard-cut stance.
4. Correct the small run-id storage note.


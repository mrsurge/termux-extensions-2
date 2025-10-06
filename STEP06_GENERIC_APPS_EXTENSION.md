# Step 6 — Generic Apps Extension Integration (Manifest → Shell → Assets → Lifecycle)

**Backend blueprint:** `app/extensions/apps/main.py`

- `/api/apps` — list apps from `app/apps/`, parse each `manifest.json`, and (safely) auto‑register backends.
- `/apps/<dir>/<file>` — serve app assets.
- `/app/<id>` — render `app_shell.html` (full‑screen frame).

**App shell lifecycle hook (add to app/templates/app_shell.html):**
```html
<script>
(() => {
  const appId = "{{ app_id }}";
  const group = `app:${appId}:${Date.now()}`;
  window.__teAppGroup = group;
  async function terminateGroup() {
    try {
      await fetch("/api/framework_shells/terminate_group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group })
      });
    } catch {}
  }
  window.addEventListener("pagehide", terminateGroup, { once: true });
})();
</script>
```

Any backend spawn should stamp `TE_GROUP=window.__teAppGroup` in child env (or use `spawn_scoped_shell()`).

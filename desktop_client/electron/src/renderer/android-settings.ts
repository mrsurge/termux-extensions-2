import type { androidSettings } from "../main/android-settings";
import type { DesktopBridge } from "../shared/contracts";

import type { AndroidSession } from "../main/android-session";

type Status = (NonNullable<Awaited<ReturnType<ReturnType<typeof androidSettings>["read"]>>> & {session?: ReturnType<AndroidSession["state"]>}) | null;

export function mountAndroidSettings(doc: Document, bridge: DesktopBridge) {
  const parent = doc.querySelector(".settings-page");
  const win = doc.defaultView;
  if (!parent || !win || doc.URL !== "te2-desktop://shell/android_shell/settings.html") return;
  const section = doc.createElement("section");
  section.className = "settings-section";
  section.id = "android-system-settings";
  section.innerHTML = `
    <header class="section-header"><h2>Android settings</h2></header>
    <div class="android-status-lines" role="status"></div>
    <div data-session hidden>
      <label class="toggle-row"><span><strong>Keep active app connections alive</strong>
      <small>Show an ongoing notification while a local or remote app is open. Stop ends protection for this session.</small></span>
      <input type="checkbox" data-enabled></label>
      <label class="toggle-row"><span><strong>Keep CPU awake during the session</strong>
      <small>Allow background processing while the screen is off. This uses more battery.</small></span>
      <input type="checkbox" data-awake></label>
    </div>
    <div class="section-actions">
      <button class="secondary-button" type="button" data-settings="notifications">Notification settings</button>
      <button class="secondary-button" type="button" data-settings="battery">Battery settings</button>
      <button class="secondary-button" type="button" data-settings="details">App details</button>
    </div>`;
  const status = section.querySelector<HTMLElement>(".android-status-lines")!;
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const controls = section.querySelector<HTMLElement>("[data-session]")!;
  const enabled = controls.querySelector<HTMLInputElement>("[data-enabled]")!;
  const awake = controls.querySelector<HTMLInputElement>("[data-awake]")!;
  let saving = false;
  let revision = 0;
  const refresh = async () => {
    if (doc.hidden) return;
    const current = ++revision;
    try {
      const state = await bridge.request("get_android_system_settings") as Status;
      if (current !== revision || lifetime.signal.aborted || !state) return;
      const lines: HTMLElement[] = [];
      const addLine = (text: string, state?: string) => {
        const line = doc.createElement("div");
        line.className = "status-line";
        line.textContent = text;
        if (state) line.dataset.state = state;
        lines.push(line);
      };
      if (state.delivery) {
        addLine(`Notification permission: ${state.delivery.permission}`);
        addLine(`App notifications: ${state.delivery.canPost ? "enabled" : "blocked"}`);
      }
      if (state.exempt !== undefined) addLine(`Battery optimization exemption: ${state.exempt ? "enabled" : "disabled"}`, state.exempt ? "online" : "offline");
      for (const perm of state.permissions) addLine(`CPU wake lock permission: ${perm.status}`);
      if (state.downloads) addLine(`Shared Downloads: read ${state.downloads.readable ? "allowed" : "unavailable"}, write ${state.downloads.writable ? "allowed" : "unavailable"}`);
      if (state.session && !saving) {
        controls.hidden = false;
        enabled.checked = state.session.enabled;
        awake.checked = state.session.keepCpuAwake;
        awake.disabled = !enabled.checked;
        addLine(state.session.active ? "Session active" : "Session inactive");
      }
      status.replaceChildren(...lines);
      if (!section.isConnected) parent.appendChild(section);
    } catch (error) {
      if (current === revision && !lifetime.signal.aborted) {
        status.textContent = error instanceof Error ? error.message : "Android settings unavailable";
        if (!section.isConnected) parent.appendChild(section);
      }
    }
  };
  controls.addEventListener("change", async () => {
    if (saving) return;
    saving = true;
    enabled.disabled = awake.disabled = true;
    let failure = "";
    try {
      await bridge.request("save_android_session_settings", {enabled:enabled.checked, keepCpuAwake:awake.checked});
    } catch (error) {
      failure = error instanceof Error ? error.message : "Cannot save session preferences";
    } finally {
      saving = false;
      enabled.disabled = false;
      await refresh();
      if (failure) status.textContent = failure;
    }
  }, options);
  for (const button of section.querySelectorAll<HTMLButtonElement>("button[data-settings]")) {
    button.addEventListener("click", () => {
      void bridge.request("open_android_system_settings", {destination:button.dataset.settings}).catch(error => {
        status.textContent = error instanceof Error ? error.message : "Cannot open Android settings";
      });
    }, options);
  }
  win.addEventListener("focus", refresh, options);
  window.addEventListener("focus", refresh, options);
  doc.addEventListener("visibilitychange", refresh, options);
  win.addEventListener("pageshow", refresh, options);
  win.addEventListener("pagehide", () => lifetime.abort(), { once: true });
  void refresh();
}

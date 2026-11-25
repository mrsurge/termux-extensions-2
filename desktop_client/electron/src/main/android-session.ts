import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Preferences = { enabled: boolean; keepCpuAwake: boolean };
export type SessionApi = {
  startAndroidSession(options: { title: string; keepCpuAwake: boolean }, interrupted: (reason: string) => void): Promise<string>;
  stopAndroidSession(id: string): boolean;
  setAndroidSessionCpuAwake(id: string, awake: boolean): boolean;
};

export function supportsAndroidSession(platform: string, app: object): app is SessionApi {
  const api = app as Partial<SessionApi>;
  return platform === "android" && typeof api.startAndroidSession === "function"
    && typeof api.stopAndroidSession === "function" && typeof api.setAndroidSessionCpuAwake === "function";
}

export class AndroidSession {
  private preferences: Preferences = {enabled: false, keepCpuAwake: false};
  private opened = false;
  private interrupted = false;
  private id?: string;
  private queue = Promise.resolve();

  constructor(private api: SessionApi, private directory: string, private notify: (message: string) => void) {}

  async load() {
    try {
      const data = JSON.parse(await readFile(join(this.directory, "te2-android-session.json"), "utf8"));
      this.preferences = {enabled: data.enabled === true, keepCpuAwake: data.keepCpuAwake === true};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  state() {
    return {...this.preferences, active: !!this.id};
  }

  private serialize(task: () => Promise<void>) {
    const work = this.queue.then(task);
    this.queue = work.catch(() => {});
    return work;
  }

  appOpened(open: boolean) {
    return this.serialize(async () => {
      if (this.opened === open) return;
      this.opened = open;
      this.interrupted = false;
      await this.apply();
    });
  }

  configure(enabled: unknown, keepCpuAwake: unknown) {
    if (typeof enabled !== "boolean" || typeof keepCpuAwake !== "boolean") {
      return Promise.reject(new TypeError("Expected boolean Android session preferences"));
    }
    return this.serialize(async () => {
      const path = join(this.directory, "te2-android-session.json");
      const temporary = path + "." + randomUUID();
      const next = {enabled, keepCpuAwake};
      try {
        await writeFile(temporary, JSON.stringify(next), {mode: 0o600});
        await rename(temporary, path);
      } finally {
        await rm(temporary, {force:true});
      }
      if (enabled !== this.preferences.enabled) this.interrupted = false;
      this.preferences = next;
      await this.apply();
    });
  }

  private async apply() {
    if (!this.opened || !this.preferences.enabled || this.interrupted) {
      if (this.id) this.api.stopAndroidSession(this.id);
      this.id = undefined;
      return;
    }
    const awake = this.preferences.keepCpuAwake;
    if (this.id) {
      if (!this.api.setAndroidSessionCpuAwake(this.id, awake)) throw new Error("Android session is no longer active");
      return;
    }
    const id = await this.api.startAndroidSession({title:"TE2 app session", keepCpuAwake:awake}, reason => {
      void this.serialize(async () => {
        if (this.id !== id) return;
        this.id = undefined;
        this.interrupted = true;
        this.notify(reason === "stop" ? "Android session stopped" : "Android session ended");
      });
    });
    this.id = id;
  }
}

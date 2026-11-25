import assert from "node:assert/strict";
import test from "node:test";
import { androidSettings } from "./android-settings";

test("ordinary desktop and Android without the Electromux API expose no mobile settings", async () => {
  const unexpected = () => { throw new Error("unexpected native call"); };
  for (const host of [androidSettings("linux", {checkAndroidPermissions:unexpected}, unexpected),
                      androidSettings("android", {}, unexpected)]) {
    assert.equal(await host.read(), null);
    await assert.rejects(host.open("notifications"), /unavailable/);
  }
});

test("reads current grants and operational states independently and opens only known settings", async () => {
  let enabled = false;
  const opened: string[] = [];
  const host = androidSettings("android", {
    async checkAndroidPermissions(names) {
      assert.deepEqual(names, ["android.permission.WAKE_LOCK"]);
      return {permissions: [{name:names[0],status:"granted"}]};
    },
    async checkAndroidNotificationDelivery() { return {permission:"granted",canPost:enabled}; },
    async isAndroidBatteryOptimizationExempt() { return false; },
    async checkAndroidStorageAccess(path) {
      assert.equal(path,"/storage/self/primary/Download");
      return {readable:true,writable:false};
    },
  }, async url => { opened.push(url); });
  assert.equal((await host.read())?.delivery?.canPost,false);
  enabled = true;
  assert.equal((await host.read())?.delivery?.canPost,true);
  await host.open("notifications");
  await host.open("battery");
  await host.open("details");
  await assert.rejects(host.open("__proto__"), /unavailable/);
  assert.deepEqual(opened, ["electromux-settings://notifications","electromux-settings://battery-optimization","electromux-settings://app-details"]);
});

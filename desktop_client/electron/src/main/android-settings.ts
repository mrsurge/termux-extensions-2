type AndroidQueries = {
  checkAndroidPermissions?(names: string[]): Promise<{permissions: Array<{name: string; status: string}>}>;
  checkAndroidNotificationDelivery?(): Promise<{permission: string; canPost: boolean}>;
  isAndroidBatteryOptimizationExempt?(): Promise<boolean>;
  checkAndroidStorageAccess?(path: string): Promise<{readable: boolean; writable: boolean}>;
};

const destinations = {
  notifications: "electromux-settings://notifications",
  battery: "electromux-settings://battery-optimization",
  details: "electromux-settings://app-details",
} as const;

export function androidSettings(platform: string, app: AndroidQueries, openExternal: (url: string) => Promise<void>) {
  const supported = platform === "android" && typeof app.checkAndroidPermissions === "function";
  return {
    async read() {
      if (!supported) return null;
      const [permissions, delivery, exempt, downloads] = await Promise.all([
        app.checkAndroidPermissions!(["android.permission.WAKE_LOCK"]),
        app.checkAndroidNotificationDelivery?.(),
        app.isAndroidBatteryOptimizationExempt?.(),
        app.checkAndroidStorageAccess?.("/storage/self/primary/Download"),
      ]);
      return { permissions: permissions.permissions, delivery, exempt, downloads };
    },
    async open(destination: unknown) {
      if (!supported || typeof destination !== "string" || !Object.hasOwn(destinations, destination)) {
        throw new Error("Android settings destination unavailable");
      }
      await openExternal(destinations[destination as keyof typeof destinations]);
    },
  };
}

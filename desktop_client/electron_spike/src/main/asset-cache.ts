export interface FrameworkAssetCacheSession {
  clearCache(): Promise<void>;
  clearCodeCaches(options: { urls?: string[] }): Promise<void>;
}

export async function clearFrameworkAssetCaches(
  frameworkSession: FrameworkAssetCacheSession,
): Promise<void> {
  await Promise.all([
    frameworkSession.clearCache(),
    frameworkSession.clearCodeCaches({}),
  ]);
}

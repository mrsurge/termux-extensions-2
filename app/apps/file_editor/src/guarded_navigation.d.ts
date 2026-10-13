export function createGuardedNavigation(options: {
  needsConsent: () => boolean; confirm: () => Promise<boolean>;
}): (action: () => unknown) => Promise<boolean>;

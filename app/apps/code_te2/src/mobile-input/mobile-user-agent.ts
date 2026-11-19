export function isMobileUserAgent(navigatorLike: {
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
}): boolean {
  return navigatorLike.userAgentData?.mobile === true ||
    /\b(?:Android|Mobile|iPhone|iPad|iPod)\b/i.test(navigatorLike.userAgent || '');
}

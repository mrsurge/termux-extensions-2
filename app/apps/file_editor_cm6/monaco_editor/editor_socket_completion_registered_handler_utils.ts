export interface CompletionProviderRegisteredPayload {
  language?: string;
  handle?: unknown;
  triggerCharacters?: unknown[];
  supportsResolve?: unknown;
}

interface CompletionProviderRegistrationLike {
  handle: string;
  triggerCharacters: string[];
  supportsResolve: boolean;
}

function asCompletionProviderRegisteredPayload(value: unknown): CompletionProviderRegisteredPayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as CompletionProviderRegisteredPayload
    : null;
}

export function handleCompletionProviderRegistered(
  data: unknown,
  cacheCompletionProviderRegistration: (lang: string, registration: CompletionProviderRegistrationLike) => void,
): void {
  const typedData = asCompletionProviderRegisteredPayload(data);
  const lang = typeof typedData?.language === 'string' ? typedData.language : '';
  const handle = typedData?.handle;
  if (!lang || handle == null) return;
  const handleKey = String(handle || '').trim();
  if (!handleKey) return;

  const triggerCharacters = Array.isArray(typedData?.triggerCharacters)
    ? typedData!.triggerCharacters.map(String).filter(Boolean)
    : [];

  console.log(
    '[completions] push cached provider for ' + lang
    + ' handle=' + handleKey
    + ' triggers=' + triggerCharacters.length
    + ' resolve=' + (!!typedData?.supportsResolve ? '1' : '0'),
  );

  cacheCompletionProviderRegistration(lang, {
    handle: handleKey,
    triggerCharacters,
    supportsResolve: !!typedData?.supportsResolve,
  });
}

import { isUnknownArray } from '../src/rpc/value-types.ts';
export interface DocumentColorProviderRegisteredPayload {
  language?: string;
  handle?: unknown;
}

interface DocumentColorProviderRegistrationLike {
  handle: string;
}

function asDocumentColorProviderRegisteredPayload(
  value: unknown,
): DocumentColorProviderRegisteredPayload | null {
  return value != null && typeof value === "object" && !isUnknownArray(value)
    ? (value as DocumentColorProviderRegisteredPayload)
    : null;
}

export function handleDocumentColorProviderRegistered(
  data: unknown,
  cacheDocumentColorProviderRegistration: (
    lang: string,
    registration: DocumentColorProviderRegistrationLike,
  ) => void,
): void {
  const typedData = asDocumentColorProviderRegisteredPayload(data);
  const lang = typeof typedData?.language === "string" ? typedData.language : "";
  const handle = typedData?.handle;
  if (!lang || handle == null) return;
  const handleKey = String(handle).trim();
  if (!handleKey) return;

  console.log(
    "[documentColors] push cached provider for " +
      lang +
      " handle=" +
      handleKey,
  );

  cacheDocumentColorProviderRegistration(lang, { handle: handleKey });
}

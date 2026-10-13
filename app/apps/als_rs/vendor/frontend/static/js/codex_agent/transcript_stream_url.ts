type TranscriptStreamLocation = Pick<Location, 'href' | 'protocol'>;

export function buildTranscriptStreamUrl(locationValue: TranscriptStreamLocation): string {
  const url = new URL('ws/transcript', locationValue.href);
  url.protocol = locationValue.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

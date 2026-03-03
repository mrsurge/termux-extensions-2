export function buildVscodeApiWsUrl(loc, wsPath) {
  var proto = (loc.protocol === 'https:') ? 'wss' : 'ws';
  return proto + '://' + loc.host + wsPath;
}

# Settings frontend

`src/main.ts` owns the browser mount; `src/contracts.ts` validates unknown HTTP
and host-state ingress. `npm run typecheck`, `npm run build`, and `npm test`
produce/validate one minified ESM at the existing `main.js` URL. Template CSS
stays inline, with no new interception mappings or requests.

The Rust framework/runtime bridge remains settings, extension and shell authority.
Unknown settings fields survive patch saves; shell actions are never replayed.
Framework tokens retain the existing host-state storage behavior. Dynamic shell
labels/commands render as text, not HTML. Native activation needs separate OTA;
building this source does not update installed clients.

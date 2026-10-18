# Archive Manager frontend

`src/main.ts` owns the browser app; `src/contracts.ts` defines and validates its
listing, bookmark, picker, job and restored-state boundaries. The app-shell API
already unwraps app responses; only global jobs/bookmarks fetches unwrap their
own HTTP envelopes. Unknown payloads do not become frontend state by assertion.

Build and validate from this directory:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The build emits a single minified ES module directly to the existing `main.js`
manifest/OTA URL. Edit TypeScript, not generated `main.js`. The existing shared
`/static/js/jobs_client.js` remains an external import, not an app-local copy.
`template.html` remains authored HTML with inline CSS: no new stylesheet or
adapter request. Development node_modules is excluded from Python packages.

Directory/archive browsing, query seeds, host restoration, selection, bookmarks,
file pickers and extraction-job notification/cancellation retain their existing
ownership. Jobs now use `/api/app/archive_manager/jobs` and the shared helper's
explicit base URL for status/cancel/delete, not the retired `/api/jobs` routes.
Failures do not retry through another API. Create/Add/Test now have implemented
app endpoints and track admission through the same notifications; ZIP is the
write format. No session registry or cross-app intent brokerage is introduced.

The frontend tests execute compiled source with isolated DOM/host/job fixtures;
they are synthetic, not live worker or extraction-completion acceptance. Python
tests cover the separate ASGI/domain boundary using isolated TE2 state roots.
Publishing to native clients still needs an explicit OTA or package update;
building/reloading alone does not update their installed assets. This frontend
build needs no Code TE2 mypyc or native Cargo rebuild.

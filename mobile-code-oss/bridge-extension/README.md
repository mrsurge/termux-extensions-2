# Mobile Bridge VS Code Web Extension

A tiny web extension that listens for `postMessage` from a same-origin parent "mobile shell" and executes VS Code commands. It also posts state and a list of "chat providers" back to the parent.

## Build
```bash
npm i
npm run build
```
Package with your preferred tool (e.g., `ovsx package` or `vsce package`) and install in code-server / VS Code Web.

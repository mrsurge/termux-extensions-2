const express = require('express');
const fs = require('fs');
const path = require('path');

// Vendored Page Preview engine: the backend owns process lifecycle through FWS,
// while this script only serves the selected project entry through Vite middleware.
const HOST = process.env.TE2_PAGE_PREVIEW_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.TE2_PAGE_PREVIEW_PORT || '3000', 10);
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || process.cwd());
const ENTRY = process.env.TE2_PAGE_PREVIEW_ENTRY || 'index.html';

function resolveInsideProject(value) {
  const target = path.resolve(PROJECT_ROOT, value || 'index.html');
  const relative = path.relative(PROJECT_ROOT, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Entry is outside project root: ${value}`);
  }
  return target;
}

async function createServer() {
  process.chdir(PROJECT_ROOT);
  const app = express();
  const entryPath = resolveInsideProject(ENTRY);
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: PROJECT_ROOT,
    server: {
      middlewareMode: true,
      host: HOST,
    },
    appType: 'custom',
  });

  app.use(vite.middlewares);

  app.use(async (req, res) => {
    try {
      const template = fs.readFileSync(entryPath, 'utf-8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error);
      const message = error && error.stack ? error.stack : String(error);
      res.status(500).set({ 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    }
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`page-preview-ready http://${HOST}:${PORT}/ entry=${ENTRY}`);
  });

  async function shutdown() {
    await vite.close();
    server.close(() => process.exit(0));
  }

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

createServer().catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  console.error(`[page-preview] failed: ${message}`);
  process.exit(1);
});

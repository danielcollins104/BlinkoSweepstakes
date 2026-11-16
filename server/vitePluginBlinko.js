import fs from 'node:fs';
import path from 'node:path';
import { ApiRouter } from './apiRouter.js';
import { openDefaultSqliteStore } from './store/nodeSqlite.js';

export function loadEnvLocal(cwd = process.cwd()) {
  try {
    const envPath = path.resolve(cwd, '.env.local');
    if (!fs.existsSync(envPath)) return {};
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    const out = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        out[key] = val;
        if (!process.env[key]) process.env[key] = val;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function blinkoApiPlugin() {
  loadEnvLocal();
  let routerPromise = null;

  const getRouter = async () => {
    if (!routerPromise) {
      routerPromise = openDefaultSqliteStore(process.env.SQLITE_PATH || 'data/blinko.sqlite').then(
        (store) => new ApiRouter({ store, env: process.env })
      );
    }
    return routerPromise;
  };

  return {
    name: 'blinko-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (url.startsWith('/api/')) {
          const urlObj = new URL(url, 'http://localhost');
          const pathname = urlObj.pathname;
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1e6) req.destroy();
          });
          req.on('end', async () => {
            try {
              const router = await getRouter();
              const response = await router.handleRequest(req.method, pathname, req.headers, body, {
                query: urlObj.searchParams,
                ip: req.socket?.remoteAddress || '127.0.0.1',
              });
              res.statusCode = response.status;
              for (const [k, v] of Object.entries(response.headers)) {
                res.setHeader(k, v);
              }
              res.end(response.body !== null ? JSON.stringify(response.body) : undefined);
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        } else {
          next();
        }
      });
    },
  };
}

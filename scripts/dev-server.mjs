/**
 * Servidor de desarrollo local.
 *
 * Levanta Vite (la SPA) y las funciones de `api/` en el mismo origen, que es
 * justo lo que hace Vercel en producción. Sin esto, `/api/stream` no existe en
 * `vite dev` y el player nativo nunca se activa.
 *
 * Uso:
 *   node scripts/dev-server.mjs            → solo la app
 *   STREAM_DEMO_RESOLVER=1 node scripts/dev-server.mjs
 *                                          → activa el HLS de prueba
 */

process.env.STREAM_DEMO_RESOLVER ??= '';
process.env.STREAM_SIGNING_SECRET ??= 'local-dev-stream-secret-0123456789';

const { default: http } = await import('node:http');
const { createServer: createViteServer } = await import('vite');

const PORT = Number.parseInt(process.env.PORT ?? '5173', 10);

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      resolve(undefined);
      return;
    }

    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const ct = String(req.headers['content-type'] ?? '');
      if (ct.includes('application/json')) {
        try {
          resolve(JSON.parse(raw));
          return;
        } catch {
          resolve(raw);
          return;
        }
      }
      resolve(raw);
    });
    req.on('error', reject);
  });

const adapt = (handler) => async (req, res) => {
  const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
  const query = {};
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  if (typeof res.status !== 'function') {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }
  if (typeof res.json !== 'function') {
    res.json = (payload) => {
      if (!res.getHeader('content-type')) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
      return res;
    };
  }
  if (typeof res.send !== 'function') {
    res.send = (payload) => {
      res.end(payload);
      return res;
    };
  }

  try {
    const body = await readBody(req);
    await handler({ method: req.method, url: req.url, query, headers: req.headers, body }, res);
  } catch (error) {
    console.error('[api] fallo en', parsed.pathname, error);
    if (!res.headersSent) {
      res.writeHead(error?.message === 'payload_too_large' ? 413 : 500, {
        'content-type': 'application/json',
      });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: 'handler_failed', detail: String(error) }));
    }
  }
};

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
});

/**
 * Descubre automáticamente las funciones de `api/` para que el dev server se
 * comporte como Vercel: `api/search.ts` → `/api/search`, `api/auth/login.ts` →
 * `/api/auth/login`. Los archivos de `_lib/` no son rutas.
 */
const discoverRoutes = async () => {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const apiRoot = fileURLToPath(new URL('../api', import.meta.url));

  const found = {};
  const walk = async (dir, prefix) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, `${prefix}/${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const route = `${prefix}/${entry.name.replace(/\.ts$/, '')}`;
      try {
        const mod = await vite.ssrLoadModule(`/${join('api', route)}.ts`);
        if (typeof mod.default === 'function') {
          found[`/api${route}`] = adapt(mod.default);
        }
      } catch (error) {
        console.warn(`  [api] no se pudo cargar ${route}: ${String(error).slice(0, 120)}`);
      }
    }
  };

  await walk(apiRoot, '');
  return found;
};

const routes = await discoverRoutes();

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const route = routes[pathname];
  if (route) return route(req, res);
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not_found', path: pathname }));
  }
  vite.middlewares(req, res, () => {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
});

server.listen(PORT, () => {
  const demo = process.env.STREAM_DEMO_RESOLVER === '1';
  const list = Object.keys(routes).sort();
  console.log(`\n  Zenova dev → http://localhost:${PORT}\n`);
  console.log(`  Rutas montadas (${list.length}):`);
  for (const route of list) console.log(`    ${route}`);
  console.log('');
  console.log(`  Stream directo: ${demo ? 'ACTIVO (HLS de prueba)' : 'sin resolver real'}`);
  if (demo) {
    console.log(`  Prueba rápida: http://localhost:${PORT}/api/stream?imdb=tt1375666&type=movie`);
  }
  console.log('\n  Ctrl+C para parar.\n');
});

const shutdown = () => {
  server.close();
  vite.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

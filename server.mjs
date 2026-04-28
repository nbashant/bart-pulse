import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const appRoot = resolve(process.cwd());
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';
const publicBartKey = 'MW9S-E7SL-26DU-VV8V';
const bartKey = process.env.BART_API_KEY || publicBartKey;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/bart/etd') {
    await proxyBart(res, `https://api.bart.gov/api/etd.aspx?cmd=etd&orig=ALL&key=${encodeURIComponent(bartKey)}&json=y&gbColor=1`);
    return;
  }

  if (url.pathname === '/api/bart/advisories') {
    await proxyBart(res, `https://api.bart.gov/api/bsa.aspx?cmd=bsa&key=${encodeURIComponent(bartKey)}&json=y`);
    return;
  }

  const root = staticRoot();
  if (!root) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(
      '<!doctype html><title>BART Track Live</title><body><h1>BART Track Live has not been built.</h1><p>Run <code>npm run build</code> before <code>npm start</code>, or use <code>npm run dev</code> for development.</p></body>',
    );
    return;
  }

  let filePath = normalize(decodeURIComponent(url.pathname));
  if (filePath === '/' || filePath.endsWith('/')) filePath = join(filePath, 'index.html');
  const abs = resolve(root, `.${filePath}`);

  if (!abs.startsWith(root) || !existsSync(abs) || !statSync(abs).isFile()) {
    const fallback = resolve(root, 'index.html');
    if (existsSync(fallback)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': types[extname(abs)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(abs).pipe(res);
}).listen(port, host, () => {
  console.log(`BART Track Live running at http://${host}:${port}`);
});

function staticRoot() {
  const distRoot = resolve(appRoot, 'dist');
  return existsSync(resolve(distRoot, 'index.html')) ? distRoot : null;
}

async function proxyBart(res, url) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await response.text();
    res.writeHead(response.status, {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

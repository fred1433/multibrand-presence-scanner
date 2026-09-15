// One command that runs the whole thing on invented data: serves the fixture
// sites, reads them with the scanner, then runs the reconciliation over the
// fictional records. Offline, deterministic, nobody's real pages touched.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITES = join(ROOT, 'fixtures/sites');
const PORT = 8123;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(SITES, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(SITES)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' }).end('<!doctype html><title>not found</title>');
  }
});

const run = (args) =>
  new Promise((ok, no) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? ok() : no(new Error(`${args.join(' ')} exited ${code}`))));
  });

await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
try {
  console.log(`serving fixtures/sites on http://127.0.0.1:${PORT}\n`);
  await run([join(ROOT, 'src/cli.js'), '--brands', join(ROOT, 'example-brands.json'), '--out', join(ROOT, 'data'), '--no-render']);
  console.log('');
  await run([join(ROOT, 'src/pipeline/cli.js'), '--out', join(ROOT, 'data')]);
} finally {
  server.close();
}

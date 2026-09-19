// Engine capture for the iframe boot cost fixture: builds a fresh release
// binary path from OBSCURA_BIN, serves the fixture over a local HTTP server
// so the iframes resolve same-origin, and fetches the page with the CLI,
// reading back the in-page timing JSON.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const obscuraBin = process.env.OBSCURA_BIN || './target/release/obscura';
const runs = Number(process.env.RUNS || 3);

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url;
  try {
    const body = await readFile(join(fixtureDir, path));
    res.writeHead(200, { 'content-type': path.endsWith('.html') ? 'text/html' : 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/index.html`;

for (let i = 0; i < runs; i++) {
  const out = await new Promise((resolve) => {
    const proc = spawn(obscuraBin, [
      'fetch', fixtureUrl, '--allow-private-network',
      '--eval', `document.getElementById('r') ? document.getElementById('r').textContent : 'NO-RESULT'`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', () => {});
    proc.on('close', () => resolve(stdout));
  });
  const match = out.match(/\{"each".*\}/);
  console.log(match ? match[0] : out.split('\n').filter(Boolean).pop());
}
server.close();

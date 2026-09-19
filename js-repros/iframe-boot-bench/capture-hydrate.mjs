// Engine capture for the hydration microbench (hydrate.html): same shape as
// capture-obcura.mjs but drives the hydration fixture and surfaces stderr
// phase lines when OBSCURA_REALM_TIMING=1.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const obscuraBin = process.env.OBSCURA_BIN || './target/release/obscura';
const runs = Number(process.env.RUNS || 3);

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/hydrate.html' : req.url;
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
const fixtureUrl = `http://127.0.0.1:${server.address().port}/hydrate.html`;

for (let i = 0; i < runs; i++) {
  const out = await new Promise((resolve) => {
    const proc = spawn(obscuraBin, [
      'fetch', fixtureUrl, '--allow-private-network',
      '--eval', `document.getElementById('r') ? document.getElementById('r').textContent : 'NO-RESULT'`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('close', () => resolve({ stdout, stderr }));
  });
  if (process.env.OBSCURA_REALM_TIMING) {
    for (const line of out.stderr.split('\n')) {
      if (line.includes('[realm-timing]')) console.log(line);
    }
  }
  const match = out.stdout.match(/\{"create".*\}/);
  console.log(match ? match[0] : out.stdout.split('\n').filter(Boolean).pop());
}
server.close();

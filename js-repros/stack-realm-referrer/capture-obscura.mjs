import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const template = await readFile(join(fixtureDir, 'index.html'), 'utf8');
const staticFiles = new Map([
  ['/same.html', ['text/html; charset=utf-8', await readFile(join(fixtureDir, 'same.html'))]],
  ['/cross.html', ['text/html; charset=utf-8', await readFile(join(fixtureDir, 'cross.html'))]],
  ['/external.js', ['text/javascript; charset=utf-8', await readFile(join(fixtureDir, 'external.js'))]],
  ['/fixture.css', ['text/css; charset=utf-8', await readFile(join(fixtureDir, 'fixture.css'))]],
]);

const referers = {a: [], b: []};
const readReferer = request => request.headers.referer || null;
const makeServer = (which, crossOrigin) => createServer((request, response) => {
  const path = new URL(request.url, 'http://fixture.test').pathname;
  if (path === '/echo') {
    referers[which].push(readReferer(request));
    response.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify({referer: readReferer(request)}));
    return;
  }
  if (which === 'a' && path === '/') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'cache-control': 'no-store',
    });
    response.end(template.replaceAll('__CROSS_ORIGIN__', crossOrigin));
    return;
  }
  const entry = staticFiles.get(path);
  if (entry) {
    response.writeHead(200, {'content-type': entry[0], 'cache-control': 'no-store'});
    response.end(entry[1]);
    return;
  }
  response.writeHead(404).end();
});

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const serverB = makeServer('b', null);
await listen(serverB);
const bAddress = serverB.address();
const bOrigin = `http://127.0.0.1:${bAddress.port}`;
const serverA = makeServer('a', bOrigin);
await listen(serverA);
const aAddress = serverA.address();
const fixtureUrl = `http://127.0.0.1:${aAddress.port}/`;

const cli = process.env.OBSCURA_BIN || './target/release/obscura';
const child = spawn(cli, [
  '--allow-private-network', 'fetch', fixtureUrl,
  '--wait', '1', '--eval', '(async()=>JSON.stringify(await globalThis.fixturePromise))()',
], {env: {...process.env, OBSCURA_ALLOW_PRIVATE_NETWORK: '1', RUST_LOG: 'obscura=debug'}});
let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const exitCode = await new Promise(resolve => child.once('exit', resolve));
console.log(JSON.stringify({
  exitCode,
  fixtureUrl,
  referers,
  evalCaptured: stdout.trim().length > 0,
  traceEvidence: stderr.split('\n').filter(line => /referrer|frame|fetch/.test(line)).slice(-20),
}, null, 2));
if (exitCode !== 0) process.exitCode = exitCode || 1;
await close(serverA);
await close(serverB);

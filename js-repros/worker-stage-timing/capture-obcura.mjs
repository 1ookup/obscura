// Obscura capture for the worker stage timing fixture. Spawns
// `obscura serve` (CDP), drives it with the same CDP flow as the Chrome
// oracle (navigate, Runtime.evaluate + awaitPromise), and prints the JSON
// the page reports. serve mode keeps the page pump continuous, which is the
// shape the live challenge runs under.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const obscuraBin = process.env.OBSCURA_BIN || './target/release/obscura';
const servePort = Number(process.env.OBSCURA_PORT || 8977);

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url;
  try {
    const body = await readFile(join(fixtureDir, path));
    res.writeHead(200, { 'content-type': path.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/index.html`;

const proc = spawn(obscuraBin, [
  'serve', '--port', String(servePort), '--allow-private-network',
], {stdio: ['ignore', 'pipe', 'pipe']});

const browserWsUrl = await new Promise((resolve, reject) => {
  let stdout = '';
  const timeout = setTimeout(
    () => reject(new Error(`obscura CDP startup timed out:\n${stdout}`)),
    20000,
  );
  proc.stdout.on('data', chunk => {
    stdout += chunk;
    const match = stdout.match(/CDP server: (ws:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  proc.once('error', reject);
  proc.once('exit', code => reject(new Error(`obscura exited before CDP startup (${code})`)));
});

class CdpConnection {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, {once: true});
      this.socket.addEventListener('error', reject, {once: true});
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      const index = this.waiters.findIndex(waiter =>
        waiter.method === message.method && waiter.sessionId === message.sessionId
      );
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message.params);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = {id, method, params};
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.socket.send(JSON.stringify(message));
    });
  }
  waitFor(method, sessionId) {
    return new Promise(resolve => this.waiters.push({method, sessionId, resolve}));
  }
}

const cdp = new CdpConnection(browserWsUrl);
try {
  await cdp.open();
  const {targetId} = await cdp.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: true});
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', {url: fixtureUrl}, sessionId);
  await loaded;
  await new Promise(r => setTimeout(r, 250));
  const expression = 'globalThis.workerFixtureResult' +
    ' ? JSON.stringify(globalThis.workerFixtureResult)' +
    ' : (async () => { await globalThis.workerFixturePromise;' +
    ' return JSON.stringify(globalThis.workerFixtureResult); })()';
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
  console.log(typeof evaluated.result.value === 'string'
    ? JSON.stringify(JSON.parse(evaluated.result.value), null, 2)
    : JSON.stringify(evaluated.result.value, null, 2));
  await cdp.send('Target.closeTarget', {targetId});
} finally {
  cdp.socket.close();
  proc.kill('SIGTERM');
  server.close();
}

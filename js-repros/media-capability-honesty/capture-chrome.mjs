// Capture the Chrome oracle for ServiceWorkerContainer semantics.
//
// Unlike the other fixtures this one cannot use a data: URL: `navigator.
// serviceWorker` is only exposed on a potentially trustworthy origin with a
// non-opaque origin, so the probe is served over loopback HTTP.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const probe = await readFile(join(fixtureDir, 'probe.js'), 'utf8');
const chromeBin = process.env.CHROME_BIN || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome'
);

const server = createServer((request, response) => {
  if (request.url === '/' || request.url.startsWith('/index.html')) {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(`<!doctype html><meta charset="utf-8"><body><script>${probe}</script>`);
    return;
  }
  // Every other path 404s on purpose, including /definitely-missing-sw.js:
  // the probe uses it to observe the script-fetch failure rejection.
  response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
  response.end('not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

const profileDir = await mkdtemp(join(tmpdir(), 'obscura-chrome-media-'));
const chrome = spawn(chromeBin, [
  '--headless=new',
  '--disable-extensions',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`,
  'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});

const browserWsUrl = await new Promise((resolve, reject) => {
  let stderr = '';
  const timeout = setTimeout(
    () => reject(new Error(`Chrome CDP startup timed out:\n${stderr}`)),
    15000,
  );
  chrome.stderr.on('data', chunk => {
    stderr += chunk;
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  chrome.once('error', reject);
  chrome.once('exit', code => reject(new Error(`Chrome exited before CDP startup (${code})`)));
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
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: 'mediaFixturePromise',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
  console.log(JSON.stringify(evaluated.result.value, null, 2));
  await cdp.send('Target.closeTarget', {targetId});
} finally {
  cdp.socket.close();
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  chrome.kill('SIGTERM');
  await exited;
  await new Promise(resolve => server.close(resolve));
  await rm(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

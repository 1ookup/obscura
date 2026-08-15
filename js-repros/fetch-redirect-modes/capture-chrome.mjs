// Capture the Chrome oracle for fetch()'s three redirect modes.
//
// Served over loopback HTTP rather than a data: URL: the fixture is about what
// the *server* is asked for, so it needs a server that records its requests.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureServer } from './serve.mjs';

const chromeBin = process.env.CHROME_BIN || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome'
);

const server = await createFixtureServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

const profileDir = await mkdtemp(join(tmpdir(), 'obscura-chrome-redirect-'));
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
    expression: 'fetchRedirectFixturePromise',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
  const result = evaluated.result.value;
  // The half of this fixture that no page-side check can see: `error` and
  // `manual` must never produce a request for the redirect target.
  result.__serverSaw = server.requestsSeen
    .map(entry => entry.url)
    .filter(url => url !== '/' && !url.startsWith('/index.html') && url !== '/favicon.ico');
  console.log(JSON.stringify(result, null, 2));
  await cdp.send('Target.closeTarget', {targetId});
} finally {
  cdp.socket.close();
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  chrome.kill('SIGTERM');
  await exited;
  await new Promise(resolve => server.close(resolve));
  await rm(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

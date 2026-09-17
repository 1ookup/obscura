import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const nativeIdentity = process.env.CHROME_NATIVE === '1';
const chromeBin = process.env.CHROME_BIN || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome'
);

const files = new Map([
  ['/', ['text/html; charset=utf-8', await readFile(join(fixtureDir, 'index.html'))]],
  ['/probe.js', ['text/javascript; charset=utf-8', await readFile(join(fixtureDir, 'probe.js'))]],
]);
const server = createServer((request, response) => {
  const entry = files.get(new URL(request.url, 'http://fixture.test').pathname);
  if (!entry) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {'content-type': entry[0], 'cache-control': 'no-store'});
  response.end(entry[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

const profileDir = await mkdtemp(join(tmpdir(), 'obscura-chrome-fingerprint-'));
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
  const timeout = setTimeout(() => reject(new Error(`Chrome CDP startup timed out:\n${stderr}`)), 15000);
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
    this.eventWaiters = [];
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, {once:true});
      this.socket.addEventListener('error', reject, {once:true});
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
      const index = this.eventWaiters.findIndex(waiter =>
        waiter.method === message.method && waiter.sessionId === message.sessionId
      );
      if (index >= 0) this.eventWaiters.splice(index, 1)[0].resolve(message.params);
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
    return new Promise(resolve => this.eventWaiters.push({method, sessionId, resolve}));
  }
}

const cdp = new CdpConnection(browserWsUrl);
try {
  await cdp.open();
  const {targetId} = await cdp.send('Target.createTarget', {url:'about:blank'});
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten:true});
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  if (!nativeIdentity) {
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      platform: 'Win32',
      userAgentMetadata: {
        brands: [
          {brand:'Chromium', version:'146'},
          {brand:'Not-A.Brand', version:'24'},
          {brand:'Google Chrome', version:'146'},
        ],
        fullVersionList: [
          {brand:'Chromium', version:'146.0.0.0'},
          {brand:'Not-A.Brand', version:'24.0.0.0'},
          {brand:'Google Chrome', version:'146.0.0.0'},
        ],
        fullVersion: '146.0.0.0',
        platform: 'Windows',
        platformVersion: '10.0.0',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false,
      },
    }, sessionId);
    await cdp.send('Emulation.setHardwareConcurrencyOverride', {hardwareConcurrency:8}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width:1280,
      height:720,
      deviceScaleFactor:1,
      mobile:false,
      screenWidth:1920,
      screenHeight:1080,
      positionX:0,
      positionY:0,
    }, sessionId);
  }
  const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', {url:fixtureUrl}, sessionId);
  await loaded;
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression:'fingerprintFixturePromise',
    awaitPromise:true,
    returnByValue:true,
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
  await rm(profileDir, {recursive:true, force:true, maxRetries:5, retryDelay:100});
}

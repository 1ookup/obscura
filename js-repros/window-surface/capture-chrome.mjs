// Capture the Chrome surface oracle (window constructor surface, navigator
// getters, UA-CH, WebGL/WebGPU faces, text metrics and canvas paint baseline).
// Re-run this whenever the pinned stealth UA moves to a new Chrome major and
// commit the refreshed chrome-oracle.json next to the bootstrap data table.
//
// The probe needs a real GPU for the WebGL/WebGPU faces: headless Chrome falls
// back to SwiftShader and reports software renderer strings. Run without
// HEADLESS=1 (default) so Chrome opens briefly with hardware GL.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
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
const headless = process.env.HEADLESS === '1';

const server = createServer((request, response) => {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end('<!doctype html><meta charset="utf-8"><body></body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

const profileDir = await mkdtemp(join(tmpdir(), 'obscura-chrome-surface-'));
const args = [
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`,
];
if (headless) args.push('--headless=new', '--disable-gpu');
args.push('about:blank');
const chrome = spawn(chromeBin, args, {stdio: ['ignore', 'ignore', 'pipe']});

const browserWsUrl = await new Promise((resolve, reject) => {
  let stderr = '';
  const timeout = setTimeout(
    () => reject(new Error(`Chrome CDP startup timed out:\n${stderr}`)),
    20000,
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
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, {once: true});
      this.socket.addEventListener('error', reject, {once: true});
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
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
}

const cdp = new CdpConnection(browserWsUrl);
try {
  await cdp.open();
  const {targetId} = await cdp.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: true});
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.navigate', {url: fixtureUrl}, sessionId);
  // The probe runs in the loopback page's main world; give the navigation a
  // moment to commit before evaluating (no event plumbing in this mini client).
  await new Promise(resolve => setTimeout(resolve, 1200));
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: probe,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (evaluated.exceptionDetails) {
    throw new Error('probe threw: ' + JSON.stringify(evaluated.exceptionDetails.exception).slice(0, 400));
  }
  const result = evaluated.result.value;
  const ua = result.userAgent || '';
  const out = {
    capturedWith: ua,
    headless,
    data: result,
  };
  await writeFile(join(fixtureDir, 'chrome-oracle.json'), JSON.stringify(out, null, 1));
  const gpu = result.webgl1 && result.webgl1.unmaskedRenderer;
  console.log('wrote chrome-oracle.json');
  console.log('UA:', ua);
  console.log('window names:', result.window.names.length);
  console.log('renderer:', gpu);
} finally {
  await rm(profileDir, {recursive: true, force: true}).catch(() => {});
  chrome.kill('SIGTERM');
  server.close();
  process.exit(0);
}

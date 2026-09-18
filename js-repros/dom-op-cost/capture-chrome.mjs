// Chrome oracle capture for the DOM op cost fixture.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const chromeBin = process.env.CHROME_BIN || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome'
);
const fixtureUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  await readFile(join(fixtureDir, 'index.html'), 'utf8'),
);
const profileDir = await mkdtemp(join(tmpdir(), 'obscura-chrome-dombench-'));
const chrome = spawn(chromeBin, [
  '--headless=new', '--disable-extensions', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});
const browserWsUrl = await new Promise((resolve, reject) => {
  let stderr = '';
  const timeout = setTimeout(() => reject(new Error('chrome startup timed out')), 15000);
  chrome.stderr.on('data', chunk => {
    stderr += chunk;
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timeout); resolve(match[1]); }
  });
  chrome.once('error', reject);
});
const ws = new WebSocket(browserWsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, {once: true});
  ws.addEventListener('error', reject, {once: true});
});
let nextId = 1;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const p = pending.get(message.id);
    pending.delete(message.id);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  }
});
const send = (method, params = {}, sessionId) => {
  const id = nextId++;
  ws.send(JSON.stringify({id, method, params, sessionId}));
  return new Promise((resolve, reject) => pending.set(id, {resolve, reject}));
};
try {
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  await send('Page.enable', {}, sessionId);
  const loaded = new Promise(resolve => {
    const handler = event => {
      if (event.sessionId === sessionId) {
        ws.removeEventListener('message', handler);
        resolve();
      }
    };
    ws.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.method === 'Page.loadEventFired') handler({sessionId: m.sessionId});
    });
  });
  await send('Page.navigate', {url: fixtureUrl}, sessionId);
  await loaded;
  const evaluated = await send('Runtime.evaluate', {
    expression: 'domBenchPromise',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
  console.log(JSON.stringify(evaluated.result.value, null, 2));
  await send('Target.closeTarget', {targetId});
} finally {
  ws.close();
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  chrome.kill('SIGTERM');
  await exited;
  await rm(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

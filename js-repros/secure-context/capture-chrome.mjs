// Capture the Chrome oracle for secure-context gating.
//
// The origin matters more than usual here: 127.0.0.1 and localhost are
// *potentially trustworthy* and therefore secure contexts, so a loopback
// server cannot show what an insecure origin looks like. The capture binds to
// the host's LAN address and visits it by IP, which Chrome treats as insecure,
// and visits the same server over loopback for the secure case.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const probe = await readFile(join(fixtureDir, 'probe.js'), 'utf8');
const chromeBin = process.env.CHROME_BIN || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome'
);

const lanAddress = process.env.LAN_IP || Object.values(networkInterfaces())
  .flat()
  .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
  .map(entry => entry.address)[0];
if (!lanAddress) throw new Error('no non-loopback IPv4 address; set LAN_IP=');

const server = createServer((request, response) => {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end(`<!doctype html><meta charset="utf-8"><body><script>${probe}</script>`);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;

const profileDir = await mkdtemp(join(tmpdir(), 'obscura-chrome-sc-'));
const chrome = spawn(chromeBin, [
  '--headless=new', '--disable-extensions', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});

const browserWsUrl = await new Promise((resolve, reject) => {
  let buffered = '';
  const timeout = setTimeout(() => reject(new Error('devtools never came up')), 20000);
  chrome.stderr.on('data', chunk => {
    buffered += chunk;
    const match = buffered.match(/ws:\/\/[^\s]+/);
    if (match) { clearTimeout(timeout); resolve(match[0]); }
  });
});

const {WebSocket} = await import('node:ws').catch(() => ({WebSocket: globalThis.WebSocket}));
let nextId = 0;
const pending = new Map();
const socket = new WebSocket(browserWsUrl);
await new Promise(resolve => socket.addEventListener('open', resolve));
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params, sessionId) => new Promise(resolve => {
  const id = ++nextId;
  pending.set(id, message => resolve(message.result ?? message.error));
  socket.send(JSON.stringify({id, method, params, sessionId}));
});

async function capture(url) {
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', {url}, sessionId);
  await new Promise(resolve => setTimeout(resolve, 1500));
  const evaluated = await send('Runtime.evaluate', {
    expression: 'secureContextFixturePromise', awaitPromise: true, returnByValue: true,
  }, sessionId);
  await send('Target.closeTarget', {targetId});
  return evaluated.result?.value ?? {error: JSON.stringify(evaluated)};
}

try {
  const result = {
    insecureHttpByIp: await capture(`http://${lanAddress}:${port}/`),
    secureHttpLoopbackIp: await capture(`http://127.0.0.1:${port}/`),
    secureHttpLocalhost: await capture(`http://localhost:${port}/`),
  };
  // Ports and the host's LAN address vary per run and per machine.
  const text = JSON.stringify(result, null, 2)
    .replace(new RegExp(lanAddress.replace(/\./g, '\\.'), 'g'), '<lan>')
    .replace(new RegExp(`:${port}`, 'g'), ':<port>');
  console.log(text);
} finally {
  socket.close();
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  chrome.kill('SIGTERM');
  await exited;
  await new Promise(resolve => server.close(resolve));
  await rm(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

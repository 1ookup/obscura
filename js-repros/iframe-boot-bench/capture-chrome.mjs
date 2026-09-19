// Chrome oracle capture for the iframe boot cost fixture: same page, same
// reads, driven over CDP against a headless Chrome with the same viewport
// and a warm-only single run.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const chromeBin = process.env.CHROME_BIN || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome'
);
const chromePort = Number(process.env.CHROME_PORT || 9333);

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

const chrome = spawn(chromeBin, [
  '--headless=new', `--remote-debugging-port=${chromePort}`,
  '--no-first-run', '--no-default-browser-check', '--user-data-dir=/tmp/iframe-boot-chrome',
  'about:blank',
], { stdio: 'ignore' });

const version = await (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve) => { ws.on('open', resolve); });

let nextId = 1;
const pending = new Map();
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
const nav = await send('Page.navigate', { url: fixtureUrl });
await new Promise((resolve) => {
  const onMsg = (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Page.loadEventFired') { ws.off('message', onMsg); resolve(); }
  };
  ws.on('message', onMsg);
});
const evalResult = await send('Runtime.evaluate', {
  expression: `document.getElementById('r') ? document.getElementById('r').textContent : 'NO-RESULT'`,
  returnByValue: true,
});
console.log(evalResult.result?.result?.value ?? 'no result');

ws.close();
chrome.kill();
server.close();

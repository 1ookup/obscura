// The fixture's HTTP server, shared by the Chrome capture and the Obscura run.
//
// Every check here is decided by the *response*: a 3xx with a Location, a 3xx
// without one, a chain long enough to hit the hop limit. A static file server
// cannot answer any of them, so both sides import this file and cannot drift.
//
// Run directly to serve the fixture on a fixed port for a manual Obscura run:
//   node js-repros/fetch-redirect-modes/serve.mjs 8741
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const TEXT = 'text/plain; charset=utf-8';

// [status, headers, body]. Anything not listed 404s.
const ROUTES = {
  '/target.txt': [200, {'content-type': TEXT, 'x-final': 'yes'}, 'final body'],
  '/redirect-once': [302, {location: '/target.txt', 'x-hop': '1'}, ''],
  '/redirect-301': [301, {location: '/target.txt'}, ''],
  '/redirect-303': [303, {location: '/target.txt'}, ''],
  '/redirect-307': [307, {location: '/target.txt'}, ''],
  '/redirect-308': [308, {location: '/target.txt'}, ''],
  // A 3xx with no Location is not a redirect at all -- it is an ordinary
  // response that happens to carry a 3xx status.
  '/redirect-no-location': [302, {'content-type': TEXT}, 'no location here'],
  '/redirect-to-404': [302, {location: '/definitely-missing'}, ''],
  // Two hops, so `manual` can be checked against the *first* hop rather than
  // the last: manual never takes any hop, so it must report /redirect-twice.
  '/redirect-twice': [302, {location: '/redirect-once'}, ''],
  // A redirect body is normally discarded. Chrome is asked here whether
  // `manual` surfaces it.
  '/redirect-with-body': [302, {location: '/target.txt', 'content-type': TEXT}, 'redirect body'],
};

export async function createFixtureServer() {
  const probe = await readFile(join(fixtureDir, 'probe.js'), 'utf8');
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({url: request.url, method: request.method, headers: request.headers});
    if (request.url === '/' || request.url.startsWith('/index.html')) {
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      response.end(`<!doctype html><meta charset="utf-8"><body><script>${probe}</script>`);
      return;
    }
    const route = ROUTES[request.url];
    if (route) {
      response.writeHead(route[0], route[1]);
      response.end(route[2]);
      return;
    }
    response.writeHead(404, {'content-type': TEXT});
    response.end('not found');
  });
  // `seen` records what the server was actually asked for. `manual` and
  // `error` must never produce a request for the redirect *target*; an engine
  // that follows the hop anyway is visible in the access log with no
  // client-side check involved.
  server.requestsSeen = seen;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 8741);
  const server = await createFixtureServer();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  process.stderr.write(`fixture on http://127.0.0.1:${port}/\n`);
}

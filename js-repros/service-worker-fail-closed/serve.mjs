// The fixture's HTTP server, shared by the Chrome capture and the Obscura run.
//
// A plain static file server is not enough here: half the checks this fixture
// pins are decided by the *response* to the script fetch -- status code, MIME
// type, redirect, Service-Worker-Allowed -- so the routes have to be able to
// answer with a 500, a 302 and a missing Content-Type on demand. Both sides
// import this file so the two runs cannot drift apart.
//
// Run directly to serve the fixture on a fixed port for a manual Obscura run:
//   node js-repros/service-worker-fail-closed/serve.mjs 8731
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const JS = 'text/javascript';

// [status, headers]. Anything not listed 404s, including
// /definitely-missing-sw.js, which the probe uses for the 404 path.
const ROUTES = {
  '/sw-ok.js': [200, {'content-type': JS}],
  '/nested/sw-ok.js': [200, {'content-type': JS}],
  '/sw-500.js': [500, {'content-type': JS}],
  '/sw-redirect.js': [302, {location: '/sw-ok.js'}],
  '/sw-redirect-404.js': [302, {location: '/definitely-missing-sw.js'}],
  '/sw-bad-mime.js': [200, {'content-type': 'application/json'}],
  '/sw-no-mime.js': [200, {}],
  '/sw-mime-params.js': [200, {'content-type': 'text/javascript; charset=utf-8'}],
  '/nested/sw-allowed.js': [200, {'content-type': JS, 'service-worker-allowed': '/'}],
  '/nested/sw-allowed-narrow.js':
    [200, {'content-type': JS, 'service-worker-allowed': '/nested/deep/'}],
};

export async function createFixtureServer() {
  const probe = await readFile(join(fixtureDir, 'probe.js'), 'utf8');
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({url: request.url, headers: request.headers});
    if (request.url === '/' || request.url.startsWith('/index.html')) {
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      response.end(`<!doctype html><meta charset="utf-8"><body><script>${probe}</script>`);
      return;
    }
    const route = ROUTES[request.url];
    if (route) {
      response.writeHead(route[0], route[1]);
      response.end(route[0] === 302 ? '' : '// service worker\n');
      return;
    }
    response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
    response.end('not found');
  });
  // `seen` records what the server was actually asked for. Chrome fetches
  // every script it is asked to register; an engine that skips the fetch is
  // visible here without any page-side check at all.
  server.requestsSeen = seen;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 8731);
  const server = await createFixtureServer();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  process.stderr.write(`fixture on http://127.0.0.1:${port}/\n`);
}

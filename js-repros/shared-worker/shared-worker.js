// SharedWorker script for the fixture. Counts connections so the page can
// prove that two constructions with the same (url, name) reach one worker and
// that a different name reaches a different one.
let connections = 0;

self.onconnect = event => {
  connections += 1;
  const port = event.ports[0];
  port.onmessage = message => {
    port.postMessage({
      echo: message.data,
      connections,
      workerName: self.name,
      scopeTag: Object.prototype.toString.call(self),
      hasWindow: typeof window !== 'undefined',
      hasDocument: typeof document !== 'undefined',
      // A SharedWorkerGlobalScope has no `postMessage` of its own; messages
      // only travel over ports.
      selfPostMessage: typeof self.postMessage,
      connectEventTag: event.connectEventTag,
    });
  };
  // Explicit start is redundant after assigning onmessage, but a worker that
  // only ever calls addEventListener needs it, and calling it twice is legal.
  port.start();
};

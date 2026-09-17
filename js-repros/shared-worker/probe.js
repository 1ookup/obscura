// SharedWorker: interface shape plus a real round trip over its port.
//
// Obscura shipped an empty stub whose `port.postMessage` was a no-op, so every
// message was silently dropped and no reply ever arrived. This probe checks
// both halves: the observable shape, and whether a message actually reaches a
// SharedWorkerGlobalScope and comes back.
globalThis.sharedWorkerFixturePromise = (async () => {
  const out = {};

  out.interfaceType = typeof globalThis.SharedWorker;
  if (typeof globalThis.SharedWorker !== 'function') {
    globalThis.sharedWorkerFixtureResult = out;
    return out;
  }

  // A reply, or a marker when nothing arrives. Ports never reject, so an
  // unanswered message has to be distinguished by timing out.
  const ask = (port, payload, timeoutMs = 3000) => new Promise(resolve => {
    const timer = setTimeout(() => resolve({timedOut: true}), timeoutMs);
    port.onmessage = event => {
      clearTimeout(timer);
      resolve({data: event.data});
    };
    port.postMessage(payload);
  });

  let first;
  try {
    first = new SharedWorker('/shared-worker.js', {name: 'alpha'});
  } catch (error) {
    out.constructionError = `${error.name}: ${error.message}`;
    globalThis.sharedWorkerFixtureResult = out;
    return out;
  }

  out.instanceTag = Object.prototype.toString.call(first);
  out.constructorName = first.constructor && first.constructor.name;
  out.isEventTarget = first instanceof EventTarget;
  out.portTag = Object.prototype.toString.call(first.port);
  out.portIsMessagePort = typeof MessagePort === 'function' &&
    first.port instanceof MessagePort;
  out.hasOnerror = 'onerror' in first;
  out.hasTerminate = typeof first.terminate;
  out.memberTypes = {};
  for (const key of ['postMessage', 'start', 'close', 'addEventListener']) {
    out.memberTypes[key] = typeof first.port[key];
  }

  // The round trip that the old stub could never complete.
  out.firstReply = await ask(first.port, 'ping-1');

  // Same url + name: the spec reuses the running worker, so the connection
  // counter increments while the worker's own state persists.
  const again = new SharedWorker('/shared-worker.js', {name: 'alpha'});
  out.sameNameReply = await ask(again.port, 'ping-2');
  out.distinctWrapper = again !== first;

  // A different name is a different worker, so its counter restarts at 1.
  const other = new SharedWorker('/shared-worker.js', {name: 'beta'});
  out.otherNameReply = await ask(other.port, 'ping-3');

  // addEventListener without start() must not deliver; after start() it must.
  const manual = new SharedWorker('/shared-worker.js', {name: 'gamma'});
  const manualDelivery = new Promise(resolve => {
    const timer = setTimeout(() => resolve('no-delivery-before-start'), 600);
    manual.port.addEventListener('message', () => {
      clearTimeout(timer);
      resolve('delivered');
    });
  });
  manual.port.postMessage('ping-4');
  out.beforeStart = await manualDelivery;
  const afterStart = new Promise(resolve => {
    const timer = setTimeout(() => resolve('still-nothing'), 2000);
    manual.port.addEventListener('message', () => {
      clearTimeout(timer);
      resolve('delivered');
    });
  });
  manual.port.start();
  manual.port.postMessage('ping-5');
  out.afterStart = await afterStart;

  const reject = thunk => {
    try {
      thunk();
      return 'constructed';
    } catch (error) {
      return {name: error.name, message: String(error.message).replace(
        /http:\/\/127\.0\.0\.1:\d+/g, '<origin>')};
    }
  };
  out.crossOrigin = reject(() => new SharedWorker('https://example.com/sw.js'));
  out.badUrl = reject(() => new SharedWorker('http://['));

  globalThis.sharedWorkerFixtureResult = out;
  return out;
})();

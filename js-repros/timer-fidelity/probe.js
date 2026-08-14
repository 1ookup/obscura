(function () {
  const started = performance.now();
  const events = [];
  const record = (kind, expected) => events.push({
    kind,
    expected,
    elapsed: Number((performance.now() - started).toFixed(3)),
  });

  queueMicrotask(() => record('microtask', 0));
  [0, 1, 50, 100, 250, 550, 1000].forEach(delay => {
    setTimeout(() => record('timeout', delay), delay);
  });

  let intervalTicks = 0;
  const intervalId = setInterval(() => {
    intervalTicks++;
    if (intervalTicks === 3) {
      clearInterval(intervalId);
      record('interval', 30);
    }
  }, 10);

  const chain = [];
  const chainStarted = performance.now();
  let chainCount = 0;
  const chainStep = () => {
    chainCount++;
    chain.push(Number((performance.now() - chainStarted).toFixed(3)));
    if (chainCount < 8) setTimeout(chainStep, 0);
  };
  setTimeout(chainStep, 0);

  globalThis.timerFixturePromise = new Promise(resolve => {
    setTimeout(() => {
      const result = {events, intervalTicks, chain};
      globalThis.timerFixtureResult = result;
      document.body.textContent = JSON.stringify(result);
      resolve(result);
    }, 1200);
  });
})();

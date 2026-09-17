globalThis.fingerprintFixturePromise = (async () => {
  const snapshot = async nav => ({
    userAgent: nav.userAgent,
    appVersion: nav.appVersion,
    platform: nav.platform,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    userAgentData: nav.userAgentData ? {
      low: nav.userAgentData.toJSON(),
      high: await nav.userAgentData.getHighEntropyValues([
        'architecture',
        'bitness',
        'fullVersionList',
        'model',
        'platformVersion',
        'uaFullVersion',
        'wow64',
      ]),
    } : null,
  });

  const iframe = document.getElementById('same-origin');
  if (!iframe.contentWindow || !iframe.contentWindow.document.body) {
    await new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }));
  }

  const workerResult = await new Promise((resolve, reject) => {
    const source = `postMessage({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      userAgentData: navigator.userAgentData ? navigator.userAgentData.toJSON() : null
    })`;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.onerror = event => reject(new Error(event.message));
  });

  const main = await snapshot(navigator);
  const child = await snapshot(iframe.contentWindow.navigator);
  return {
    main,
    childMatchesMain: JSON.stringify(child) === JSON.stringify(main),
    worker: workerResult,
    workerMatchesLowEntropy: JSON.stringify(workerResult) === JSON.stringify({
      userAgent: main.userAgent,
      platform: main.platform,
      hardwareConcurrency: main.hardwareConcurrency,
      deviceMemory: main.deviceMemory,
      userAgentData: main.userAgentData && main.userAgentData.low,
    }),
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      devicePixelRatio,
    },
    webglAvailable: document.createElement('canvas').getContext('webgl') !== null,
  };
})().then(result => {
  globalThis.fingerprintFixtureResult = result;
  document.body.appendChild(document.createElement('pre')).textContent = JSON.stringify(result);
  return result;
});

(function () {
  setTimeout(function () {
    try {
      var all = performance.getEntriesByType('resource').filter(function (x) {
        return /api\.js|orchestrate|challenge-platform/.test(x.name);
      });
      document.title = 'RES:' + JSON.stringify(all.slice(0, 4).map(function (x) {
        return { n: String(x.name).slice(-46), it: x.initiatorType, st: Math.round(x.startTime),
                 d: Math.round(x.duration), fs: Math.round(x.fetchStart), rq: Math.round(x.requestStart),
                 rs: Math.round(x.responseStart), re: Math.round(x.responseEnd),
                 ts: x.transferSize, es: x.encodedBodySize, ds: x.decodedBodySize };
      }));
    } catch (e) { document.title = 'RES-err:' + e.message; }
  }, 20000);
})();

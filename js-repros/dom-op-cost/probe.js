// DOM op and window-shim cost microbench, modelled on the Turnstile
// bootstrap VM program's probe scheduler: each "API touch" crosses the
// window/DOM surface the way the JSVMP interpreter does. Reports
// milliseconds for 10k iterations of each shape so per-op costs compare
// directly against the Chrome oracle.
globalThis.domBenchPromise = (async function () {
  const out = {};
  const t = (fn) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  const N = 10000;

  // Warmup so JIT tiers settle before timing.
  const warm = document.createElement('div');
  for (let i = 0; i < 2000; i++) {
    const el = document.createElement('span');
    el.setAttribute('data-x', String(i));
    warm.appendChild(el);
    warm.querySelector('span');
  }
  warm.textContent = '';

  out.createElementAppend10k = t(() => {
    const host = document.createElement('div');
    for (let i = 0; i < N; i++) {
      const el = document.createElement('span');
      host.appendChild(el);
    }
  });

  out.setAttribute10k = t(() => {
    const el = document.createElement('div');
    for (let i = 0; i < N; i++) {
      el.setAttribute('data-x', String(i));
    }
  });

  out.querySelector10k = t(() => {
    const host = document.createElement('div');
    for (let i = 0; i < 50; i++) {
      const c = document.createElement('span');
      c.className = 'c' + i;
      host.appendChild(c);
    }
    document.body.appendChild(host);
    for (let i = 0; i < N; i++) {
      host.querySelector('span.c' + (i % 50));
    }
    host.remove();
  });

  out.getAttribute10k = t(() => {
    const el = document.createElement('div');
    el.setAttribute('data-x', 'v');
    for (let i = 0; i < N; i++) {
      el.getAttribute('data-x');
    }
  });

  out.getBoundingClientRect10k = t(() => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    for (let i = 0; i < N; i++) {
      el.getBoundingClientRect();
    }
    el.remove();
  });

  out.windowShimGets10k = t(() => {
    for (let i = 0; i < N; i++) {
      void screen.width;
      void navigator.userAgent;
      void document.documentElement;
      void window.innerWidth;
      void window.devicePixelRatio;
    }
  });

  out.getElementById10k = t(() => {
    const el = document.createElement('div');
    el.id = 'bench-target';
    document.body.appendChild(el);
    for (let i = 0; i < N; i++) {
      document.getElementById('bench-target');
    }
    el.remove();
  });

  out.classListToggle10k = t(() => {
    const el = document.createElement('div');
    for (let i = 0; i < N; i++) {
      el.classList.toggle('active');
    }
  });

  out.createNodeIterator10k = t(() => {
    const host = document.createElement('div');
    for (let i = 0; i < N; i++) {
      document.createNodeIterator(host);
    }
  });

  globalThis.domBenchResult = out;
  const div = document.createElement('div');
  div.id = 'dom-bench-done';
  div.textContent = JSON.stringify(out);
  document.body.appendChild(div);
  return out;
})();

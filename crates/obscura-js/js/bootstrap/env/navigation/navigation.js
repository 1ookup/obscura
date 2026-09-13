// Navigation API. New framework routers increasingly prefer `navigation`
// over popstate/history. Keep it backed by the functional History API above
// so both surfaces agree about the current URL and state.
function registerNavigationSurface() {
  const listeners = Object.create(null);
  const nav = {
    [Symbol.toStringTag]: 'Navigation',
    addEventListener(type, callback) {
      if (typeof callback !== "function") return;
      (listeners[String(type)] ||= []).push(callback);
    },
    removeEventListener(type, callback) {
      const list = listeners[String(type)];
      if (!list) return;
      const index = list.indexOf(callback);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent(event) {
      if (!event || !event.type) return true;
      const list = (listeners[String(event.type)] || []).slice();
      for (const callback of list) {
        try { callback.call(nav, event); } catch (error) { console.error(error); }
      }
      return !event.defaultPrevented;
    },
  };
  let serial = 0;
  const makeEntry = () => {
    const key = "obscura-" + serial;
    const state = history.state;
    return {
      id: key,
      key,
      index: Math.max(0, history.length - 1),
      sameDocument: true,
      url: __currentUrl(),
      getState() { return state; },
      addEventListener() {},
      removeEventListener() {},
    };
  };
  let entry = makeEntry();
  const changed = (from) => {
    const old = from || entry;
    serial++;
    entry = makeEntry();
    try {
      const ev = new Event("currententrychange");
      ev.from = old;
      nav.dispatchEvent(ev);
    } catch {}
    return entry;
  };
  Object.defineProperties(nav, {
    currentEntry: { configurable: true, enumerable: true, get: () => entry },
    canGoBack: { configurable: true, enumerable: true, get: () => history.length > 1 },
    canGoForward: { configurable: true, enumerable: true, get: () => false },
    transition: { configurable: true, enumerable: true, get: () => null },
    activation: { configurable: true, enumerable: true, get: () => null },
  });
  nav.entries = () => [entry];
  nav.updateCurrentEntry = (options) => {
    const old = entry;
    const state = options && Object.prototype.hasOwnProperty.call(options, "state")
      ? options.state : history.state;
    history.replaceState(state, "", __currentUrl());
    return changed(old);
  };
  nav.navigate = (url, options) => {
    const old = entry;
    const state = options && Object.prototype.hasOwnProperty.call(options, "state")
      ? options.state : null;
    if (options && options.history === "replace") history.replaceState(state, "", url);
    else history.pushState(state, "", url);
    const next = changed(old);
    const done = Promise.resolve(next);
    return { committed: done, finished: done };
  };
  nav.reload = () => {
    const done = Promise.resolve(entry);
    return { committed: done, finished: done };
  };
  nav.traverseTo = () => {
    const done = Promise.resolve(entry);
    return { committed: done, finished: done };
  };
  nav.back = () => {
    history.back();
    const done = Promise.resolve(changed());
    return { committed: done, finished: done };
  };
  nav.forward = () => {
    history.forward();
    const done = Promise.resolve(changed());
    return { committed: done, finished: done };
  };
  globalThis.navigation = nav;
}

registerNavigationSurface();


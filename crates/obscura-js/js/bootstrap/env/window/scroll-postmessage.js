// Window-level scrolling (issue #468). #431 gave elements functional
// scrollTop/scrollLeft plus scroll methods, but left these three as no-ops, so
// the dominant infinite-scroll idiom -- window.scrollTo(0, body.scrollHeight),
// window.scrollBy(0, 500), then a window 'scroll' listener -- did nothing at
// all: the offset never moved and no event ever fired.
//
// The page offset is stored on the scrolling element rather than in separate
// window state, so window.scrollY and document.scrollingElement.scrollTop are
// two views of one value, which is what pages assume. Render builds clamp that
// shared root offset against measured document overflow; non-render builds keep
// the legacy synthetic offset used by automation-only consumers.
function _scrollRoot() {
  const doc = globalThis.document;
  return (doc && doc.scrollingElement) || null;
}
function _windowScroll(x, y, relative) {
  const root = _scrollRoot();
  if (!root) return;
  const beforeLeft = root.scrollLeft || 0;
  const beforeTop = root.scrollTop || 0;
  let left, top;
  if (x !== null && typeof x === 'object') { left = x.left; top = x.top; }
  else { left = x; top = y; }
  if (left !== undefined) {
    root.scrollLeft = (relative ? (root.scrollLeft || 0) : 0) + (+left || 0);
  }
  if (top !== undefined) {
    root.scrollTop = (relative ? (root.scrollTop || 0) : 0) + (+top || 0);
  }
  if ((root.scrollLeft || 0) === beforeLeft && (root.scrollTop || 0) === beforeTop) {
    return;
  }
  // Async, matching the element path #431 added. Dispatched at the document
  // AND the window: a page scroll event reaches both in Chrome, but
  // Document.dispatchEvent here runs only its own listeners and does not
  // propagate, so firing once would strand half the listeners.
  setTimeout(() => {
    try {
      const doc = globalThis.document;
      if (doc) doc.dispatchEvent(new Event('scroll', { bubbles: false }));
      globalThis.dispatchEvent(new Event('scroll', { bubbles: false }));
    } catch (e) {}
  }, 0);
}
_defineWindowValue('scrollTo', function(x, y) { _windowScroll(x, y, false); });
_defineWindowValue('scrollBy', function(x, y) { _windowScroll(x, y, true); });
_defineWindowValue('scroll', function(x, y) { _windowScroll(x, y, false); });
_markNative(globalThis.scrollTo);
_markNative(globalThis.scrollBy);
_markNative(globalThis.scroll);
// Read-only accessors, as on a real Window: assigning window.scrollY does not
// scroll the page. These replace the hard-coded 0 data properties defined
// earlier, so they must stay after them.
for (const [name, offset] of [
  ['scrollX', 'scrollLeft'], ['pageXOffset', 'scrollLeft'],
  ['scrollY', 'scrollTop'], ['pageYOffset', 'scrollTop'],
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    get() { const root = _scrollRoot(); return root ? (root[offset] || 0) : 0; },
  });
}
_defineWindowValue('focus', ({ focus() {} }).focus); _markNative(globalThis.focus);
_defineWindowValue('blur', ({ blur() {} }).blur); _markNative(globalThis.blur);
_defineWindowValue('print', function() {}); _markNative(globalThis.print);
_defineWindowValue('alert', function() {}); _markNative(globalThis.alert);
_defineWindowValue('confirm', function() { return true; }); _markNative(globalThis.confirm);
_defineWindowValue('prompt', function() { return null; }); _markNative(globalThis.prompt);
_defineWindowValue('open', function() { return null; }); _markNative(globalThis.open);
_defineWindowValue('close', ({ close() {} }).close); _markNative(globalThis.close);
_defineWindowValue('stop', function() {}); _markNative(globalThis.stop);
// Window.postMessage aimed at one's own window. HTML treats it as an ordinary
// cross-document message that happens to have the same source and destination:
// a queued task fires a trusted `message` event carrying the sender's own
// origin and WindowProxy. Scripts use it as a same-realm mailbox -- post work
// to yourself, pick it up in the shared `message` listener that also serves
// the iframes -- and the previous no-op stub swallowed those posts, so the
// listener never ran and the script sat waiting on a reply it had sent itself.
// The frame-to-frame directions already work; only self-delivery was missing.
globalThis.postMessage = ({ postMessage(message, targetOrigin) {
  const to = _normalizeTargetOrigin(targetOrigin);
  const selfOrigin = (globalThis.location && globalThis.location.origin) || "";
  if (to !== "*" && to !== "/") {
    // Compare serialized origins, so a targetOrigin carrying a path ("/x") or
    // a trailing slash still matches. An opaque origin serializes to "null"
    // and matches no parsed URL, which is the drop the spec asks for.
    let wanted = to;
    try { wanted = new URL(to).origin; } catch (e) {}
    if (wanted !== selfOrigin) return;
  }
  // Serialize during the call, not in the task: a DataCloneError has to reach
  // the caller, and a later mutation of `message` must not change what the
  // listener eventually sees.
  const data = globalThis.structuredClone(message);
  _scheduleAfter(0, () => {
    const evt = globalThis.__obscura_markTrusted(new MessageEvent("message", {
      data, origin: selfOrigin, source: globalThis.window || globalThis,
    }));
    try { globalThis.dispatchEvent(evt); } catch (e) {}
    // `onmessage` is not routed through dispatchEvent for the Window, so the
    // handler slot is invoked here the same way the frame receive loop does,
    // under the assigning code's snapshot label.
    if (typeof globalThis.onmessage === "function") {
      try {
        _withLegacyWindowEvent(evt, () => __obscuraTraceCallWith(
          __obscuraTraceHandlerFrom(globalThis, 'onmessage'),
          globalThis.onmessage, globalThis, [evt]));
      } catch (e) {}
    }
  });
} }).postMessage;
Object.defineProperty(globalThis.postMessage, 'length', { value: 1, configurable: true });
_markNative(globalThis.postMessage);
globalThis.requestIdleCallback = globalThis.requestIdleCallback || function(cb) { return setTimeout(cb, 0); };
globalThis.cancelIdleCallback = globalThis.cancelIdleCallback || function(id) { clearTimeout(id); };

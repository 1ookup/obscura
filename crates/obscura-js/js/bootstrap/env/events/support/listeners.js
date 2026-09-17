// EventTarget listener registry. DOM dispatch itself remains in
// env/events/event-target.js; this support module owns the wrapper-local state
// and add/remove semantics shared by Window, Node, MessagePort and XHR.
const _eventTargetListeners = new WeakMap();
function _eventCapture(options) {
  return typeof options === 'boolean' ? options : !!(options && options.capture);
}
function _eventTargetAdd(target, type, callback, options) {
  if (callback == null) return;
  const isFunction = typeof callback === 'function';
  if (!isFunction && typeof callback.handleEvent !== 'function') return;
  type = String(type);
  const capture = _eventCapture(options);
  const signal = options && typeof options === 'object' ? options.signal : null;
  if (signal && signal.aborted) return;
  let byType = _eventTargetListeners.get(target);
  if (!byType) {
    byType = new Map();
    _eventTargetListeners.set(target, byType);
  }
  let listeners = byType.get(type);
  if (!listeners) {
    listeners = [];
    byType.set(type, listeners);
  }
  if (listeners.some(entry => entry.callback === callback && entry.capture === capture)) return;
  const entry = {
    callback,
    capture,
    once: !!(options && typeof options === 'object' && options.once),
    passive: !!(options && typeof options === 'object' && options.passive),
    signal,
    abortHandler: null,
    // Execution-source snapshot at registration: the listener is attributed
    // to the code that registered it, not to whichever turn dispatched.
    // Null unless source tracing is on, so dispatch's fast path is unchanged.
    from: globalThis.__obscura_trace_from_enabled ? __obscuraTraceCurrent() : null,
  };
  listeners.push(entry);
  if (signal && typeof signal.addEventListener === 'function') {
    entry.abortHandler = () => _eventTargetRemove(target, type, callback, capture);
    signal.addEventListener('abort', entry.abortHandler, { once: true });
  }
}
function _eventTargetRemove(target, type, callback, options) {
  const byType = _eventTargetListeners.get(target);
  if (!byType) return;
  type = String(type);
  const listeners = byType.get(type);
  if (!listeners) return;
  const capture = _eventCapture(options);
  for (let i = 0; i < listeners.length; i++) {
    const entry = listeners[i];
    if (entry.callback !== callback || entry.capture !== capture) continue;
    listeners.splice(i, 1);
    if (entry.signal && entry.abortHandler
        && typeof entry.signal.removeEventListener === 'function') {
      entry.signal.removeEventListener('abort', entry.abortHandler);
    }
    break;
  }
  if (listeners.length === 0) byType.delete(type);
  if (byType.size === 0) _eventTargetListeners.delete(target);
}

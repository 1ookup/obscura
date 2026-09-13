// Listener registry and add/remove behavior live in support/listeners.js.
// Worker scopes strip the whole Window-only DOM surface, so these interfaces
// are unresolvable bindings there rather than merely unmatched. Dispatch runs
// in a worker for every EventTarget that does exist in one -- MessagePort,
// WebSocket, XMLHttpRequest -- so each check is guarded rather than assumed.
function _isDomInstance(value, name) {
  const ctor = globalThis[name];
  if (typeof ctor !== 'function' || !(value instanceof ctor)) return false;
  // Only backed DOM nodes participate in parent/shadow retargeting. A Node
  // prototype or a page-created object inheriting it has no tree position.
  if (name === 'Node') return value[_nidSym] !== undefined;
  return true;
}
function _eventParent(target, composed) {
  if (_isDomInstance(target, 'ShadowRoot')) return composed ? target.host : null;
  if (_isDomInstance(target, 'Document')) return target.defaultView || null;
  return _isDomInstance(target, 'Node') ? target.parentNode : null;
}
function _eventPathFor(target, composed) {
  const path = [];
  let adjustedTarget = target;
  let current = target;
  let hostAtTarget = false;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    path.push({ invocationTarget: current, adjustedTarget, hostAtTarget });
    hostAtTarget = false;
    if (_isDomInstance(current, 'ShadowRoot')) {
      adjustedTarget = current.host;
      // A composed event crosses a shadow boundary through the host as if the
      // host were an AT_TARGET tuple. This remains observable when bubbles is
      // false and makes both capture and bubble listeners run at phase 2.
      hostAtTarget = true;
    }
    current = _eventParent(current, composed);
  }
  return path;
}
function _eventRootIsShadow(node) {
  return _isDomInstance(node, 'Node') && _isDomInstance(node.getRootNode(), 'ShadowRoot');
}
function _eventRetarget(candidate, against) {
  while (_isDomInstance(candidate, 'Node')) {
    const root = candidate.getRootNode();
    if (!_isDomInstance(root, 'ShadowRoot')) return candidate;
    if (_isDomInstance(against, 'Node') && against.getRootNode() === root) return candidate;
    candidate = root.host;
  }
  return candidate;
}
function _eventInvoke(target, event, capture, atTarget, pathIndex) {
  const state = _eventData(event);
  state.target = state.path[pathIndex].adjustedTarget;
  if (state.originalRelatedTarget !== undefined) {
    _mouseEventSetRelatedTarget(event, _eventRetarget(state.originalRelatedTarget, target));
    // Mouse/pointer boundary events do not cross a scope where target and
    // relatedTarget retarget to the same object (e.g. an internal node moving
    // to its closed-shadow host). Such a tuple is absent from the DOM path.
    if (event.relatedTarget === event.target) return;
  }
  state.currentTarget = target;
  state.eventPhase = atTarget ? 2 : (capture ? 1 : 3);
  state.pathCurrentIndex = pathIndex;

  // Content/IDL handlers run in the bubbling half at the target or on an
  // ancestor. Keep the existing ordering (inline before addEventListener)
  // while the listener registry is moved onto the shared dispatcher.
  if (!capture && _isDomInstance(target, 'Element')) {
    const handlerName = 'on' + event.type;
    const inlineFn = target[handlerName] || target._resolveInlineHandler(handlerName);
    if (typeof inlineFn === 'function') {
      try {
        const ret = inlineFn.call(target, event);
        if (ret === false) event.preventDefault();
      } catch (error) { console.error(error); }
    }
  }

  const listeners = (_eventTargetListeners.get(target)?.get(String(event.type)) || []).slice();
  for (const entry of listeners) {
    if (entry.capture !== capture) continue;
    const current = _eventTargetListeners.get(target)?.get(String(event.type));
    if (!current || !current.includes(entry)) continue;
    if (entry.once) _eventTargetRemove(target, event.type, entry.callback, entry.capture);
    const callback = entry.callback;
    try {
      if (typeof callback === "function") callback.call(target, event);
      else callback.handleEvent.call(callback, event);
    } catch (error) {
      console.error(error);
    }
    if (state.immediatePropagationStopped) break;
  }
}
function _eventTargetDispatchNow(target, event) {
  if (!event || typeof event.type === "undefined") {
    throw new TypeError("Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.");
  }
  if (String(event.type) === "") {
    throw new DOMException("The event's type was not specified.", "InvalidStateError");
  }
  const state = _eventData(event);
  if (state.dispatching) {
    throw new DOMException("The event is already being dispatched.", "InvalidStateError");
  }
  state.dispatching = true;
  state.propagationStopped = false;
  state.immediatePropagationStopped = false;
  state.path = _eventPathFor(target, event.composed);
  state.pathCurrentIndex = -1;
  state.originalRelatedTarget = 'relatedTarget' in event
    ? event.relatedTarget : undefined;
  // DOM dispatch clears endpoints after dispatch when the last reachable
  // tuple would otherwise expose a node from a shadow tree. This also covers
  // a boundary event whose target and relatedTarget collapse to one host:
  // its outer tuples are suppressed and neither internal endpoint survives.
  const lastTuple = state.path[state.path.length - 1];
  const lastRelatedTarget = state.originalRelatedTarget === undefined
    ? null : _eventRetarget(state.originalRelatedTarget, lastTuple.invocationTarget);
  const clearTargets = _eventRootIsShadow(lastTuple.adjustedTarget)
    || _eventRootIsShadow(lastRelatedTarget)
    || (state.originalRelatedTarget !== undefined
        && lastTuple.adjustedTarget === lastRelatedTarget);

  const path = state.path;
  for (let i = path.length - 1; i > 0; i--) {
    _eventInvoke(path[i].invocationTarget, event, true, path[i].hostAtTarget, i);
    if (state.propagationStopped) break;
  }
  if (!state.propagationStopped) {
    _eventInvoke(target, event, true, true, 0);
    if (!state.immediatePropagationStopped) {
      _eventInvoke(target, event, false, true, 0);
    }
  }
  if (!state.propagationStopped) {
    for (let i = 1; i < path.length; i++) {
      if (path[i].hostAtTarget) {
        _eventInvoke(path[i].invocationTarget, event, false, true, i);
      } else if (event.bubbles) {
        _eventInvoke(path[i].invocationTarget, event, false, false, i);
      }
      if (state.propagationStopped) break;
    }
  }

  // The event path is observable only while dispatch is in progress. Preserve
  // the target from the last invoked tuple, but clear currentTarget/path just
  // as the DOM dispatch algorithm does.
  if (clearTargets) {
    state.target = null;
    if (state.originalRelatedTarget !== undefined) _mouseEventSetRelatedTarget(event, null);
  } else {
    // Cleanup uses the outermost shadow-adjusted endpoints even when
    // propagation stopped before that tuple's listeners were invoked.
    state.target = lastTuple.adjustedTarget;
    if (state.originalRelatedTarget !== undefined) {
      _mouseEventSetRelatedTarget(event, lastRelatedTarget);
    }
  }
  state.currentTarget = null;
  state.eventPhase = 0;
  state.pathCurrentIndex = -1;
  state.path = null;
  state.originalRelatedTarget = undefined;
  state.dispatching = false;
  // Event Timing: discrete trusted input feeds the performance timeline as
  // Chrome does, so an observer of type 'event' sees interactions.
  if (typeof globalThis.__obscura_queue_event_timing === 'function') {
    try { globalThis.__obscura_queue_event_timing(event); } catch (_timingError) {}
  }
  return !event.defaultPrevented;
}

// Window.event is a legacy accessor: it is undefined in an idle realm, but
// points at the event currently being dispatched while an author handler runs.
// Keep the value per realm and restore nested dispatches on unwind.
let _legacyWindowEvent;
let _legacyStickyWindowEvent;
function _legacyEventStickyEligible() {
  // Window.event is exposed by every browsing-context global. Keep the first
  // trusted browser-dispatched event available to the asynchronous challenge
  // sampler in both the top and iframe realms; author-created events remain
  // transient and never populate this slot.
  return typeof globalThis.document !== 'undefined';
}
function _withLegacyWindowEvent(event, callback) {
  const previous = _legacyWindowEvent;
  _legacyWindowEvent = event;
  try { return callback(); } finally { _legacyWindowEvent = previous; }
}
function _eventTargetDispatch(target, event) {
  const previous = _legacyWindowEvent;
  _legacyWindowEvent = event;
  try {
    return _eventTargetDispatchNow(target, event);
  } finally {
    if (_legacyEventStickyEligible() && !_legacyStickyWindowEvent
        && _trustedEvents.has(event)) {
      _legacyStickyWindowEvent = event;
    }
    _legacyWindowEvent = previous;
  }
}

// Per the UI Events spec, only events the user agent dispatches (real or
// automation-synthesized input) are trusted; events page script builds with
// `new Event(...)` must report isTrusted === false (issue #303). Returning true
// for everything is a trivial bot-detection tell. Trusted events are tracked in
// a closure-private WeakSet so page JS can neither read nor forge the flag.
// obscura's CDP input pipeline marks its synthetic events via the
// non-enumerable __obscura_markTrusted helper.
const _eventInternalStateRegistrySym = Symbol.for('obscura.eventStateRegistry');
const _eventInternalStateRegistry = Deno[_eventInternalStateRegistrySym]
  || (Deno[_eventInternalStateRegistrySym] = {
  trusted: new WeakSet(), sourceCapabilities: new WeakMap(),
  events: new WeakMap(), uiEvents: new WeakMap(),
  mouseEvents: new WeakMap(), pointerEvents: new WeakMap(),
});
const _trustedEvents = _eventInternalStateRegistry.trusted;
// Device input (mouse, keyboard) additionally reports the capabilities of the
// device it came from through Event.sourceCapabilities; script-built events
// report null. Same WeakMap discipline as isTrusted: page JS can neither read
// nor forge the association.
const _eventSourceCapabilities = _eventInternalStateRegistry.sourceCapabilities;
let _mouseInputCaps = null;
globalThis.__obscura_markTrusted = function(ev) {
  try {
    if (ev) {
      _trustedEvents.add(ev);
      // MouseEvent covers PointerEvent/WheelEvent; MessageEvent and bare
      // Event stay out, matching Chrome where e.g. a synthetic element.click()
      // activation has sourceCapabilities === null.
      if (ev instanceof MouseEvent || ev instanceof KeyboardEvent || ev instanceof InputEvent) {
        if (!_mouseInputCaps) _mouseInputCaps = new InputDeviceCapabilities({ firesTouchEvents: false });
        _eventSourceCapabilities.set(ev, _mouseInputCaps);
      }
    }
  } catch (_e) {}
  return ev;
};
// Chrome assigns a fresh pointerId per pointer activation (each press cycle)
// and reuses it for the matching up/move/hover events; a constant 1 on every
// event is a fingerprint. `acquire` starts a new activation sequence; without
// it the current id is reused, and the very first call mints id 1.
let _pointerIdSeq = 0;
let _pointerNeedsNewActivation = true;
let _pointerEverPressed = false;
globalThis.__obscura_pointer_id = function(acquire) {
  if (_pointerIdSeq === 0) _pointerIdSeq = 1;
  // A hover can mint the first id before the corresponding press arrives.
  // Keep that id for the first activation; after a release, the next press
  // gets a fresh id as Chrome does.
  if (acquire) {
    if (_pointerNeedsNewActivation && _pointerEverPressed) _pointerIdSeq++;
    _pointerNeedsNewActivation = false;
    _pointerEverPressed = true;
  }
  return _pointerIdSeq;
};
globalThis.__obscura_pointer_release = function() {
  _pointerNeedsNewActivation = true;
};

// Write value/checked through the element's *prototype* accessor, skipping any
// per-instance property a framework layered on top. React (and Preact/Vue)
// install a value tracker by redefining `value`/`checked` on the element to
// record the last value they wrote; a plain `el.value = x` runs that wrapper,
// so their tracker updates in lockstep and the next input/change event looks
// unchanged, so onChange never fires (issue #324). Writing through the
// prototype setter leaves the tracker stale, so the edit is seen as a real
// user change. When no framework wrapper is present this is identical to a
// direct assignment.
globalThis.__obscura_setFieldValue = function(el, field, value) {
  try {
    let proto = Object.getPrototypeOf(el);
    let desc;
    while (proto && !((desc = Object.getOwnPropertyDescriptor(proto, field)) && desc.set)) {
      proto = Object.getPrototypeOf(proto);
    }
    if (desc && desc.set) { desc.set.call(el, value); return; }
  } catch (_e) {}
  el[field] = value;
};

// Build a FileList-like object: an array with the DOM's `item(i)` accessor.
function _makeFileList(files) {
  const list = files.slice();
  Object.defineProperty(list, "item", { value: (i) => list[i] || null, enumerable: false });
  return list;
}
function _emptyFileList() { return _makeFileList([]); }

// Populate an <input type=file>'s FileList from the CDP DOM.setFileInputFiles
// call (Puppeteer uploadFile / Playwright setInputFiles). `specs` is an array of
// { name, type, b64 } where b64 is the base64-encoded file bytes read on the
// Rust side. Real File objects (backed by the bytes) are created so page code can
// read them via FileReader or upload them via fetch/FormData, then input+change
// fire as a genuine selection would (issue #359).
globalThis.__obscura_setInputFiles = function(el, specs) {
  const files = (specs || []).map((s) => {
    let bytes;
    try {
      const bin = atob(s.b64 || "");
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_e) { bytes = new Uint8Array(0); }
    return new File([bytes], s.name || "", { type: s.type || "" });
  });
  el._files = _makeFileList(files);
  // Mark the events trusted (isTrusted === true), like the Input domain does
  // for synthesized clicks/keys. A real <input type=file> selection fires
  // trusted events; upload flows that gate their change handler on
  // event.isTrusted (common in frameworks and anti-bot code) ignore untrusted
  // ones, which would silently break the exact case this feature targets.
  try { el.dispatchEvent(globalThis.__obscura_markTrusted(new Event("input", { bubbles: true }))); } catch (_e) {}
  try { el.dispatchEvent(globalThis.__obscura_markTrusted(new Event("change", { bubbles: true }))); } catch (_e) {}
};

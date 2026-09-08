// Host input and upload helpers.  These functions are the behavior side of
// the event objects; constructors and prototypes live in env/events/*.js.
// They are intentionally global because Rust's CDP input and DOM upload ops
// invoke them by name after bootstrap has been evaluated.
let _mouseInputCaps = null;

globalThis.__obscura_markTrusted = function(ev) {
  try {
    if (ev) {
      _trustedEvents.add(ev);
      // MouseEvent covers PointerEvent/WheelEvent. MessageEvent and bare Event
      // intentionally keep sourceCapabilities === null.
      if (ev instanceof MouseEvent || ev instanceof KeyboardEvent || ev instanceof InputEvent) {
        if (!_mouseInputCaps) {
          _mouseInputCaps = new InputDeviceCapabilities({ firesTouchEvents: false });
        }
        _eventSourceCapabilities.set(ev, _mouseInputCaps);
      }
    }
  } catch (_error) {}
  return ev;
};

let _pointerIdSeq = 0;
let _pointerNeedsNewActivation = true;
let _pointerEverPressed = false;
globalThis.__obscura_pointer_id = function(acquire) {
  if (_pointerIdSeq === 0) _pointerIdSeq = 1;
  // A hover may mint the first id before its press. Reuse that id for the
  // first activation, then allocate a new one after every release.
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

// Frameworks install per-instance value trackers on form controls. Writing
// through the native prototype setter leaves those trackers stale, matching a
// real user edit and allowing the next input/change event to be observed.
globalThis.__obscura_setFieldValue = function(el, field, value) {
  try {
    let proto = Object.getPrototypeOf(el);
    let desc;
    while (proto && !((desc = Object.getOwnPropertyDescriptor(proto, field)) && desc.set)) {
      proto = Object.getPrototypeOf(proto);
    }
    if (desc && desc.set) { desc.set.call(el, value); return; }
  } catch (_error) {}
  el[field] = value;
};

function _makeFileList(files) {
  const list = files.slice();
  Object.defineProperty(list, 'item', {
    value: (index) => list[index] || null,
    enumerable: false,
  });
  return list;
}
function _emptyFileList() { return _makeFileList([]); }

globalThis.__obscura_setInputFiles = function(el, specs) {
  const files = (specs || []).map((spec) => {
    let bytes;
    try {
      const binary = atob(spec.b64 || '');
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch (_error) { bytes = new Uint8Array(0); }
    return new File([bytes], spec.name || '', { type: spec.type || '' });
  });
  el._files = _makeFileList(files);
  try {
    el.dispatchEvent(globalThis.__obscura_markTrusted(new Event('input', { bubbles: true })));
  } catch (_error) {}
  try {
    el.dispatchEvent(globalThis.__obscura_markTrusted(new Event('change', { bubbles: true })));
  } catch (_error) {}
};

// Host input and upload helpers.  These functions are the behavior side of
// the event objects; constructors and prototypes live in env/events/*.js.
// They are intentionally global because Rust's CDP input and DOM upload ops
// invoke them by name after bootstrap has been evaluated.
let _mouseInputCaps = null;

// Real browsers keep event screen coordinates in the desktop frame:
// screenX - clientX === window.screenLeft for every event. The window
// position is fingerprinted (non-zero on purpose), so every synthesized
// event has to add it or the pair becomes a tell.
globalThis.__obscura_window_origin_x = function () {
  return Number(globalThis.screenX) || 0;
};
globalThis.__obscura_window_origin_y = function () {
  return Number(globalThis.screenY) || 0;
};

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
      // Sticky/transient user activation: a trusted activation event makes
      // navigator.userActivation report hasBeenActive forever and isActive
      // for the transient window, the observable a real input pipeline
      // produces. Only this internal helper can set it; the global stays
      // hidden from page code.
      var activationType = String(ev.type);
      if (activationType === 'keydown' || activationType === 'mousedown'
          || activationType === 'pointerdown' || activationType === 'touchend'
          || activationType === 'click') {
        _userActivationEver = true;
        _userActivationAt = performance.now();
      }
    }
  } catch (_error) {}
  return ev;
};

// User-activation state fed by the trusted-input pipeline above.
let _userActivationEver = false;
let _userActivationAt = -Infinity;
const USER_ACTIVATION_TRANSIENT_MS = 5000;

class UserActivation {
  get hasBeenActive() { return _userActivationEver; }
  get isActive() {
    return _userActivationEver
      && Number.isFinite(_userActivationAt)
      && performance.now() - _userActivationAt < USER_ACTIVATION_TRANSIENT_MS;
  }
}
Object.defineProperty(UserActivation.prototype, Symbol.toStringTag, {
  value: 'UserActivation', configurable: true,
});
if (typeof Navigator !== 'undefined' && Navigator.prototype) {
  Object.defineProperty(Navigator.prototype, 'userActivation', {
    configurable: true, enumerable: true,
    get() { return new UserActivation(); },
  });
}

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

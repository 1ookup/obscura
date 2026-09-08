// Screen state is realm-local and intentionally hidden behind private symbols.
// The Screen/ScreenOrientation interface declarations stay in screen.js.
const _screenOrientationKey = Symbol('ScreenOrientation');
const _screenOrientationHandlers = new WeakMap();
const _screenSlots = Symbol('Screen slots');

function _screenOrientationInitialize(instance, key) {
  if (key !== _screenOrientationKey) throw new TypeError('Illegal constructor');
}
function _screenOrientationOnChange(instance) {
  return _screenOrientationHandlers.get(instance) || null;
}
function _screenOrientationSetOnChange(instance, value) {
  _screenOrientationHandlers.set(instance, typeof value === 'function' ? value : null);
}

function _screenInitialize(instance, w, h, availW, availH, availTop, availLeft) {
  instance[_screenSlots] = {
    w,
    h,
    availW: availW === undefined ? w : availW,
    availH: availH === undefined ? h - 40 : availH,
    availTop: availTop === undefined ? 0 : availTop,
    availLeft: availLeft === undefined ? 0 : availLeft,
    orientation: new ScreenOrientation(_screenOrientationKey),
    onchange: null,
  };
}
function _screenSlot(instance, name) { return instance[_screenSlots][name]; }
function _screenSetSlot(instance, name, value) { instance[_screenSlots][name] = value; }
function _screenOrientationFor(instance) { return _screenSlot(instance, 'orientation'); }
function _screenApplySize(w, h, emulated, availW, availH, availTop, availLeft) {
  const resolvedAvailW = Number.isFinite(availW) ? availW : w;
  const resolvedAvailH = Number.isFinite(availH) ? availH : (emulated ? h : h - 40);
  if (globalThis.screen instanceof Screen) {
    const slots = globalThis.screen[_screenSlots];
    slots.w = w;
    slots.h = h;
    slots.availW = resolvedAvailW;
    slots.availH = resolvedAvailH;
    slots.availTop = Number.isFinite(availTop) ? availTop : 0;
    slots.availLeft = Number.isFinite(availLeft) ? availLeft : 0;
  } else {
    globalThis.screen = new Screen(w, h, resolvedAvailW, resolvedAvailH, availTop, availLeft);
  }
}

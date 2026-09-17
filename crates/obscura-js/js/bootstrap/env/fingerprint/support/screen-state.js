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
  // The available area is the screen minus whatever sits along its edges (menu
  // bar, taskbar, dock), so it can never extend past the screen. An embedder
  // that supplies both an offset and a full-height available area contradicts
  // itself -- `availTop: 30, availHeight: 900, height: 900` describes a menu bar
  // overhanging the display -- and that contradiction is readable from a page.
  // The offset is honored and the extent shrinks, which is what a browser
  // reports.
  const top = Number.isFinite(availTop) ? Math.max(0, availTop) : 0;
  const left = Number.isFinite(availLeft) ? Math.max(0, availLeft) : 0;
  const resolvedAvailW = Math.min(Number.isFinite(availW) ? availW : w, Math.max(0, w - left));
  const resolvedAvailH = Math.min(
    Number.isFinite(availH) ? availH : (emulated ? h : h - 40),
    Math.max(0, h - top),
  );
  if (globalThis.screen instanceof Screen) {
    const slots = globalThis.screen[_screenSlots];
    slots.w = w;
    slots.h = h;
    slots.availW = resolvedAvailW;
    slots.availH = resolvedAvailH;
    slots.availTop = top;
    slots.availLeft = left;
  } else {
    globalThis.screen = new Screen(w, h, resolvedAvailW, resolvedAvailH, top, left);
  }
}
// page-init and older realm snippets use the original bridge name. Keep the
// alias while the Screen shape owns the new support-prefixed implementation.
function _applyScreenSize(...args) { return _screenApplySize(...args); }

// Resize observation is part of the rendering update, not a timer. Keep the
// last delivered size for each observed box and perform one coalesced geometry
// checkpoint after DOM/viewport work. This follows the browser lifecycle and,
// importantly, does not keep the event loop alive with speculative re-fires.
globalThis.__resizeObservers = [];
let _resizeRenderCheckpointPending = false;
let _resizeRenderCheckpointRunning = false;
let _resizeRenderCheckpointRerun = false;
function _registerResizeObserver(observer) {
  if (!globalThis.__resizeObservers.includes(observer)) {
    globalThis.__resizeObservers.push(observer);
  }
}
function _unregisterResizeObserver(observer) {
  const index = globalThis.__resizeObservers.indexOf(observer);
  if (index >= 0) globalThis.__resizeObservers.splice(index, 1);
}
function _scheduleResizeRenderCheckpoint() {
  if (!globalThis.__resizeObservers.length) return;
  if (_resizeRenderCheckpointRunning) {
    _resizeRenderCheckpointRerun = true;
    return;
  }
  if (_resizeRenderCheckpointPending) return;
  _resizeRenderCheckpointPending = true;
  _scheduleRenderingOpportunity();
}
function _runResizeRenderCheckpoint() {
  _resizeRenderCheckpointPending = false;
  _resizeRenderCheckpointRunning = true;
  let depth = 0;
  let skipped = false;
  // Depth strictly increases after each broadcast, so this is naturally
  // bounded by tree depth. Keep a hard ceiling for adversarial callbacks
  // that manufacture an ever-deeper subtree during one delivery cycle.
  for (let iteration = 0; iteration < 64; iteration++) {
    _resizeRenderCheckpointRerun = false;
    const observers = [...globalThis.__resizeObservers];
    const targets = [];
    const seenTargets = new Set();
    for (const observer of observers) {
      for (const target of observer._targets.keys()) {
        if (seenTargets.has(target)) continue;
        seenTargets.add(target);
        targets.push(target);
      }
    }
    const measurements = _roMeasurements(targets);
    let shallowest = Infinity;
    let active = false;
    skipped = false;
    // Gather every observer before invoking any callback. A callback from an
    // earlier observer must not change the geometry gathered for a later one.
    for (const observer of observers) {
      const gathered = observer._gather(measurements, depth);
      active = active || gathered.active;
      skipped = skipped || gathered.skipped;
      shallowest = Math.min(shallowest, gathered.shallowest);
    }
    if (!active) break;
    for (const observer of observers) observer._broadcast();
    depth = shallowest;
    if (!_resizeRenderCheckpointRerun) break;
    if (iteration === 63) skipped = true;
  }
  _resizeRenderCheckpointRunning = false;
  _resizeRenderCheckpointRerun = false;
  if (skipped) {
    // Match the standardized loop-limit signal without queuing another
    // internal task that could keep a pathological page permanently busy.
    try {
      globalThis.dispatchEvent(new ErrorEvent("error", {
        message: "ResizeObserver loop completed with undelivered notifications."
      }));
    } catch (_error) {}
  }
}
globalThis.__obscura_recompute_resizes = _scheduleResizeRenderCheckpoint;
function _roNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}
function _roPhysicalSize(inlineSize, blockSize, vertical) {
  return vertical
    ? new ResizeObserverSize(_roConstructionKey, blockSize, inlineSize)
    : new ResizeObserverSize(_roConstructionKey, inlineSize, blockSize);
}
function _roNodeDepth(target) {
  let depth = 1;
  let node = target;
  while (node && (node = node.parentNode || node.host || null)) depth++;
  return depth;
}
function _roMeasurement(target, suppliedGeometry, suppliedByBatch = false) {
  let geometry = suppliedGeometry ?? null;
  const hasRenderer = typeof Deno.core.ops.op_layout_geometry === "function";
  if (!suppliedByBatch && hasRenderer && target?.[_nidSym] != null) {
    try {
      const raw = Deno.core.ops.op_layout_geometry(String(target[_nidSym] | 0));
      geometry = raw ? JSON.parse(raw) : null;
    } catch (_error) {}
  }

  // Preserve deterministic geometry in non-render builds. This path has no
  // native layout cache, but lifecycle behavior (initial delivery and
  // change-only rechecks) should remain useful to automation consumers.
  if (!suppliedByBatch && !hasRenderer && target?.getBoundingClientRect) {
    const rect = target.getBoundingClientRect();
    geometry = {
      x: rect.x, y: rect.y,
      clientWidth: rect.width, clientHeight: rect.height,
    };
  }

  // No renderer box (detached, display:none) has zero sizes. The initial zero
  // is still delivered because an observation starts without a reported size.
  if (!geometry) {
    const zero = _roPhysicalSize(0, 0, false);
    return {
      contentRect: _ioRect(0, 0, 0, 0),
      contentBoxSize: [zero],
      borderBoxSize: [_roPhysicalSize(0, 0, false)],
      devicePixelContentBoxSize: [_roPhysicalSize(0, 0, false)],
      selected: { "content-box": [0, 0], "border-box": [0, 0], "device-pixel-content-box": [0, 0] },
    };
  }

  // The bulk native measurement includes this small style subset from the
  // same PreparedRender as geometry. Non-render builds retain the CSSOM
  // fallback, and a missing/invalid bulk result falls back above.
  const style = suppliedByBatch
    ? {
        ...geometry,
        // `writing-mode` is not yet part of the renderer's compact computed
        // snapshot. Preserve the existing CSSOM fallback for an authored
        // inline value so batching does not silently swap inline/block axes.
        writingMode: geometry.writingMode || target?.style?.writingMode || "",
      }
    : getComputedStyle(target);
  const paddingTop = _roNumber(style.paddingTop);
  const paddingRight = _roNumber(style.paddingRight);
  const paddingBottom = _roNumber(style.paddingBottom);
  const paddingLeft = _roNumber(style.paddingLeft);
  const borderTop = _roNumber(style.borderTopWidth);
  const borderRight = _roNumber(style.borderRightWidth);
  const borderBottom = _roNumber(style.borderBottomWidth);
  const borderLeft = _roNumber(style.borderLeftWidth);
  const clientWidth = Math.max(0, Number(geometry.clientWidth) || 0);
  const clientHeight = Math.max(0, Number(geometry.clientHeight) || 0);
  const contentWidth = Math.max(0, clientWidth - paddingLeft - paddingRight);
  const contentHeight = Math.max(0, clientHeight - paddingTop - paddingBottom);
  const borderWidth = Math.max(0, clientWidth + borderLeft + borderRight);
  const borderHeight = Math.max(0, clientHeight + borderTop + borderBottom);
  const vertical = /^(?:vertical|sideways)/.test(style.writingMode || "");
  // Per Resize Observer, ordinary non-replaced inline elements have an empty
  // observed box even though getBoundingClientRect() encloses their glyphs.
  const replaced = /^(?:IMG|VIDEO|AUDIO|IFRAME|EMBED|OBJECT|INPUT|TEXTAREA|SELECT|CANVAS|SVG)$/.test(
    target.tagName || ""
  );
  const emptyInline = style.display === "inline" && !replaced;
  const observedContentWidth = emptyInline ? 0 : contentWidth;
  const observedContentHeight = emptyInline ? 0 : contentHeight;
  const observedBorderWidth = emptyInline ? 0 : borderWidth;
  const observedBorderHeight = emptyInline ? 0 : borderHeight;
  const contentSize = _roPhysicalSize(observedContentWidth, observedContentHeight, vertical);
  const borderSize = _roPhysicalSize(observedBorderWidth, observedBorderHeight, vertical);

  // Device-pixel content sizes snap the content edges, rather than merely
  // rounding a CSS size multiplied by DPR. Preserve that distinction for
  // fractional positions and dimensions.
  const dpr = Math.max(0, Number(globalThis.devicePixelRatio) || 1);
  const contentLeft = (Number(geometry.x) + borderLeft + paddingLeft) * dpr;
  const contentTop = (Number(geometry.y) + borderTop + paddingTop) * dpr;
  const deviceWidth = emptyInline ? 0 : Math.max(0,
    Math.round(contentLeft + contentWidth * dpr) - Math.round(contentLeft));
  const deviceHeight = emptyInline ? 0 : Math.max(0,
    Math.round(contentTop + contentHeight * dpr) - Math.round(contentTop));
  const deviceSize = _roPhysicalSize(deviceWidth, deviceHeight, vertical);
  return {
    contentRect: emptyInline
      ? _ioRect(0, 0, 0, 0)
      : _ioRect(paddingLeft, paddingTop, contentWidth, contentHeight),
    contentBoxSize: [contentSize],
    borderBoxSize: [borderSize],
    devicePixelContentBoxSize: [deviceSize],
    selected: {
      "content-box": [contentSize.inlineSize, contentSize.blockSize],
      "border-box": [borderSize.inlineSize, borderSize.blockSize],
      "device-pixel-content-box": [deviceSize.inlineSize, deviceSize.blockSize],
    },
  };
}

function _roMeasurements(targets) {
  const measurements = new Map();
  if (!targets.length) return measurements;
  const bulk = Deno.core.ops.op_resize_observer_measurements;
  if (typeof bulk === "function"
      && targets.every(target => target?.[_nidSym] != null)) {
    try {
      const raw = bulk(JSON.stringify(targets.map(target => target[_nidSym] | 0)));
      const geometries = raw ? JSON.parse(raw) : null;
      if (Array.isArray(geometries) && geometries.length === targets.length) {
        for (let index = 0; index < targets.length; index++) {
          measurements.set(
            targets[index],
            _roMeasurement(targets[index], geometries[index], true),
          );
        }
        return measurements;
      }
    } catch (_error) {}
  }
  for (const target of targets) {
    measurements.set(target, _roMeasurement(target));
  }
  return measurements;
}

const _roConstructionKey = {};
const _roSizeValues = new WeakMap();
globalThis.ResizeObserverSize = class ResizeObserverSize {
  constructor(key, inlineSize, blockSize) {
    if (key !== _roConstructionKey) throw new TypeError("Illegal constructor");
    _roSizeValues.set(this, { inlineSize, blockSize });
  }
  get inlineSize() { return _roSizeValues.get(this)?.inlineSize; }
  get blockSize() { return _roSizeValues.get(this)?.blockSize; }
};
const _roEntryValues = new WeakMap();
globalThis.ResizeObserverEntry = class ResizeObserverEntry {
  constructor(key, target, measurement) {
    if (key !== _roConstructionKey) throw new TypeError("Illegal constructor");
    _roEntryValues.set(this, { target, measurement });
  }
  get target() { return _roEntryValues.get(this)?.target; }
  get contentRect() { return _roEntryValues.get(this)?.measurement.contentRect; }
  get borderBoxSize() { return _roEntryValues.get(this)?.measurement.borderBoxSize; }
  get contentBoxSize() { return _roEntryValues.get(this)?.measurement.contentBoxSize; }
  get devicePixelContentBoxSize() {
    return _roEntryValues.get(this)?.measurement.devicePixelContentBoxSize;
  }
};
globalThis.ResizeObserver = class ResizeObserver {
  constructor(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("ResizeObserver callback must be a function");
    }
    this._callback = callback;
    this._targets = new Map();
    this._active = [];
    this._skipped = false;
  }
  _gather(measurements, depth) {
    this._active = [];
    this._skipped = false;
    let shallowest = Infinity;
    for (const [target, observation] of this._targets) {
      let measurement = measurements.get(target);
      if (!measurement) {
        measurement = _roMeasurement(target);
        measurements.set(target, measurement);
      }
      const size = measurement.selected[observation.box];
      const last = observation.last;
      if (last && last[0] === size[0] && last[1] === size[1]) continue;
      const targetDepth = _roNodeDepth(target);
      // A callback may disconnect and begin observing a different target.
      // Browsers deliver that initial observation on the next rendering
      // opportunity. We fold that opportunity into this bounded cycle so it
      // does not require a persistent frame timer; already-reported targets
      // still obey the loop-depth guard.
      if (targetDepth <= depth && last) {
        this._skipped = true;
        continue;
      }
      shallowest = Math.min(shallowest, targetDepth);
      this._active.push({ target, observation, measurement, size });
    }
    return {
      active: this._active.length > 0,
      skipped: this._skipped,
      shallowest,
    };
  }
  _broadcast() {
    if (!this._active.length) return;
    const entries = this._active.map(({ target, observation, measurement, size }) => {
      // Update before invoking callbacks. Callback-driven mutations are
      // compared against this delivery in the same bounded delivery cycle.
      observation.last = size.slice();
      return new ResizeObserverEntry(_roConstructionKey, target, measurement);
    });
    this._active = [];
    try { this._callback(entries, this); } catch (_error) {}
  }
  observe(target, options = {}) {
    if (!(target instanceof Element)) {
      throw new TypeError("ResizeObserver.observe requires an Element");
    }
    const box = options && options.box != null ? String(options.box) : "content-box";
    if (box !== "content-box" && box !== "border-box" &&
        box !== "device-pixel-content-box") {
      throw new TypeError(`Invalid ResizeObserver box option: ${box}`);
    }
    const current = this._targets.get(target);
    if (current && current.box === box) return;
    this._targets.set(target, { box, last: null });
    _registerResizeObserver(this);
    _scheduleResizeRenderCheckpoint();
  }
  unobserve(target) {
    this._targets.delete(target);
    if (!this._targets.size) _unregisterResizeObserver(this);
  }
  disconnect() {
    this._targets.clear();
    this._active = [];
    this._skipped = false;
    _unregisterResizeObserver(this);
  }
};

if (typeof TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(str) {
      str = String(str);
      const buf = [];
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) buf.push(c);
        else if (c < 0x800) { buf.push(0xC0|(c>>6), 0x80|(c&0x3F)); }
        else if (c < 0xD800 || c >= 0xE000) { buf.push(0xE0|(c>>12), 0x80|((c>>6)&0x3F), 0x80|(c&0x3F)); }
        else { c = 0x10000 + (((c & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF)); buf.push(0xF0|(c>>18), 0x80|((c>>12)&0x3F), 0x80|((c>>6)&0x3F), 0x80|(c&0x3F)); }
      }
      return new Uint8Array(buf);
    }
    encodeInto(str, dest) { const enc = this.encode(str); dest.set(enc.slice(0, dest.length)); return { read: str.length, written: Math.min(enc.length, dest.length) }; }
  };
}

// IntersectionObserver. Render builds provide real, scroll-relative target,
// element-root, and overflow-ancestor boxes from one prepared layout snapshot.
globalThis.__intersectionObservers = [];
let _intersectionRenderCheckpointPending = false;
const _intersectionDeliveryObservers = new Set();
let _intersectionDeliveryTaskPending = false;

function _scheduleIntersectionObserverDelivery(observer) {
  if (!observer._connected || !observer._records.length) return;
  _intersectionDeliveryObservers.add(observer);
  if (_intersectionDeliveryTaskPending) return;
  _intersectionDeliveryTaskPending = true;

  // IntersectionObserver has one task source per document. Deliver every
  // observer which became pending during the rendering update from that task;
  // posting one task per observer lets unrelated scheduler work split a single
  // document notification into seconds of staggered framework updates.
  _browserPostedTaskEnqueue(() => {
    _intersectionDeliveryTaskPending = false;
    const pending = [..._intersectionDeliveryObservers];
    _intersectionDeliveryObservers.clear();
    for (const current of pending) {
      if (!current._connected || !current._records.length) continue;
      const records = current.takeRecords();
      try { current._callback(records, current); } catch (e) {}
    }
  }, _schedulerPriorityRank["user-visible"] * 2);
}

function _scheduleIntersectionRenderCheckpoint() {
  if (!globalThis.__intersectionObservers.some(
    observer => observer._connected && observer._targets.size,
  )) return;
  if (_intersectionRenderCheckpointPending) return;
  _intersectionRenderCheckpointPending = true;
  _scheduleRenderingOpportunity();
}
function _runIntersectionRenderCheckpoint() {
  _intersectionRenderCheckpointPending = false;
  const observers = globalThis.__intersectionObservers.filter(
    observer => observer._connected && observer._targets.size,
  );
  const elements = [];
  const seen = new Set();
  const addElement = element => {
    if (!(element instanceof Element) || seen.has(element)) return;
    seen.add(element);
    elements.push(element);
  };

  // Gather the complete clip graph before entering native code. DOM/shadow
  // ancestry stays in JS, while every geometry/style value comes from the
  // same animation sample and PreparedRender snapshot.
  for (const observer of observers) {
    for (const target of observer._targets) addElement(target);
  }
  for (const observer of observers) {
    if (observer._root instanceof Element) addElement(observer._root);
    for (const target of observer._targets) {
      let ancestor = target.parentNode || target.host || null;
      while (ancestor && ancestor !== observer._root && ancestor.nodeType !== 9) {
        addElement(ancestor);
        ancestor = ancestor.parentNode || ancestor.host || null;
      }
    }
  }
  const measurements = _ioMeasurements(elements);
  for (const observer of observers) {
    if (observer._connected && observer._targets.size) {
      observer._check([...observer._targets], false, measurements);
    }
  }
}
function _ioRect(x, y, width, height) {
  return {
    x, y, width, height,
    top: y, left: x, right: x + width, bottom: y + height,
    toJSON() { return this; },
  };
}
function _ioMargins(value) {
  const parts = String(value || "0px").trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 4) return null;
  const parsed = parts.map((part) => {
    const match = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(px|%)$/.exec(part);
    return match ? { value: Number(match[1]), unit: match[2] } : null;
  });
  if (parsed.some((part) => !part)) return null;
  if (parsed.length === 1) return [parsed[0], parsed[0], parsed[0], parsed[0]];
  if (parsed.length === 2) return [parsed[0], parsed[1], parsed[0], parsed[1]];
  if (parsed.length === 3) return [parsed[0], parsed[1], parsed[2], parsed[1]];
  return parsed;
}
function _ioClipsOverflow(value) {
  return /^(?:auto|clip|hidden|overlay|scroll)$/.test(String(value || ""));
}
function _ioMeasurements(elements) {
  const measurements = new Map();
  if (!elements.length) return measurements;
  const bulk = Deno.core.ops.op_intersection_observer_measurements;
  const nativeElements = elements.filter(element => element?.[_nidSym] != null);
  if (typeof bulk !== "function" || !nativeElements.length) return measurements;
  try {
    const raw = bulk(JSON.stringify(nativeElements.map(element => element[_nidSym] | 0)));
    const geometries = raw ? JSON.parse(raw) : null;
    if (Array.isArray(geometries) && geometries.length === nativeElements.length) {
      for (let index = 0; index < nativeElements.length; index++) {
        measurements.set(nativeElements[index], geometries[index]);
      }
    }
  } catch (_error) {}
  return measurements;
}
function _ioElementRect(element, measurements) {
  if (measurements.has(element)) {
    const geometry = measurements.get(element);
    return geometry
      ? _ioRect(
          _roNumber(geometry.x), _roNumber(geometry.y),
          _roNumber(geometry.width), _roNumber(geometry.height),
        )
      : _ioRect(0, 0, 0, 0);
  }
  const rect = element.getBoundingClientRect();
  return _ioRect(rect.x, rect.y, rect.width, rect.height);
}
function _ioElementStyle(element, measurements) {
  return measurements.has(element)
    ? (measurements.get(element) || {})
    : getComputedStyle(element);
}
function _ioElementPaddingBox(element, style, measurements) {
  const hasMeasurement = measurements.has(element);
  const geometry = measurements.get(element);
  const rect = _ioElementRect(element, measurements);
  const borderLeft = _roNumber(style.borderLeftWidth);
  const borderTop = _roNumber(style.borderTopWidth);
  const width = hasMeasurement
    ? (geometry ? _roNumber(geometry.clientWidth) : 0)
    : element.clientWidth;
  const height = hasMeasurement
    ? (geometry ? _roNumber(geometry.clientHeight) : 0)
    : element.clientHeight;
  return _ioRect(rect.left + borderLeft, rect.top + borderTop, width, height);
}
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor(callback, options) {
    if (typeof callback !== "function") {
      throw new TypeError("IntersectionObserver callback must be a function");
    }
    this._callback = callback;
    this._options = options || {};
    this._root = this._options.root == null ? null : this._options.root;
    if (this._root !== null && !(this._root instanceof Element) &&
        this._root?.nodeType !== 9) {
      throw new TypeError("IntersectionObserver root must be an Element or Document");
    }
    this._margins = _ioMargins(this._options.rootMargin || "0px");
    if (!this._margins) throw new SyntaxError("Invalid IntersectionObserver rootMargin");
    const raw = this._options.threshold == null
      ? [0]
      : (Array.isArray(this._options.threshold) ? this._options.threshold : [this._options.threshold]);
    this._thresholds = [...new Set(raw.map(Number))].sort((a, b) => a - b);
    if (!this._thresholds.length) this._thresholds = [0];
    if (this._thresholds.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new RangeError("IntersectionObserver threshold must be between 0 and 1");
    }
    this._targets = new Set();
    this._previous = new Map();
    this._records = [];
    this._connected = true;
    globalThis.__intersectionObservers.push(this);
  }
  _rootBounds(measurements) {
    let x = 0, y = 0;
    let width = globalThis.innerWidth || 1280;
    let height = globalThis.innerHeight || 720;
    if (this._root instanceof Element) {
      const style = _ioElementStyle(this._root, measurements);
      const clips = _ioClipsOverflow(style.overflowX) ||
        _ioClipsOverflow(style.overflowY);
      if (clips) {
        const paddingBox = _ioElementPaddingBox(this._root, style, measurements);
        x = paddingBox.left;
        y = paddingBox.top;
        // The intersection root for a content-clipping element is its padding
        // box (the CSSOM client box), independent of its current scroll offset.
        width = paddingBox.width;
        height = paddingBox.height;
      } else {
        const rect = _ioElementRect(this._root, measurements);
        x = rect.left;
        y = rect.top;
        width = rect.width;
        height = rect.height;
      }
    }
    const resolve = (margin, basis) =>
      margin.unit === "%" ? margin.value * basis / 100 : margin.value;
    // IntersectionObserver resolves every rootMargin percentage against the
    // root rectangle's width, including the block-axis sides.
    const top = resolve(this._margins[0], width);
    const right = resolve(this._margins[1], width);
    const bottom = resolve(this._margins[2], width);
    const left = resolve(this._margins[3], width);
    return _ioRect(x - left, y - top, width + left + right, height + top + bottom);
  }
  _entry(target, root, measurements) {
    const rect = _ioElementRect(target, measurements);
    // A connected zero-area box may intersect when its edges touch the root,
    // but a detached or non-generated box must never become intersecting just
    // because its synthetic zero rectangle happens to sit at the origin.
    const hasGeneratedBox = !measurements.has(target) ||
      measurements.get(target) !== null;
    let inRootTree = hasGeneratedBox && target.isConnected &&
      (!(this._root instanceof Element) || this._root.contains(target));
    let left = Math.max(rect.left, root.left);
    let top = Math.max(rect.top, root.top);
    let right = Math.min(rect.right, root.right);
    let bottom = Math.min(rect.bottom, root.bottom);

    // Mapping a target to its intersection root clips it at every intervening
    // overflow container. Intersecting only with the final root incorrectly
    // exposes offscreen children of nested carousels, virtual lists, and lazy
    // loading viewports. Use each ancestor's padding box, independently by
    // axis, matching Chromium's rectangular overflow clip chain.
    let ancestor = target.parentNode || target.host || null;
    while (inRootTree && ancestor && ancestor !== this._root && ancestor.nodeType !== 9) {
      if (ancestor instanceof Element) {
        const style = _ioElementStyle(ancestor, measurements);
        const clipX = _ioClipsOverflow(style.overflowX);
        const clipY = _ioClipsOverflow(style.overflowY);
        if (clipX || clipY) {
          const clip = _ioElementPaddingBox(ancestor, style, measurements);
          if (clipX) {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (clipY) {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
      }
      ancestor = ancestor.parentNode || ancestor.host || null;
    }
    if (this._root instanceof Element && ancestor !== this._root) inRootTree = false;

    const edgesTouch = inRootTree && right >= left && bottom >= top;
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const targetArea = Math.max(0, rect.width) * Math.max(0, rect.height);
    const isIntersecting = edgesTouch;
    const area = isIntersecting ? width * height : 0;
    return {
      target,
      isIntersecting,
      intersectionRatio: targetArea > 0 ? area / targetArea : (isIntersecting ? 1 : 0),
      boundingClientRect: _ioRect(rect.x, rect.y, rect.width, rect.height),
      intersectionRect: isIntersecting ? _ioRect(left, top, width, height) : _ioRect(0, 0, 0, 0),
      rootBounds: root,
      time: performance.now(),
    };
  }
  _thresholdIndex(ratio) {
    let index = 0;
    while (index < this._thresholds.length && this._thresholds[index] <= ratio) index++;
    return index;
  }
  _queueChanged(target, forceInitial, root, measurements) {
    const entry = this._entry(target, root, measurements);
    const previous = this._previous.get(target);
    const changed = forceInitial || !previous ||
      previous.isIntersecting !== entry.isIntersecting ||
      this._thresholdIndex(previous.intersectionRatio) !==
        this._thresholdIndex(entry.intersectionRatio);
    this._previous.set(target, {
      isIntersecting: entry.isIntersecting,
      intersectionRatio: entry.intersectionRatio,
    });
    if (changed) this._records.push(entry);
  }
  _check(targets, forceInitial, measurements = new Map()) {
    if (!this._connected) return;
    const root = this._rootBounds(measurements);
    for (const target of targets) {
      if (this._targets.has(target)) {
        this._queueChanged(target, !!forceInitial, root, measurements);
      }
    }
    // Delivery remains a task after the rendering update and its microtask
    // checkpoint. The document-level queue batches all pending observers.
    _scheduleIntersectionObserverDelivery(this);
  }
  observe(el) {
    if (!el || this._targets.has(el)) return;
    // `disconnect()` removes every current observation; it does not destroy
    // the observer. Browsers allow the same object to observe targets again.
    // Re-register lazily so dormant observers do not stay in the global
    // geometry recomputation list forever.
    if (!this._connected) {
      this._connected = true;
      if (!globalThis.__intersectionObservers.includes(this)) {
        globalThis.__intersectionObservers.push(this);
      }
    }
    this._targets.add(el);
    this._previous.delete(el);
    _scheduleIntersectionRenderCheckpoint();
  }
  unobserve(el) {
    this._targets.delete(el);
    this._previous.delete(el);
  }
  disconnect() {
    this._connected = false;
    this._targets.clear();
    this._previous.clear();
    this._records.length = 0;
    _intersectionDeliveryObservers.delete(this);
    const index = globalThis.__intersectionObservers.indexOf(this);
    if (index >= 0) globalThis.__intersectionObservers.splice(index, 1);
  }
  takeRecords() { return this._records.splice(0); }
  get root() { return this._root; }
  get rootMargin() {
    return this._margins.map((margin) => `${margin.value}${margin.unit}`).join(" ");
  }
  get thresholds() { return this._thresholds.slice(); }
};
(function() {
  const renderingUpdate = () => {
    _scheduleIntersectionRenderCheckpoint();
    _scheduleResizeRenderCheckpoint();
  };
  // Scrolling calls the IO-only hook. Actual viewport resizing remains a full
  // rendering update and schedules both observer families.
  globalThis.__obscura_recompute_intersections = _scheduleIntersectionRenderCheckpoint;
  globalThis.addEventListener("resize", renderingUpdate);
  const wireUp = () => {
    if (!globalThis.document) return;
    // DOM writes synchronously mark ResizeObserver dirty through `_dom`; this
    // MutationObserver is only needed for intersection geometry. Scheduling RO
    // again here would escape its depth-bounded delivery cycle and allow a
    // self-resizing callback to create an infinite chain of zero-delay tasks.
    const observer = new MutationObserver(_scheduleIntersectionRenderCheckpoint);
    try {
      observer.observe(globalThis.document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } catch {}
  };
  if (globalThis.document) wireUp();
  else Promise.resolve().then(wireUp);
})();
globalThis.IntersectionObserverEntry = class IntersectionObserverEntry {};

// HTMLImageElement is backed by the same retained resource cache used by
// layout/paint. The render-only native op owns responsive candidate selection,
// fetching, and metadata sniffing; bootstrap owns only the observable request
// state and event timing.
class HTMLImageElement extends Element {
  constructor(nid) {
    super(nid);
    this._imageRequest = 0;
    this._imageQueued = false;
    this._imageInitialized = false;
    this._imageCompletionDeferred = false;
    this._imageComplete = typeof Deno.core.ops.op_image_metadata === "function"
      ? true
      : !this.getAttribute("src");
    this._imageDecoded = false;
    this._imageNaturalWidth = 0;
    this._imageNaturalHeight = 0;
    this._imageCurrentSrc = "";
    this._imageDecodeWaiters = [];
    this._refreshImageFromCache();
    this._imageInitialized = true;
    // Parser images stay lazy until script observes their lifecycle or paint
    // asks for the same cache entry. Inline handlers are observers too.
    if (!this._imageComplete
        && (this.hasAttribute("onload") || this.hasAttribute("onerror"))) {
      this._queueImageRequest();
    }
  }

  get src() {
    const raw = this.getAttribute("src");
    if (!raw) return "";
    try { return new URL(raw, this.baseURI || globalThis.location?.href || "about:blank").href; }
    catch (_error) { return raw; }
  }
  set src(value) { this.setAttribute("src", value); }

  get currentSrc() {
    this._refreshImageFromCache();
    this._queueImageRequest();
    return this._imageCurrentSrc;
  }
  get complete() {
    this._refreshImageFromCache();
    this._queueImageRequest();
    return this._imageComplete;
  }
  get naturalWidth() {
    this._refreshImageFromCache();
    this._queueImageRequest();
    return this._imageNaturalWidth;
  }
  get naturalHeight() {
    this._refreshImageFromCache();
    this._queueImageRequest();
    return this._imageNaturalHeight;
  }
  get onload() { return this._imageOnload || null; }
  set onload(value) {
    this._imageOnload = typeof value === "function" ? value : null;
    if (this._imageOnload) {
      this._refreshImageFromCache();
      this._queueImageRequest();
    }
  }
  get onerror() { return this._imageOnerror || null; }
  set onerror(value) {
    this._imageOnerror = typeof value === "function" ? value : null;
    if (this._imageOnerror) {
      this._refreshImageFromCache();
      this._queueImageRequest();
    }
  }

  get width() {
    const value = Number.parseInt(this.getAttribute("width") || "", 10);
    return Number.isFinite(value) && value >= 0 ? value : this._imageNaturalWidth;
  }
  set width(value) { this.setAttribute("width", Math.max(0, Number(value) || 0)); }
  get height() {
    const value = Number.parseInt(this.getAttribute("height") || "", 10);
    return Number.isFinite(value) && value >= 0 ? value : this._imageNaturalHeight;
  }
  set height(value) { this.setAttribute("height", Math.max(0, Number(value) || 0)); }

  get srcset() { return this.getAttribute("srcset") || ""; }
  set srcset(value) { this.setAttribute("srcset", value); }
  get sizes() { return this.getAttribute("sizes") || ""; }
  set sizes(value) { this.setAttribute("sizes", value); }
  get loading() { return this.getAttribute("loading") || "eager"; }
  set loading(value) { this.setAttribute("loading", value); }
  get decoding() { return this.getAttribute("decoding") || "auto"; }
  set decoding(value) { this.setAttribute("decoding", value); }
  get fetchPriority() { return this.getAttribute("fetchpriority") || "auto"; }
  set fetchPriority(value) { this.setAttribute("fetchpriority", value); }
  get crossOrigin() { return this.getAttribute("crossorigin"); }
  set crossOrigin(value) {
    if (value === null) this.removeAttribute("crossorigin");
    else this.setAttribute("crossorigin", value);
  }

  setAttribute(name, value) {
    const normalized = String(name).toLowerCase();
    super.setAttribute(name, value);
    if (normalized === "src" || normalized === "srcset" || normalized === "sizes"
        || normalized === "crossorigin") {
      this._imageSourceChanged();
    }
    else if ((normalized === "onload" || normalized === "onerror")
        && !this._imageComplete) this._queueImageRequest();
  }

  removeAttribute(name) {
    const normalized = String(name).toLowerCase();
    super.removeAttribute(name);
    if (normalized === "src" || normalized === "srcset" || normalized === "sizes"
        || normalized === "crossorigin") {
      this._imageSourceChanged();
    }
  }

  decode() {
    this._refreshImageFromCache();
    if (this._imageComplete) {
      return this._imageDecoded
        ? Promise.resolve()
        : Promise.reject(_imageEncodingError());
    }
    this._queueImageRequest();
    return new Promise((resolve, reject) => {
      this._imageDecodeWaiters.push({ resolve, reject, request: this._imageRequest });
    });
  }

  _imageSourceChanged() {
    // The lightweight build has no retained render-resource cache. It still
    // preserves the historical non-blocking Image lifecycle so preloaders do
    // not hang while rendering is disabled.
    const hasMetadataLoader = typeof Deno.core.ops.op_load_image_metadata === "function";
    this._adoptImageCandidate(hasMetadataLoader ? "" : this.src);
    this._imageCompletionDeferred = true;
    this._refreshImageFromCache(true);
    if (!this._imageComplete) this._queueImageRequest();
  }

  _adoptImageCandidate(currentSrc) {
    this._rejectImageDecodes();
    this._imageRequest++;
    this._imageQueued = false;
    this._imageNaturalWidth = 0;
    this._imageNaturalHeight = 0;
    this._imageDecoded = false;
    this._imageCurrentSrc = currentSrc ? String(currentSrc) : "";
    this._imageComplete = !this._imageCurrentSrc;
  }

  _queueImageRequest() {
    if (this._imageQueued || this._imageComplete) return;
    this._imageQueued = true;
    const request = this._imageRequest;
    setTimeout(() => {
      if (request === this._imageRequest && !this._imageComplete) {
        this._runImageRequest(request);
      } else if (request === this._imageRequest) {
        this._imageQueued = false;
      }
    }, 1);
  }

  _runImageRequest(request) {
    const finish = (metadata) => {
      if (request !== this._imageRequest) return;
      this._imageQueued = false;
      if (metadata && metadata.state === "stale") {
        this._refreshImageFromCache(true);
        this._queueImageRequest();
        return;
      }
      this._applyImageMetadata(metadata, request, true);
    };
    try {
      const op = Deno.core.ops.op_load_image_metadata;
      if (typeof op === "function") {
        const fetchStart = performance.now();
        // The node's own base, not the page's: an image created inside a
        // frame must be fetched from that frame's origin.
        Promise.resolve(op(this[_nidSym] >>> 0, String(this.baseURI || ""))).then(
          raw => {
            let metadata = null;
            try { metadata = JSON.parse(raw); }
            catch (_error) { metadata = { ok: false, currentSrc: this.src }; }
            // Timing is filed before the lifecycle runs: a stale candidate
            // still consumed the network, and Chrome's entry does not depend
            // on whether the element ends up using the bytes.
            _recordImageResourceTiming(metadata, fetchStart);
            finish(metadata);
          },
          () => finish({ ok: false, currentSrc: this.src }),
        );
      } else {
        // Non-render builds have no authoritative resource cache. Preserve the
        // old non-blocking compatibility behavior without issuing a duplicate
        // network fetch: the request succeeds with unknown intrinsic size.
        finish({ ok: true, currentSrc: this.src, width: 0, height: 0 });
      }
    } catch (_error) {
      finish({ ok: false, currentSrc: this.src });
    }
  }

  _refreshImageFromCache(deferCompletion) {
    try {
      const op = Deno.core.ops.op_image_metadata;
      if (typeof op !== "function") return;
      const metadata = JSON.parse(op(this[_nidSym] >>> 0, true, String(this.baseURI || "")));
      if (!metadata) return;
      const selected = metadata.currentSrc ? String(metadata.currentSrc) : "";
      if (selected !== this._imageCurrentSrc) {
        this._adoptImageCandidate(selected);
        // A live candidate switch is a new request even when paint retained
        // the candidate bytes. A cache-only getter must not synchronously
        // complete it and swallow the later load/error event.
        if (this._imageInitialized && selected) {
          this._imageCompletionDeferred = true;
        }
      }
      if (metadata.state === "pending") {
        if (selected && this._imageComplete) {
          this._adoptImageCandidate(selected);
        }
        return;
      }
      if ((deferCompletion || this._imageCompletionDeferred) && selected) {
        this._imageComplete = false;
        this._imageDecoded = false;
        this._imageNaturalWidth = 0;
        this._imageNaturalHeight = 0;
        return;
      }
      this._applyImageMetadata(metadata, this._imageRequest, false);
    } catch (_error) {}
  }

  _applyImageMetadata(metadata, request, dispatchEvent) {
    if (request !== this._imageRequest) return;
    const previousLifecycle = [
      this._imageComplete,
      this._imageDecoded,
      this._imageCurrentSrc,
      this._imageNaturalWidth,
      this._imageNaturalHeight,
    ];
    const selected = metadata && metadata.currentSrc
      ? String(metadata.currentSrc)
      : "";
    if (selected !== this._imageCurrentSrc) {
      this._adoptImageCandidate(selected);
      request = this._imageRequest;
    }
    this._imageCompletionDeferred = false;
    this._imageComplete = true;
    this._imageCurrentSrc = selected || this.src;
    const width = Number(metadata && metadata.width);
    const height = Number(metadata && metadata.height);
    const loaded = !!(metadata && metadata.ok)
      && (typeof Deno.core.ops.op_image_metadata !== "function"
        || (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0));
    if (loaded) {
      this._imageDecoded = true;
      this._imageNaturalWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
      this._imageNaturalHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : 0;
      this._resolveImageDecodes(request);
      if (dispatchEvent) {
        try { this.dispatchEvent(new Event("load")); } catch (_error) {}
      }
    } else {
      this._imageDecoded = false;
      this._imageNaturalWidth = 0;
      this._imageNaturalHeight = 0;
      this._rejectImageDecodes(request);
      if (dispatchEvent) {
        try { this.dispatchEvent(new Event("error")); } catch (_error) {}
      }
    }
    const lifecycleChanged =
      previousLifecycle[0] !== this._imageComplete ||
      previousLifecycle[1] !== this._imageDecoded ||
      previousLifecycle[2] !== this._imageCurrentSrc ||
      previousLifecycle[3] !== this._imageNaturalWidth ||
      previousLifecycle[4] !== this._imageNaturalHeight;
    if (lifecycleChanged) {
      // Intrinsic dimensions can become layout input at request completion
      // even though no DOM attribute changed. Stable cache-only getters must
      // not manufacture rendering updates on every read.
      _scheduleResizeRenderCheckpoint();
    }
  }

  _resolveImageDecodes(request) {
    const remaining = [];
    for (const waiter of this._imageDecodeWaiters) {
      if (waiter.request === request) waiter.resolve();
      else remaining.push(waiter);
    }
    this._imageDecodeWaiters = remaining;
  }

  _rejectImageDecodes(request) {
    const remaining = [];
    for (const waiter of this._imageDecodeWaiters) {
      if (request === undefined || waiter.request === request) {
        waiter.reject(_imageEncodingError());
      } else {
        remaining.push(waiter);
      }
    }
    this._imageDecodeWaiters = remaining;
  }

  addEventListener(type, callback, options) {
    super.addEventListener(type, callback, options);
    if ((String(type) === "load" || String(type) === "error") && callback) {
      this._refreshImageFromCache();
      this._queueImageRequest();
    }
  }
}
globalThis.HTMLImageElement = HTMLImageElement;
_markNative(HTMLImageElement);
_markNative(HTMLImageElement.prototype.decode);


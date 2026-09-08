class Animation {
  constructor(effect = null, timeline = globalThis.document?.timeline || null) {
    this.id = '';
    this.effect = effect;
    this.timeline = timeline;
    this.onfinish = null;
    this.oncancel = null;
    this._nativeId = _waapiNextId++;
    this._registered = false;
    this._playState = 'idle';
    this._holdTime = 0;
    this._startTime = null;
    this._finishTimer = null;
    this.ready = Promise.resolve(this);
    this._resetFinishedPromise();
    if (effect) effect._animation = this;
  }
  _resetFinishedPromise() {
    this.finished = new Promise((resolve, reject) => {
      this._resolveFinished = resolve;
      this._rejectFinished = reject;
    });
    // Browser code commonly ignores the rejected cancel promise.
    this.finished.catch(() => {});
  }
  _native(action, value = 0) {
    try {
      const changed = !!Deno.core.ops.op_waapi_control?.(this._nativeId, action, Number(value) || 0);
      if (changed) _domMutationEpoch++;
      return changed;
    }
    catch (_) { return false; }
  }
  _register() {
    if (this._registered || !this.effect) return this._registered;
    const input = {
      id: this._nativeId,
      node: this.effect.target[_nidSym],
      keyframes: this.effect._keyframes,
      ...this.effect._timing,
      // JSON has no Infinity literal and would silently turn it into null.
      // Preserve the Web Animations unrestricted-double value explicitly.
      iterations: this.effect._timing.iterations === Infinity
        ? 0
        : this.effect._timing.iterations,
      iterationsInfinite: this.effect._timing.iterations === Infinity,
    };
    try { this._registered = !!Deno.core.ops.op_waapi_create?.(JSON.stringify(input)); }
    catch (_) { this._registered = false; }
    if (this._registered) {
      _waapiAnimations.add(this);
      _domMutationEpoch++;
    }
    return this._registered;
  }
  _scheduleFinish() {
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
    if (this._playState !== 'running' || !this.effect) return;
    const timing = this.effect._timing;
    if (timing.iterations === Infinity) {
      this._finishTimer = null;
      return;
    }
    const end = Math.max(0, timing.delay + timing.duration * timing.iterations);
    const remaining = Math.max(0, end - this.currentTime);
    this._finishTimer = setTimeout(() => this.finish(), remaining);
  }
  get playState() { return this._playState; }
  get currentTime() {
    if (this._playState === 'running' && this._startTime != null) return Math.max(0, performance.now() - this._startTime);
    return this._holdTime;
  }
  set currentTime(value) {
    const time = Math.max(0, Number(value) || 0);
    this._holdTime = time;
    if (this._playState === 'running') this._startTime = performance.now() - time;
    this._native('currentTime', time);
    this._scheduleFinish();
  }
  get startTime() { return this._startTime; }
  set startTime(value) {
    if (value == null) { this._startTime = null; return; }
    const start = Number(value);
    if (!Number.isFinite(start)) throw new TypeError('Invalid startTime');
    this._startTime = start;
    this._holdTime = Math.max(0, performance.now() - start);
    this._native('currentTime', this._holdTime);
    this._scheduleFinish();
  }
  play() {
    if (!this.effect) return;
    if (this._playState === 'finished' || this._playState === 'idle') {
      this._holdTime = 0;
      if (this._playState === 'finished') this._resetFinishedPromise();
    }
    this._register();
    this._startTime = performance.now() - this._holdTime;
    this._playState = 'running';
    this._native('play');
    this.ready = Promise.resolve(this);
    this._scheduleFinish();
  }
  pause() {
    if (this._playState === 'idle') this._register();
    this._holdTime = this.currentTime;
    this._playState = 'paused';
    this._native('currentTime', this._holdTime);
    this._native('pause');
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
  }
  finish() {
    if (!this.effect) return;
    this._register();
    const timing = this.effect._timing;
    this._holdTime = Math.max(0, timing.delay + timing.duration * timing.iterations);
    this._playState = 'finished';
    this._native('finish');
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
    this._resolveFinished(this);
    const event = new Event('finish');
    this.dispatchEvent(event);
    if (typeof this.onfinish === 'function') { try { this.onfinish.call(this, event); } catch (e) { console.error(e); } }
  }
  cancel() {
    if (this._finishTimer != null) clearTimeout(this._finishTimer);
    this._native('cancel');
    this._registered = false;
    this._playState = 'idle';
    this._holdTime = 0;
    this._startTime = null;
    _waapiAnimations.delete(this);
    this._rejectFinished(new DOMException('The animation was canceled', 'AbortError'));
    const event = new Event('cancel');
    this.dispatchEvent(event);
    if (typeof this.oncancel === 'function') { try { this.oncancel.call(this, event); } catch (e) { console.error(e); } }
    this._resetFinishedPromise();
  }
  reverse() { throw new DOMException('reverse() is not implemented for this animation', 'NotSupportedError'); }
  addEventListener(type, callback, options) { _eventTargetAdd(this, type, callback, options); }
  removeEventListener(type, callback, options) { _eventTargetRemove(this, type, callback, options); }
  dispatchEvent(event) { return _eventTargetDispatch(this, event); }
}

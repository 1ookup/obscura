globalThis.MutationObserver = class MutationObserver {
  constructor(callback) {
    _hset(this, "_callback", callback);
    _hset(this, "_targets", []);
    _hset(this, "_records", []);
  }
  observe(target, options) {
    this._targets.push({ target, options: options || {} });
    globalThis.__mutationObservers.push(this);
  }
  disconnect() {
    _hset(this, "_targets", []);
    const idx = globalThis.__mutationObservers.indexOf(this);
    if (idx >= 0) globalThis.__mutationObservers.splice(idx, 1);
  }
  takeRecords() {
    const r = this._records.slice();
    _hset(this, "_records", []);
    return r;
  }
  _notify(records) {
    this._records.push(...records);
    Promise.resolve().then(() => {
      if (this._records.length > 0) {
        const batch = this._records.splice(0);
        // Delivered at the microtask checkpoint, which is inside the task that
        // caused the mutation: Chrome reports it in that frame's `scripts` as a
        // `MutationCallback` user callback.
        const owned = typeof globalThis.__obscura_task_begin === 'function'
          && globalThis.__obscura_task_begin();
        try { this._callback(batch, this); }
        catch(e) { /* observer errors shouldn't propagate */ }
        finally {
          if (owned) globalThis.__obscura_task_end('MutationCallback', 'user-callback');
        }
      }
    });
  }
};

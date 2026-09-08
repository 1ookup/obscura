// FragmentDirective and ViewTransition object shapes. Document owns the
// entry points; private state remains here so wrapper identity survives reads.
class _FragmentDirective {
  get [Symbol.toStringTag]() { return 'FragmentDirective'; }
}
const _documentFeaturePolicies = new WeakMap();
const _documentFragmentDirectives = new WeakMap();

const _viewTransitionTypeSetKey = Symbol('ViewTransitionTypeSet');
class ViewTransitionTypeSet extends Set {
  constructor(key = undefined, values = undefined) {
    if (key !== _viewTransitionTypeSetKey) {
      throw new TypeError("Failed to construct 'ViewTransitionTypeSet': Illegal constructor");
    }
    super(values);
  }
  get size() { return Reflect.get(Set.prototype, 'size', this); }
  add(value) { super.add(String(value)); return this; }
  clear() { return super.clear(); }
  delete(value) { return super.delete(String(value)); }
  entries() { return super.entries(); }
  forEach(callback, thisArg = undefined) { return super.forEach(callback, thisArg); }
  has(value) { return super.has(String(value)); }
  keys() { return super.keys(); }
  values() { return super.values(); }
  get [Symbol.toStringTag]() { return 'ViewTransitionTypeSet'; }
}

const _viewTransitionKey = Symbol('ViewTransition');
const _viewTransitionState = new WeakMap();
const _activeViewTransitions = new WeakMap();
class ViewTransition {
  constructor(key = undefined, document, update, types) {
    if (key !== _viewTransitionKey) {
      throw new TypeError("Failed to construct 'ViewTransition': Illegal constructor");
    }
    let resolveReady, rejectReady, resolveUpdate, rejectUpdate, resolveFinished, rejectFinished;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const updateCallbackDone = new Promise((resolve, reject) => { resolveUpdate = resolve; rejectUpdate = reject; });
    const finished = new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
    const state = {
      document, ready, updateCallbackDone, finished,
      resolveReady, rejectReady, resolveUpdate, rejectUpdate,
      resolveFinished, rejectFinished, skipped: false,
      waits: [], types: new ViewTransitionTypeSet(_viewTransitionTypeSetKey, types || []),
    };
    _viewTransitionState.set(this, state);
    Promise.resolve().then(async () => {
      try {
        if (typeof update === 'function') await update();
        state.resolveUpdate(); state.resolveReady();
        await Promise.all(state.waits);
        setTimeout(() => state.resolveFinished(), 0);
      } catch (error) {
        state.rejectUpdate(error); state.rejectReady(error); state.rejectFinished(error);
      }
    });
  }
  get finished() { const state = _viewTransitionState.get(this); if (!state) throw new TypeError('Illegal invocation'); return state.finished; }
  get ready() { const state = _viewTransitionState.get(this); if (!state) throw new TypeError('Illegal invocation'); return state.ready; }
  get updateCallbackDone() { const state = _viewTransitionState.get(this); if (!state) throw new TypeError('Illegal invocation'); return state.updateCallbackDone; }
  get types() { const state = _viewTransitionState.get(this); if (!state) throw new TypeError('Illegal invocation'); return state.types; }
  get transitionRoot() { const state = _viewTransitionState.get(this); if (!state) throw new TypeError('Illegal invocation'); return state.document.documentElement; }
  skipTransition() {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    if (state.skipped) return;
    state.skipped = true; state.resolveReady(); state.resolveFinished();
  }
  waitUntil(value) {
    const state = _viewTransitionState.get(this);
    if (!state) throw new TypeError('Illegal invocation');
    if (arguments.length < 1) {
      throw new TypeError(
        "Failed to execute 'waitUntil' on 'ViewTransition': 1 argument required, but only 0 present.");
    }
    state.waits.push(Promise.resolve(value));
  }
  get [Symbol.toStringTag]() { return 'ViewTransition'; }
}
globalThis.ViewTransitionTypeSet = ViewTransitionTypeSet;
globalThis.ViewTransition = ViewTransition;

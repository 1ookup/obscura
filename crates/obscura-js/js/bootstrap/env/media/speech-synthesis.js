// SpeechSynthesis surface shape.  No-op behavior lives in
// support/speech-synthesis-behavior.js.
if (typeof globalThis.speechSynthesis === 'undefined') {
  const synth = _makeSpeechSynthesis();
  // Chrome's global is a SpeechSynthesis instance; the behavior helper builds
  // a plain object, so bind the interface prototype for instanceof parity.
  if (typeof globalThis.SpeechSynthesis === 'function') {
    Object.setPrototypeOf(synth, globalThis.SpeechSynthesis.prototype);
    // Chromium 149: the instance answers [] to own-key reflection -- every
    // member (methods and the tri-state flags as get-accessors) lives on
    // SpeechSynthesis.prototype (census P0-4). State is static false in the
    // no-op host service.
    _installSpeechSynthesisPrototypeMembers(synth);
    // Chrome carries the voices-changed event handler on the interface
    // prototype as an accessor (`'onvoiceschanged' in SpeechSynthesis.prototype`
    // is true on the reference; the sAMar8 boolean probe reads exactly this).
    // The handler value slots on the instance, set-side keeps functions or
    // null the way WebIDL's EventHandler does.
    Object.defineProperty(globalThis.SpeechSynthesis.prototype, 'onvoiceschanged', {
      get() { return this.__obscuraOnVoicesChanged || null; },
      set(value) {
        // The handler slot stays non-enumerable: Chrome's instances carry no
        // own key for it.
        Object.defineProperty(this, '__obscuraOnVoicesChanged', {
          value: typeof value === 'function' ? value : null,
          writable: true, enumerable: false, configurable: true,
        });
      },
      enumerable: true,
      configurable: true,
    });
  }
  globalThis.speechSynthesis = synth;
}
if (typeof globalThis.SpeechSynthesisUtterance === 'undefined') {
  // Chrome's utterance is an EventTarget whose interface members all live on
  // the prototype as accessors: `u instanceof EventTarget` is true and
  // `Object.getOwnPropertyNames(u)` is empty on the reference, while the
  // prototype carries the six attributes and the seven Blink event handlers
  // (14 with the constructor). The accessors install below the class
  // definition; the state sits behind one per-instance symbol slot. The
  // constructor takes its argument from arguments[0] so `length` answers 0
  // the way Chrome's optional-parameter constructor does.
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance extends EventTarget {
    constructor() {
      super();
      _speechUtteranceInitialize(this, arguments[0]);
    }
  };
  _installUtteranceMembers(globalThis.SpeechSynthesisUtterance);
}

// SpeechSynthesis surface shape.  No-op behavior lives in
// support/speech-synthesis-behavior.js.
if (typeof globalThis.speechSynthesis === 'undefined') {
  const synth = _makeSpeechSynthesis();
  // Chrome's global is a SpeechSynthesis instance; the behavior helper builds
  // a plain object, so bind the interface prototype for instanceof parity.
  if (typeof globalThis.SpeechSynthesis === 'function') {
    Object.setPrototypeOf(synth, globalThis.SpeechSynthesis.prototype);
  }
  globalThis.speechSynthesis = synth;
}
if (typeof globalThis.SpeechSynthesisUtterance === 'undefined') {
  // Chrome's utterance is an EventTarget whose interface members all live on
  // the prototype as accessors: `u instanceof EventTarget` is true and
  // `Object.getOwnPropertyNames(u)` is empty on the reference, while the
  // prototype carries the six attributes and the seven Blink event handlers
  // (14 with the constructor). The accessors install below the class
  // definition; the state sits behind one per-instance symbol slot.
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance extends EventTarget {
    constructor(text) {
      super();
      _speechUtteranceInitialize(this, text);
    }
  };
  _installUtteranceMembers(globalThis.SpeechSynthesisUtterance);
}

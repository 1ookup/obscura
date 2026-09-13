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
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
    constructor(text) { _speechUtteranceInitialize(this, text); }
  };
}

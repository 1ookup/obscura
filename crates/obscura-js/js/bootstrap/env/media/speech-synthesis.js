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
  // Chrome's utterance is an EventTarget: `u instanceof EventTarget` answers
  // true on the reference browser and every event-handler attribute is an own
  // property of the instance, so the interface carries both. The event face
  // below is the Blink idl set (onstart/onend/onerror/onmark/onboundary/
  // onpause/onresume); the data-attribute defaults (voice null, lang "",
  // rate/pitch/volume 1) live in _speechUtteranceInitialize.
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance extends EventTarget {
    constructor(text) {
      super();
      _speechUtteranceInitialize(this, text);
    }
  };
}

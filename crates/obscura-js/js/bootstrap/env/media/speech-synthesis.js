// SpeechSynthesis surface shape.  No-op behavior lives in
// support/speech-synthesis-behavior.js.
if (typeof globalThis.speechSynthesis === 'undefined') {
  globalThis.speechSynthesis = _makeSpeechSynthesis();
}
if (typeof globalThis.SpeechSynthesisUtterance === 'undefined') {
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
    constructor(text) { _speechUtteranceInitialize(this, text); }
  };
}

// Speech synthesis is intentionally a no-op host service.  Keep its state and
// voice list in one behavior helper; speech-synthesis.js only installs the
// browser-facing shape.
function _speechSynthesisVoices() {
  return [{
    name: 'Google US English', lang: 'en-US', default: true,
    localService: true, voiceURI: 'Google US English',
  }];
}

function _makeSpeechSynthesis() {
  return {
    speaking: false,
    pending: false,
    paused: false,
    getVoices() { return _speechSynthesisVoices(); },
    speak() {},
    cancel() {},
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {},
    onvoiceschanged: null,
  };
}

function _speechUtteranceInitialize(utterance, text) {
  utterance.text = text;
  utterance.lang = 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
}

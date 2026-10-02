// Speech synthesis is intentionally a no-op host service.  Keep its state and
// voice list in one behavior helper; speech-synthesis.js only installs the
// browser-facing shape.
// The reference macOS host (zh-CN system) lists Tingting first, then the
// system voices in Chrome's fixed order. A Windows/Google table on a macOS
// fingerprint is wrong on both name and count.
const _SPEECH_VOICES = [
  ["婷婷", "zh-CN"],
  ["Albert", "en-US"],
  ["Alice", "it-IT"],
  ["Alva", "pt-BR"],
  ["Amélie", "fr-CA"],
  ["Amira", "ar-001"],
  ["Anna", "de-DE"],
  ["Bad News", "en-US"],
  ["Bahh", "en-US"],
  ["Bells", "en-US"],
  ["Boing", "en-US"],
  ["Bubbles", "en-US"],
  ["Carmit", "he-IL"],
  ["Cellos", "en-US"],
  ["Damayanti", "id-ID"],
  ["Daniel", "en-GB"],
  ["Daria", "sv-SE"],
  ["Ellen", "nl-BE"],
  ["Fred", "en-US"],
  ["Geeta", "en-IN"],
  ["Good News", "en-US"],
  ["Ioana", "ro-RO"],
  ["Jester", "en-US"],
  ["Joana", "pt-PT"],
  ["Junior", "en-US"],
  ["Kanya", "th-TH"],
  ["Karen", "en-AU"],
  ["Kathy", "en-US"],
  ["Kyoko", "ja-JP"],
  ["Lana", "ru-RU"],
  ["Laura", "sk-SK"],
  ["Lekha", "hi-IN"],
].map(([name, lang], index) => ({
  name, lang, default: index === 0, localService: true,
  voiceURI: name,
}));
function _speechSynthesisVoices() {
  return _SPEECH_VOICES.slice();
}

function _makeSpeechSynthesis() {
  return {
    [Symbol.toStringTag]: 'SpeechSynthesis',
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

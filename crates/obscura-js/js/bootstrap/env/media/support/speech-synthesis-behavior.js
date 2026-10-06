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
    // onvoiceschanged is a SpeechSynthesis.prototype accessor (installed in
    // speech-synthesis.js), not an own property -- the reference prototype
    // answers `'onvoiceschanged' in SpeechSynthesis.prototype` with true.
  };
}

// The utterance keeps its state behind one symbol slot: WebIDL puts every
// interface member on the prototype as an accessor, so an instance of the
// reference interface answers `Object.getOwnPropertyNames(u)` with nothing
// and `Object.getOwnPropertyNames(SpeechSynthesisUtterance.prototype)` with
// the 13 members + constructor (measured 149: prototype 14). Values that
// live per instance read and write through this slot.
const _speechUtteranceSlot = Symbol('utteranceState');
function _speechUtteranceInitialize(utterance, text) {
  // The defaults a fresh `new SpeechSynthesisUtterance()` reports on the
  // reference browser: voice null, lang "" (the locale resolution happens at
  // speak() time, not at construction), 1/1/1 prosody, and every Blink event
  // handler present and null.
  utterance[_speechUtteranceSlot] = {
    voice: null,
    lang: '',
    text: text === undefined ? '' : String(text),
    rate: 1,
    pitch: 1,
    volume: 1,
    onstart: null, onend: null, onerror: null, onmark: null,
    onboundary: null, onpause: null, onresume: null,
  };
}
function _speechUtteranceState(utterance) {
  return utterance[_speechUtteranceSlot]
    || _speechUtteranceInitialize(utterance, undefined)[_speechUtteranceSlot];
}
// The interface member list, in the order the reference prototype carries
// them: the six attributes, then the seven Blink event handlers.
const _SPEECH_UTTERANCE_MEMBERS = [
  ['text', String],
  ['lang', String],
  ['voice', value => value === undefined ? null : value],
  ['volume', Number],
  ['rate', Number],
  ['pitch', Number],
  ['onstart', null], ['onend', null], ['onerror', null], ['onmark', null],
  ['onboundary', null], ['onpause', null], ['onresume', null],
];
function _installUtteranceMembers(klass) {
  for (const [name, convert] of _SPEECH_UTTERANCE_MEMBERS) {
    const descriptor = convert === null
      ? {
          get() { return _speechUtteranceState(this)[name]; },
          set(value) { _speechUtteranceState(this)[name] = typeof value === 'function' ? value : null; },
        }
      : {
          get() { return _speechUtteranceState(this)[name]; },
          set(value) { _speechUtteranceState(this)[name] = convert(value); },
        };
    Object.defineProperty(klass.prototype, name, { ...descriptor, enumerable: true, configurable: true });
  }
}

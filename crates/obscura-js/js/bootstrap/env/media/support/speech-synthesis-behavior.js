// Speech synthesis is intentionally a no-op host service.  Keep its state and
// voice list in one behavior helper; speech-synthesis.js only installs the
// browser-facing shape.
// The reference macOS host (zh-CN system) lists Tingting first, then the
// system voices in Chrome's fixed order. A Windows/Google table on a macOS
// fingerprint is wrong on both name and count.
// Measured against the host's Chrome 149 (getVoices() with names, langs and
// order dumped per row): 68 voices, all localService, Tingting default. The
// challenge payload reports both the raw count (reference 68) and the sorted
// first 32 names, so the count itself is a consumed fingerprint field. The
// earlier 32-row table also carried five languages shifted between rows
// (Alva sv-SE not pt-BR, Amira ms-MY not ar-001, Daria bg-BG not sv-SE,
// Geeta te-IN not en-IN, Lana hr-HR not ru-RU).
const _SPEECH_VOICES = [
  ["婷婷", "zh-CN"],
  ["Albert", "en-US"],
  ["Alice", "it-IT"],
  ["Alva", "sv-SE"],
  ["Amélie", "fr-CA"],
  ["Amira", "ms-MY"],
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
  ["Daria", "bg-BG"],
  ["Ellen", "nl-BE"],
  ["Fred", "en-US"],
  ["Geeta", "te-IN"],
  ["Good News", "en-US"],
  ["Ioana", "ro-RO"],
  ["Jester", "en-US"],
  ["Joana", "pt-PT"],
  ["Junior", "en-US"],
  ["Kanya", "th-TH"],
  ["Karen", "en-AU"],
  ["Kathy", "en-US"],
  ["Kyoko", "ja-JP"],
  ["Lana", "hr-HR"],
  ["Laura", "sk-SK"],
  ["Lekha", "hi-IN"],
  ["Lesya", "uk-UA"],
  ["Linh", "vi-VN"],
  ["Luciana", "pt-BR"],
  ["Majed", "ar-001"],
  ["Melina", "el-GR"],
  ["Milena", "ru-RU"],
  ["Moira", "en-IE"],
  ["Montse", "ca-ES"],
  ["Mónica", "es-ES"],
  ["Nora", "nb-NO"],
  ["Organ", "en-US"],
  ["Paulina", "es-MX"],
  ["Piya", "bn-IN"],
  ["Ralph", "en-US"],
  ["Rishi", "en-IN"],
  ["Samantha", "en-US"],
  ["Sara", "da-DK"],
  ["Satu", "fi-FI"],
  ["Soumya", "kn-IN"],
  ["Superstar", "en-US"],
  ["Tessa", "en-ZA"],
  ["Thomas", "fr-FR"],
  ["Tina", "sl-SI"],
  ["Trinoids", "en-US"],
  ["Tünde", "hu-HU"],
  ["Vani", "ta-IN"],
  ["Whisper", "en-US"],
  ["Wobble", "en-US"],
  ["Xander", "nl-NL"],
  ["Yelda", "tr-TR"],
  ["Yuna", "ko-KR"],
  ["Zarvox", "en-US"],
  ["Zosia", "pl-PL"],
  ["Zuzana", "cs-CZ"],
  ["善怡", "yue-HK"],
  ["美嘉", "zh-TW"],
].map(([name, lang], index) => ({
  name, lang, default: index === 0, localService: true,
  voiceURI: name,
}));
function _speechSynthesisVoices() {
  return _SPEECH_VOICES.slice();
}

// Moves the SpeechSynthesis surface from the instance to the interface
// prototype: Chromium 149 answers [] to instance own-key reflection -- every
// member (methods and the tri-state flags as get-accessors over the no-op
// host state) lives on SpeechSynthesis.prototype (census P0-4). Idempotent.
function _installSpeechSynthesisPrototypeMembers(synth) {
  const proto = globalThis.SpeechSynthesis && globalThis.SpeechSynthesis.prototype;
  if (!proto) return false;
  if (!Object.prototype.hasOwnProperty.call(proto, 'getVoices')) {
    // RE-149 oracle: the reference environment answers an empty voice list
    // (cold headless profile; the 68-row host table is reversed/superseded).
    proto.getVoices = _markNativeAs(function getVoices() { return []; },
      'function getVoices() { [native code] }');
    proto.speak = _markNativeAs(function speak() {}, 'function speak() { [native code] }');
    proto.cancel = _markNativeAs(function cancel() {}, 'function cancel() { [native code] }');
    proto.pause = _markNativeAs(function pause() {}, 'function pause() { [native code] }');
    proto.resume = _markNativeAs(function resume() {}, 'function resume() { [native code] }');
    for (const flag of ['speaking', 'pending', 'paused']) {
      Object.defineProperty(proto, flag, {
        get: _markNativeAs(function get() { return false; },
          'function get ' + flag + '() { [native code] }'),
        configurable: true, enumerable: true,
      });
    }
  }
  for (const member of ['getVoices', 'speak', 'cancel', 'pause', 'resume',
      'speaking', 'pending', 'paused', 'addEventListener',
      'removeEventListener']) {
    try { delete synth[member]; } catch (_error) {}
  }
  return true;
}

function _makeSpeechSynthesis() {
  // Chromium 149: the SpeechSynthesis instance answers [] to own-key
  // reflection -- every member lives on the interface prototype, with the
  // tri-state members as prototype get-accessors over the no-op host state
  // (census P0-4). The on* handler surface is installed by
  // speech-synthesis.js alongside onvoiceschanged.
  const synth = {};
  synth[Symbol.toStringTag] = 'SpeechSynthesis';
  synth.speaking = false;
  synth.pending = false;
  synth.paused = false;
  synth.getVoices = function getVoices() { return _speechSynthesisVoices(); };
  synth.speak = function speak() {};
  synth.cancel = function cancel() {};
  synth.pause = function pause() {};
  synth.resume = function resume() {};
  synth.addEventListener = function addEventListener() {};
  synth.removeEventListener = function removeEventListener() {};
  return synth;
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

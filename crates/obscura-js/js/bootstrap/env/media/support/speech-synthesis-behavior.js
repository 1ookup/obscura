// Speech synthesis is intentionally a no-op host service.  Keep its state and
// voice list in one behavior helper; speech-synthesis.js only installs the
// browser-facing shape.
// Chrome on Windows exposes the Microsoft platform voices plus its own
// network voices; a single-entry list is the headless shape. The set below
// mirrors a plain en-US Windows install.
const _SPEECH_VOICES = [
  ['Microsoft Paul - English (United States)', 'en-US'],
  ['Microsoft Zira - English (United States)', 'en-US'],
  ['Microsoft David - English (United States)', 'en-US'],
  ['Microsoft Mark - English (United States)', 'en-US'],
  ['Google UK English Female', 'en-GB'],
  ['Google UK English Male', 'en-GB'],
  ['Google US English', 'en-US'],
  ['Google हिन्दी', 'hi-IN'],
  ['Google Bahasa Indonesia', 'id-ID'],
  ['Google italiano', 'it-IT'],
  ['Google 日本語', 'ja-JP'],
  ['Google 한국의', 'ko-KR'],
  ['Google Nederlands', 'nl-NL'],
  ['Google polski', 'pl-PL'],
  ['Google português do Brasil', 'pt-BR'],
  ['Google русский', 'ru-RU'],
  ['Google 普通话（中国大陆）', 'zh-CN'],
  ['Google 粤語（香港）', 'zh-HK'],
  ['Google 台灣國語', 'zh-TW'],
  ['Google français', 'fr-FR'],
  ['Google Deutsch', 'de-DE'],
].map(([name, lang], index) => ({
  name, lang, default: index === 6, localService: index < 4,
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

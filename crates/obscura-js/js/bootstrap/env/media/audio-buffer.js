// AudioBuffer interface shape.  Storage and copy algorithms are in
// support/audio-context-behavior.js.
globalThis.AudioBuffer = class AudioBuffer {
  constructor(options) { _audioBufferInitialize(this, options); }
  getChannelData(channel) { return _audioBufferChannelData(this, channel); }
  copyFromChannel(destination, channel, start) {
    return _audioBufferCopyFromChannel(this, destination, channel, start);
  }
  copyToChannel(source, channel, start) {
    return _audioBufferCopyToChannel(this, source, channel, start);
  }
};

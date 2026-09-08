// Web Audio behavior.  These helpers intentionally remain inert and CPU-only:
// they preserve the existing fingerprinted values without opening a device or
// touching the renderer/audio host.
function _audioBufferInitialize(buffer, options) {
  const opts = (typeof options === 'object' && options !== null) ? options : {};
  buffer.numberOfChannels = opts.numberOfChannels || 1;
  buffer.length = opts.length || 0;
  buffer.sampleRate = opts.sampleRate || 44100;
  buffer.duration = buffer.length / (buffer.sampleRate || 44100);
  buffer._chs = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    buffer._chs.push(new Float32Array(buffer.length));
  }
}
function _audioBufferChannelData(buffer, channel) {
  return buffer._chs[channel] || buffer._chs[0] || new Float32Array(0);
}
function _audioBufferCopyFromChannel(buffer, destination, channel, start) {
  const source = buffer._chs[channel] || buffer._chs[0];
  start = start || 0;
  for (let index = 0; index < destination.length; index++) {
    destination[index] = (source && source[start + index]) || 0;
  }
}
function _audioBufferCopyToChannel(buffer, source, channel, start) {
  const destination = buffer._chs[channel] || buffer._chs[0];
  start = start || 0;
  if (destination) {
    for (let index = 0; index < source.length; index++) {
      destination[start + index] = source[index];
    }
  }
}

function _audioParam(value, min = -3.4028235e38, max = 3.4028235e38) {
  return {
    value,
    defaultValue: value,
    minValue: min,
    maxValue: max,
    setValueAtTime() {},
  };
}

function _audioContextInitialize(context) {
  context.sampleRate = _fp('audioSampleRate');
  context.state = 'running';
  context.currentTime = 0;
  context.baseLatency = _fp('audioBaseLatency');
  context.destination = {
    maxChannelCount: 2,
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 2,
  };
  context._listeners = {};
}
function _audioContextAddEventListener(context, type, callback) {
  if (!context._listeners[type]) context._listeners[type] = [];
  context._listeners[type].push(callback);
}
function _audioContextRemoveEventListener(context, type, callback) {
  if (context._listeners[type]) {
    context._listeners[type] = context._listeners[type].filter(handler => handler !== callback);
  }
}
function _audioContextCreateOscillator(context) {
  return {
    context,
    type: 'sine',
    frequency: _audioParam(440, -22050, 22050),
    detune: _audioParam(0, -153600, 153600),
    connect() {}, start() {}, stop() {}, disconnect() {},
    addEventListener() {}, removeEventListener() {},
  };
}
function _audioContextCreateDynamicsCompressor(context) {
  return {
    context,
    threshold: _audioParam(_fp('compThreshold'), -100, 0),
    knee: _audioParam(_fp('compKnee'), 0, 40),
    ratio: _audioParam(_fp('compRatio'), 1, 20),
    attack: _audioParam(0.003, 0, 1),
    release: _audioParam(0.25, 0, 1),
    reduction: 0,
    connect() {}, disconnect() {},
  };
}
function _audioContextCreateAnalyser(context) {
  return {
    context,
    fftSize: 2048,
    frequencyBinCount: 1024,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    maxDecibels: -30,
    minDecibels: -100,
    numberOfInputs: 1,
    numberOfOutputs: 1,
    smoothingTimeConstant: 0.8,
    connect() {}, disconnect() {},
    getByteFrequencyData(array) {
      for (let index = 0; index < array.length; index++) {
        array[index] = Math.floor(_fpRand(600 + index) * 10);
      }
    },
    getFloatFrequencyData(array) {
      for (let index = 0; index < array.length; index++) {
        array[index] = -100 + _fpRand(700 + index) * 5;
      }
    },
  };
}
function _audioContextCreateGain(context) {
  return {context, gain: _audioParam(1), connect() {}, disconnect() {}};
}
function _audioContextCreateBiquadFilter(context) {
  return {
    context,
    type: 'lowpass',
    frequency: _audioParam(350, 0, 22050),
    Q: _audioParam(1, 0.0001, 1000),
    gain: _audioParam(0, -40, 40),
    connect() {}, disconnect() {},
  };
}
function _audioContextCreateBufferSource(context) {
  return {
    context,
    buffer: null,
    connect() {}, start() {}, stop() {}, disconnect() {}, loop: false,
  };
}
function _audioContextCreateBuffer(context, channels, length, sampleRate) {
  return new globalThis.AudioBuffer({
    numberOfChannels: channels || 1,
    length: length || 0,
    sampleRate: sampleRate || 44100,
  });
}
function _audioContextCreateScriptProcessor() {
  return {connect() {}, disconnect() {}, onaudioprocess: null};
}
function _audioContextDecodeAudioData(context) {
  return Promise.resolve(_audioContextCreateBuffer(context, 2, 44100, 44100));
}
function _audioContextResume(context) { context.state = 'running'; return Promise.resolve(); }
function _audioContextSuspend(context) { context.state = 'suspended'; return Promise.resolve(); }
function _audioContextClose(context) { context.state = 'closed'; return Promise.resolve(); }

function _offlineAudioInitialize(context, channelsOrOptions, length, sampleRate) {
  if (typeof channelsOrOptions === 'object' && channelsOrOptions !== null) {
    context.length = channelsOrOptions.length || 44100;
    context.sampleRate = channelsOrOptions.sampleRate || 44100;
  } else {
    context.length = length || 44100;
    context.sampleRate = sampleRate || 44100;
  }
  context.oncomplete = null;
}
function _offlineAudioStartRendering(context) {
  const buffer = _audioContextCreateBuffer(context, 1, context.length, 44100);
  const data = buffer.getChannelData(0);
  // Match the deterministic compressed triangle-wave summary used by the
  // previous implementation while leaving all rendering and Rust bridges out.
  const target = 124.04347527516074 + (_fpRand(9991) - 0.5) * 0.002;
  const frequency = 10000;
  const sampleRate = 44100;
  for (let index = 0; index < context.length; index++) {
    const phase = ((index * frequency / sampleRate) % 1 + 1) % 1;
    data[index] = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
  }
  let sum = 0;
  for (let index = 4500; index < 5000; index++) sum += Math.abs(data[index]);
  const scale = sum > 0 ? target / sum : 0;
  for (let index = 0; index < context.length; index++) data[index] *= scale;
  return Promise.resolve().then(() => {
    const event = {renderedBuffer: buffer, target: context, type: 'complete'};
    if (typeof context.oncomplete === 'function') {
      try { context.oncomplete(event); } catch (_error) {}
    }
    const listeners = (context._listeners && context._listeners.complete) || [];
    for (const listener of listeners) {
      try { listener(event); } catch (_error) {}
    }
    return buffer;
  });
}

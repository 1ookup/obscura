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

// Graph plumbing for the offline renderer. Node objects stay inert stubs to
// probes (no new enumerable own properties); connectivity, start state and
// per-node DSP state live in this side table.
const _audioGraph = new WeakMap();

// The published interface classes are shells; the factory objects below are
// plain objects. Linking the class prototype chain and binding each instance
// to its interface prototype makes `instanceof` and inherited-member probes
// read like Chrome without changing any behavior (methods stay own/ownable).
(function _linkAudioInterfaceChain() {
  try {
    const link = (child, parent) => {
      if (typeof globalThis[child] === 'function' && typeof globalThis[parent] === 'function'
          && Object.getPrototypeOf(globalThis[child].prototype) !== globalThis[parent].prototype) {
        Object.setPrototypeOf(globalThis[child].prototype, globalThis[parent].prototype);
      }
    };
    link('AudioScheduledSourceNode', 'AudioNode');
    link('OscillatorNode', 'AudioScheduledSourceNode');
    link('GainNode', 'AudioNode');
    link('DynamicsCompressorNode', 'AudioNode');
    link('AudioBufferSourceNode', 'AudioNode');
    link('AnalyserNode', 'AudioNode');
    link('AudioContext', 'BaseAudioContext');
    link('OfflineAudioContext', 'BaseAudioContext');
  } catch (_error) {}
})();
function _bindInterface(node, className) {
  try {
    if (typeof globalThis[className] === 'function') {
      Object.setPrototypeOf(node, globalThis[className].prototype);
    }
  } catch (_error) {}
  return node;
}
function _audioNodeState(node, create) {
  let state = _audioGraph.get(node);
  if (!state && create) {
    state = { inputs: [], started: false, buffer: null, detector: 0, phase: 0 };
    _audioGraph.set(node, state);
  }
  return state || { inputs: [], started: false, buffer: null, detector: 0, phase: 0 };
}
function _audioConnect(node, destination) {
  if (destination && typeof destination === 'object') {
    _audioNodeState(destination, true).inputs.push(node);
  }
  return destination;
}
function _audioDisconnect(node, destination) {
  const state = _audioNodeState(destination || node, false);
  if (destination) {
    state.inputs = state.inputs.filter(source => source !== node);
  } else {
    _audioNodeState(node, false).inputs.length = 0;
  }
}
function _audioStart(node, when) {
  const state = _audioNodeState(node, true);
  state.started = true;
  state.startTime = Number(when) || 0;
}
function _audioStop(node) {
  _audioNodeState(node, true).started = false;
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
  return _bindInterface({
    context,
    type: 'sine',
    frequency: _audioParam(440, -22050, 22050),
    detune: _audioParam(0, -153600, 153600),
    connect(destination) { return _audioConnect(this, destination); },
    disconnect(destination) { _audioDisconnect(this, destination); },
    start(when) { _audioStart(this, when); },
    stop(when) { _audioStop(this, when); },
    addEventListener() {}, removeEventListener() {},
  }, 'OscillatorNode');
}
function _audioContextCreateDynamicsCompressor(context) {
  return _bindInterface({
    context,
    threshold: _audioParam(-24, -100, 0),
    knee: _audioParam(30, 0, 40),
    ratio: _audioParam(12, 1, 20),
    attack: _audioParam(0.003, 0, 1),
    release: _audioParam(0.25, 0, 1),
    reduction: 0,
    connect(destination) { return _audioConnect(this, destination); },
    disconnect(destination) { _audioDisconnect(this, destination); },
  }, 'DynamicsCompressorNode');
}
function _audioContextCreateAnalyser(context) {
  return _bindInterface({
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
  }, 'AnalyserNode');
}
function _audioContextCreateGain(context) {
  return _bindInterface({
    context,
    gain: _audioParam(1),
    connect(destination) { return _audioConnect(this, destination); },
    disconnect(destination) { _audioDisconnect(this, destination); },
  }, 'GainNode');
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
  return _bindInterface({
    context,
    buffer: null,
    loop: false,
    connect(destination) { return _audioConnect(this, destination); },
    disconnect(destination) { _audioDisconnect(this, destination); },
    start(when) { _audioStart(this, when); },
    stop(when) { _audioStop(this, when); },
  }, 'AudioBufferSourceNode');
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
// Oscillator waveforms, Web Audio spec shapes.
function _oscillatorSample(node, index, sampleRate) {
  const frequency = (node.frequency && Number(node.frequency.value)) || 440;
  const detune = (node.detune && Number(node.detune.value)) || 0;
  const hz = frequency * Math.pow(2, detune / 1200);
  const state = _audioNodeState(node, false);
  state.phase = (index * hz / sampleRate) % 1;
  const t = state.phase;
  switch (node.type) {
    case 'square': return t < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * (t - Math.floor(t + 0.5));
    case 'triangle': {
      const x = Math.abs(2 * t - 1);
      return 2 * x - 1;
    }
    case 'custom': return 0;
    default: return Math.sin(2 * Math.PI * t);
  }
}

// DynamicsCompressor per the Web Audio spec: peak-detector envelope in
// linear space, soft-knee curve in dB, fixed makeup gain. The curve blends
// slope 1 at the threshold into slope 1/ratio at the knee end:
//   y = theta + kappa * (t + (1/rho - 1) * t^2),  t = (x - theta) / kappa
function _compressorSample(node, input, sampleRate) {
  const threshold = (node.threshold && Number(node.threshold.value)) || -24;
  const knee = (node.knee && Number(node.knee.value)) || 30;
  const ratio = (node.ratio && Number(node.ratio.value)) || 12;
  const attack = (node.attack && Number(node.attack.value)) || 0.003;
  const release = (node.release && Number(node.release.value)) || 0.25;
  const state = _audioNodeState(node, true);
  const attackCoef = Math.exp(-1 / (Math.max(attack, 1e-6) * sampleRate));
  const releaseCoef = Math.exp(-1 / (Math.max(release, 1e-6) * sampleRate));
  const magnitude = Math.abs(input);
  const coef = magnitude > state.detector ? attackCoef : releaseCoef;
  state.detector = coef * state.detector + (1 - coef) * magnitude;
  const xDb = 20 * Math.log10(state.detector || 1e-9);
  let yDb;
  if (xDb <= threshold) {
    yDb = xDb;
  } else if (xDb >= threshold + knee) {
    yDb = threshold + (xDb - threshold) / ratio;
  } else {
    const t = (xDb - threshold) / knee;
    yDb = threshold + knee * (t + (1 / ratio - 1) * t * t);
  }
  const reduction = yDb - xDb;
  node.reduction = reduction;
  // Chrome's fixed makeup gain for the linear region's end:
  // -(threshold + knee/2) / ratio in dB.
  const makeupDb = -(threshold + knee / 2) / ratio;
  const makeup = Math.pow(10, makeupDb / 20);
  return input * Math.pow(10, reduction / 20) * makeup;
}

function _renderAudioGraphSample(node, index, sampleRate, cache) {
  if (cache.has(node)) return cache.get(node);
  let value = 0;
  const state = _audioNodeState(node, false);
  if (node.type !== undefined && node.frequency && state.started) {
    value += _oscillatorSample(node, index, sampleRate);
  } else if (node.buffer && state.started) {
    const chs = node.buffer._chs || [];
    const channel = chs[0];
    if (channel && index < channel.length) value += channel[index];
  }
  for (const source of state.inputs) {
    value += _renderAudioGraphSample(source, index, sampleRate, cache);
  }
  if (node.gain && node.gain.value !== undefined && state.inputs.length) {
    value *= Number(node.gain.value);
  }
  if (node.threshold && node.ratio && node.attack) {
    value = _compressorSample(node, value, sampleRate);
  }
  cache.set(node, value);
  return value;
}

function _offlineAudioStartRendering(context) {
  const sampleRate = context.sampleRate || 44100;
  const buffer = _audioContextCreateBuffer(context, 1, context.length, sampleRate);
  const data = buffer.getChannelData(0);
  // Render the actual connected graph: sources through gains and
  // DynamicsCompressors into the destination. A context whose graph never
  // reaches the destination renders silence, exactly like the spec.
  const destination = context.destination;
  const destinationState = destination ? _audioNodeState(destination, false) : { inputs: [] };
  if (destinationState.inputs.length) {
    for (let index = 0; index < context.length; index++) {
      const perSample = new Map();
      data[index] = _renderAudioGraphSample(destination, index, sampleRate, perSample);
    }
  }
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

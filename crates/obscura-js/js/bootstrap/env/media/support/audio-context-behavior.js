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

// A parameter assignment carries a time, not just a value: the renderer
// schedules a setValueAtTime at the context's current position, and a parameter
// with an event still ahead of the render position is processed per sample.
function _audioParamFrame(context) {
  if (!context) return 0;
  if (typeof context._audioRenderFrame === 'number') return context._audioRenderFrame;
  return Math.round((Number(context.currentTime) || 0) * (Number(context.sampleRate) || 44100));
}

function _audioParam(value, min = -3.4028235e38, max = 3.4028235e38, context = null) {
  // An AudioParam is its own interface, so a probe reading the prototype of a
  // filter's `frequency` gets `[object AudioParam]`, not a bare object.
  let current = Number(value);
  const param = _bindInterface({
    defaultValue: value,
    minValue: min,
    maxValue: max,
    setValueAtTime() {},
  }, 'AudioParam');
  Object.defineProperty(param, 'value', {
    enumerable: true,
    configurable: true,
    get() { return current; },
    set(next) {
      current = Number(next);
      _audioDspNoteParamSet(param, _audioParamFrame(context));
    },
  });
  return param;
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
    state = {
      inputs: [],
      started: false,
      buffer: null,
      detector: 0,
      phase: 0,
      virtualReadIndex: 0,
      sampleRate: 0,
    };
    _audioGraph.set(node, state);
  }
  return state || {
    inputs: [],
    started: false,
    buffer: null,
    detector: 0,
    phase: 0,
    virtualReadIndex: 0,
    sampleRate: 0,
  };
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
  context.destination = _bindInterface({
    maxChannelCount: 2,
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 2,
  }, 'AudioDestinationNode');
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
    frequency: _audioParam(440, -22050, 22050, context),
    detune: _audioParam(0, -153600, 153600, context),
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
    threshold: _audioParam(-24, -100, 0, context),
    knee: _audioParam(30, 0, 40, context),
    ratio: _audioParam(12, 1, 20, context),
    attack: _audioParam(0.003, 0, 1, context),
    release: _audioParam(0.25, 0, 1, context),
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
    // An analyser with no live source reads back silence. Chrome fills the
    // time-domain views with exactly that: zeros for the float form and the
    // 128 midpoint for the byte form. Omitting the two methods entirely made
    // a probe that analyses a rendered buffer throw on the first call.
    getFloatTimeDomainData(array) {
      for (let index = 0; index < array.length; index++) array[index] = 0;
    },
    getByteTimeDomainData(array) {
      for (let index = 0; index < array.length; index++) array[index] = 128;
    },
  }, 'AnalyserNode');
}
function _audioContextCreateGain(context) {
  return _bindInterface({
    context,
    gain: _audioParam(1, -3.4028235e38, 3.4028235e38, context),
    connect(destination) { return _audioConnect(this, destination); },
    disconnect(destination) { _audioDisconnect(this, destination); },
  }, 'GainNode');
}
function _audioContextCreateBiquadFilter(context) {
  return _bindInterface({
    context,
    type: 'lowpass',
    frequency: _audioParam(350, 0, 22050, context),
    Q: _audioParam(1, 0.0001, 1000, context),
    gain: _audioParam(0, -40, 40, context),
    connect() {}, disconnect() {},
  }, 'BiquadFilterNode');
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
    context.numberOfChannels = channelsOrOptions.numberOfChannels || 1;
    context.length = channelsOrOptions.length || 44100;
    context.sampleRate = channelsOrOptions.sampleRate || 44100;
  } else {
    context.numberOfChannels = channelsOrOptions || 1;
    context.length = length || 44100;
    context.sampleRate = sampleRate || 44100;
  }
  // An offline context is suspended until its graph is rendered, and the
  // destination's channel count is the context's.
  context.state = 'suspended';
  context.destination.channelCount = context.numberOfChannels;
  context.destination.maxChannelCount = context.numberOfChannels;
  context.oncomplete = null;
}

function _offlineAudioStartRendering(context) {
  const sampleRate = context.sampleRate || 44100;
  const buffer = _audioContextCreateBuffer(context, context.numberOfChannels || 1,
    context.length, sampleRate);
  context.state = 'running';
  // Render the connected graph into the buffer. A context whose graph never
  // reaches the destination renders silence, exactly like the spec.
  _audioDspRenderOffline(context, buffer, node => _audioNodeState(node, true));
  return Promise.resolve().then(() => {
    context.state = 'closed';
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

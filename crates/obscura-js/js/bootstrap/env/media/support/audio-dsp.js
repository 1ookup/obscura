// Offline Web Audio rendering.  An OfflineAudioContext renders a graph and a
// page reads the samples back, so the numbers are the fingerprint: the
// oscillator's band-limited wave tables, the compressor's soft-knee curve and
// look-ahead delay line, and the channel mixing all have to be the same
// functions of the parameters Chrome computes, not merely similar.
//
// Everything here runs in the f32 arithmetic the C++ renderer uses; the
// `_audioDspF32` wrappers are float roundings, not decoration.
const _audioDspTwoPi = Math.PI * 2;
const _audioDspHalfPi = Math.PI / 2;

// PeriodicWave: three bands per octave, table sizes chosen from the rate.
const _audioDspOctaveBands = 3;
const _audioDspCentsPerRange = 1200 / _audioDspOctaveBands;
const _audioDspMaxPeriodicWaveSize = 16384;

// DynamicsCompressor constants.
const _audioDspMeteringReleaseTimeConstant = 0.325;
const _audioDspPreDelaySeconds = 0.006;
const _audioDspMaxPreDelayFrames = 1024;
const _audioDspDefaultPreDelayFrames = 256;
const _audioDspSatReleaseTime = 0.0025;
const _audioDspDivisionFrames = 32;
const _audioDspReleaseZones = [0.09, 0.16, 0.42, 0.98];

function _audioDspF32(value) {
  return Math.fround(value);
}

function _audioDspRoundHalfEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return (floor % 2) ? floor + 1 : floor;
}

// The adaptive release curve is a 4th order polynomial through four points of
// the release zones.  The zone values are folded into coefficients with float
// expressions, and the rounding of each product is part of the result, so the
// same order is kept here.
const _audioDspReleaseCurve = (function () {
  const zone = _audioDspReleaseZones;
  const term = (coefficient, value) => _audioDspF32(_audioDspF32(coefficient) * _audioDspF32(value));
  const a = _audioDspF32(_audioDspF32(term(0.9999999999999998, zone[0]) + term(1.8432219684323923e-16, zone[1]))
    - _audioDspF32(term(1.9373394351676423e-16, zone[2])) + term(8.824516011816245e-18, zone[3]));
  const b = _audioDspF32(_audioDspF32(-term(1.5788320352845888, zone[0]) + term(2.3305837032074286, zone[1]))
    - _audioDspF32(term(0.9141194204840429, zone[2])) + term(0.1623677525612032, zone[3]));
  const c = _audioDspF32(_audioDspF32(term(0.5334142869106424, zone[0]) - term(1.272736789213631, zone[1]))
    + _audioDspF32(term(0.9258856042207512, zone[2])) - term(0.18656310191776226, zone[3]));
  const d = _audioDspF32(_audioDspF32(term(0.08783463138207234, zone[0]) - term(0.1694162967925622, zone[1]))
    + _audioDspF32(term(0.08588057951595272, zone[2])) - term(0.00429891410546283, zone[3]));
  const e = _audioDspF32(_audioDspF32(-term(0.042416883008123074, zone[0]) + term(0.1115693827987602, zone[1]))
    - _audioDspF32(term(0.09764676325265872, zone[2])) + term(0.028494263462021576, zone[3]));
  return { a, b, c, d, e };
})();

function _audioDspDecibelsToLinear(decibels) {
  return _audioDspF32(Math.pow(10, _audioDspF32(_audioDspF32(0.05) * _audioDspF32(decibels))));
}

function _audioDspLinearToDecibels(linear) {
  return _audioDspF32(_audioDspF32(20) * _audioDspF32(Math.log10(_audioDspF32(linear))));
}

function _audioDspDiscreteTimeConstant(timeConstant, sampleRate) {
  return _audioDspF32(1 - Math.exp(-1 / (timeConstant * sampleRate)));
}

// ---------------------------------------------------------------------------
// PeriodicWave
// ---------------------------------------------------------------------------

// Twiddle factors for the in-place radix-2 transform, one table per size.
function _audioDspTwiddles(size) {
  if (!_audioDspTwiddles._cache) _audioDspTwiddles._cache = new Map();
  let table = _audioDspTwiddles._cache.get(size);
  if (!table) {
    const half = size >> 1;
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const angle = _audioDspTwoPi * i / size;
      cos[i] = Math.cos(angle);
      sin[i] = Math.sin(angle);
    }
    table = { cos, sin };
    _audioDspTwiddles._cache.set(size, table);
  }
  return table;
}

// In-place complex transform.  `inverse` selects the e^{+i theta} kernel; the
// caller keeps the size scaling, matching the renderer's pre-scaled
// coefficients.
function _audioDspFft(real, imag, inverse) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const swapReal = real[i]; real[i] = real[j]; real[j] = swapReal;
      const swapImag = imag[i]; imag[i] = imag[j]; imag[j] = swapImag;
    }
  }
  const twiddles = _audioDspTwiddles(size);
  for (let length = 2; length <= size; length <<= 1) {
    const step = size / length;
    const half = length >> 1;
    for (let start = 0; start < size; start += length) {
      for (let k = 0; k < half; k++) {
        const index = k * step;
        const wr = twiddles.cos[index];
        const wi = inverse ? twiddles.sin[index] : -twiddles.sin[index];
        const second = start + k + half;
        const xr = real[second] * wr - imag[second] * wi;
        const xi = real[second] * wi + imag[second] * wr;
        real[second] = real[start + k] - xr;
        imag[second] = imag[start + k] - xi;
        real[start + k] += xr;
        imag[start + k] += xi;
      }
    }
  }
}

function _audioDspPeriodicWaveSize(sampleRate) {
  if (sampleRate <= 24000) return 2048;
  if (sampleRate <= 88200) return 4096;
  return _audioDspMaxPeriodicWaveSize;
}

// The Fourier coefficients of the four built-in waveforms.  All of them are
// odd functions with a positive slope at time 0, so only sine coefficients are
// non-zero, and every waveform is normalised by the peak of its own first
// table.
function _audioDspFourierCoefficient(type, n) {
  const piFactor = 2 / (n * Math.PI);
  switch (type) {
    case 'square':
      return (n & 1) ? 2 * piFactor : 0;
    case 'sawtooth':
      return piFactor * ((n & 1) ? 1 : -1);
    case 'triangle':
      return (n & 1) ? 2 * (piFactor * piFactor) * ((((n - 1) >> 1) & 1) ? -1 : 1) : 0;
    default:
      return n === 1 ? 1 : 0;
  }
}

// Number of partials a pitch range keeps: three ranges per octave, each one
// culling the partials that would alias above Nyquist.
function _audioDspPartialsForRange(wave, rangeIndex) {
  const centsToCull = rangeIndex * _audioDspCentsPerRange;
  const cullingScale = Math.pow(2, -centsToCull / 1200);
  return Math.floor(cullingScale * wave.maxPartials);
}

// One band-limited table: cull the partials for this range, then take the
// inverse transform of the pre-scaled coefficients.  Bands are built on demand
// and cached; the first range is always built first because its peak is the
// scale the whole set is normalised by.
function _audioDspBuildTable(wave, rangeIndex) {
  const size = wave.size;
  const half = size / 2;
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const keep = Math.min(half, _audioDspPartialsForRange(wave, rangeIndex) + 1);
  for (let n = 1; n < keep; n++) {
    imag[n] = -_audioDspFourierCoefficient(wave.type, n) * size;
  }
  // The time-domain table is real, so the spectrum has to be conjugate
  // symmetric about the Nyquist bin, which stays cleared.
  for (let n = 1; n < half; n++) {
    real[size - n] = real[n];
    imag[size - n] = -imag[n];
  }
  _audioDspFft(real, imag, true);
  const table = new Float32Array(size);
  let peak = 0;
  for (let i = 0; i < size; i++) {
    table[i] = real[i];
    const magnitude = Math.abs(table[i]);
    if (magnitude > peak) peak = magnitude;
  }
  if (rangeIndex === 0) wave.normalizationScale = peak ? 1 / peak : 0.5;
  const scale = wave.normalizationScale;
  for (let i = 0; i < size; i++) table[i] = _audioDspF32(table[i] * scale);
  wave.tables[rangeIndex] = table;
  return table;
}

function _audioDspWaveTables(type, sampleRate) {
  if (!_audioDspWaveTables._cache) _audioDspWaveTables._cache = new Map();
  const key = type + '@' + sampleRate;
  const cached = _audioDspWaveTables._cache.get(key);
  if (cached) return cached;
  const size = _audioDspPeriodicWaveSize(sampleRate);
  const wave = {
    type,
    size,
    maxPartials: size / 2,
    lowestFundamental: (0.5 * sampleRate) / (size / 2),
    rateScale: _audioDspF32(size / sampleRate),
    numberOfRanges: Math.floor(0.5 + _audioDspOctaveBands * Math.log2(size)),
    tables: [],
    normalizationScale: 0.5,
  };
  _audioDspBuildTable(wave, 0);
  _audioDspWaveTables._cache.set(key, wave);
  return wave;
}

function _audioDspTableForRange(wave, rangeIndex) {
  const cached = wave.tables[rangeIndex];
  return cached || _audioDspBuildTable(wave, rangeIndex);
}

// The two tables bracketing a fundamental frequency and the factor that
// interpolates between them.  The range index rounds to nearest, and the pair
// is clamped to the last range.
function _audioDspWaveDataForFrequency(wave, frequency) {
  const magnitude = Math.abs(frequency);
  const ratio = magnitude > 0
    ? _audioDspF32(magnitude * _audioDspF32(1 / wave.lowestFundamental))
    : _audioDspF32(0.5);
  const cents = _audioDspF32(Math.log2(ratio) * 1200);
  let pitchRange = _audioDspF32(1 + _audioDspF32(cents * _audioDspF32(1 / _audioDspCentsPerRange)));
  pitchRange = _audioDspF32(Math.max(pitchRange, 0));
  pitchRange = _audioDspF32(Math.min(pitchRange, _audioDspF32(wave.numberOfRanges - 1)));
  const index1 = _audioDspRoundHalfEven(pitchRange);
  const index2 = Math.min(index1 + 1, wave.numberOfRanges - 1);
  return {
    lower: _audioDspTableForRange(wave, index2),
    higher: _audioDspTableForRange(wave, index1),
    factor: _audioDspF32(pitchRange - index1),
  };
}

// ---------------------------------------------------------------------------
// Oscillator
// ---------------------------------------------------------------------------

// Wrap a float32 read index back into the table.  The index is carried in
// float32 lanes across a render quantum, and that rounding is what a rendered
// buffer shows, so the wrap keeps the same shape.
function _audioDspWrapVectorIndex(value, waveSize, inverseWaveSize) {
  const ratio = _audioDspF32(value * inverseWaveSize);
  let whole = Math.trunc(ratio);
  if (ratio < whole) whole += 1;
  return _audioDspF32(value - _audioDspF32(_audioDspF32(whole) * waveSize));
}

// Assigning to an AudioParam does not only store a number: it schedules a
// setValueAtTime at the context's current time.  While that event is still
// ahead of the render position the parameter counts as sample-accurate, which
// switches the oscillator to its per-sample kernel for that quantum, and a
// value assigned before rendering starts therefore shapes the first quantum
// differently from the rest.
const _audioDspParamFrames = new WeakMap();

function _audioDspNoteParamSet(param, frame) {
  if (param && typeof param === 'object') _audioDspParamFrames.set(param, frame);
}

function _audioDspParamIsSampleAccurate(param, startFrame) {
  const frame = _audioDspParamFrames.get(param);
  return frame !== undefined && frame >= startFrame;
}

function _audioDspWrapIndex(value, size) {
  return value - Math.floor(value * (1 / size)) * size;
}

// Cast a double read index into a lane and wrap it, as the per-sample kernel
// does after computing each index from the double phase.
function _audioDspLaneFromIndex(value, waveSize, inverseWaveSize) {
  return _audioDspWrapVectorIndex(_audioDspF32(value), waveSize, inverseWaveSize);
}

function _audioDspTableSample(virtualIndex, waveData, mask) {
  const index0 = Math.trunc(virtualIndex) & mask;
  const index1 = (index0 + 1) & mask;
  const lower = waveData.lower;
  const higher = waveData.higher;
  const interpolationFactor = _audioDspF32(virtualIndex - _audioDspF32(index0));
  const sampleHigher = _audioDspF32(higher[index0]
    + _audioDspF32(interpolationFactor * _audioDspF32(higher[index1] - higher[index0])));
  const sampleLower = _audioDspF32(lower[index0]
    + _audioDspF32(interpolationFactor * _audioDspF32(lower[index1] - lower[index0])));
  return _audioDspF32(sampleHigher + _audioDspF32(waveData.factor * _audioDspF32(sampleLower - sampleHigher)));
}

// The per-sample kernel interpolates with a fused multiply-add, which rounds
// once where the k-rate kernel's separate multiply and add round twice.  Double
// arithmetic evaluates the product exactly, so one rounding reproduces it.
function _audioDspTableSampleFused(virtualIndex, waveData, mask) {
  const index0 = Math.trunc(virtualIndex) & mask;
  const index1 = (index0 + 1) & mask;
  const lower = waveData.lower;
  const higher = waveData.higher;
  const interpolationFactor = _audioDspF32(virtualIndex - _audioDspF32(index0));
  const sampleHigher = _audioDspF32(interpolationFactor * (higher[index1] - higher[index0])
    + higher[index0]);
  const sampleLower = _audioDspF32(interpolationFactor * (lower[index1] - lower[index0])
    + lower[index0]);
  return _audioDspF32(waveData.factor * (sampleLower - sampleHigher) + sampleHigher);
}

// One render quantum of a k-rate oscillator.  The phase is a double across
// quanta and four float32 lanes inside one, which is the shape of the
// vectorised kernel: it is why a tone drifts by a few ten-thousandths of a
// table entry within a quantum and snaps back at the next one.
function _audioDspOscillatorQuantum(node, state, wave, frames, output, quantumStartFrame) {
  const mask = wave.size - 1;
  const frequency = _audioDspF32((node.frequency && Number(node.frequency.value)) || 440);
  const detune = _audioDspF32((node.detune && Number(node.detune.value)) || 0);
  const scaled = _audioDspF32(frequency * _audioDspF32(Math.pow(2, _audioDspF32(detune / 1200))));
  const nyquist = _audioDspF32(state.sampleRate / 2);
  const clamped = Number.isNaN(scaled) ? nyquist : Math.min(Math.max(scaled, -nyquist), nyquist);
  const waveData = _audioDspWaveDataForFrequency(wave, clamped);
  const increment = _audioDspF32(clamped * wave.rateScale);
  const inverseWaveSize = _audioDspF32(1 / wave.size);
  const waveSize = _audioDspF32(wave.size);
  const virtualReadIndex = state.virtualReadIndex;
  let index = 0;

  if (_audioDspParamIsSampleAccurate(node.frequency, quantumStartFrame)
      || _audioDspParamIsSampleAccurate(node.detune, quantumStartFrame)) {
    // Sample-accurate parameters: the kernel recomputes each lane's index from
    // the double phase per group, so the phase does not drift inside the
    // quantum.
    const increments = [increment, 2 * increment, 3 * increment, 4 * increment];
    let phase = virtualReadIndex;
    const groups = frames >> 2;
    for (let group = 0; group < groups; group++) {
      const lanes = [
        _audioDspLaneFromIndex(phase, waveSize, inverseWaveSize),
        _audioDspLaneFromIndex(phase + increments[0], waveSize, inverseWaveSize),
        _audioDspLaneFromIndex(phase + increments[1], waveSize, inverseWaveSize),
        _audioDspLaneFromIndex(phase + increments[2], waveSize, inverseWaveSize),
      ];
      for (let lane = 0; lane < 4; lane++) {
        output[index + lane] = _audioDspTableSampleFused(lanes[lane], waveData, mask);
      }
      index += 4;
      phase = _audioDspWrapIndex(phase + increments[3], wave.size);
    }
    // The kernel keeps a double phase, so any leftover frames and the next
    // quantum both continue from it.
    for (; index < frames; index++) {
      output[index] = _audioDspTableSampleFused(_audioDspF32(phase), waveData, mask);
      phase = _audioDspWrapIndex(phase + increment, wave.size);
    }
    state.virtualReadIndex = phase;
    return output;
  }

  const fourIncrement = _audioDspF32(4 * increment);
  if (Math.abs(increment) >= 0.3) {
    const base = _audioDspF32(virtualReadIndex);
    const lanes = [
      base,
      _audioDspF32(base + _audioDspF32(1 * increment)),
      _audioDspF32(base + _audioDspF32(2 * increment)),
      _audioDspF32(base + _audioDspF32(3 * increment)),
    ];
    for (let lane = 0; lane < 4; lane++) {
      lanes[lane] = _audioDspWrapVectorIndex(lanes[lane], waveSize, inverseWaveSize);
    }
    const groups = frames >> 2;
    for (let group = 0; group < groups; group++) {
      for (let lane = 0; lane < 4; lane++) {
        output[index + lane] = _audioDspTableSample(lanes[lane], waveData, mask);
      }
      index += 4;
      for (let lane = 0; lane < 4; lane++) {
        lanes[lane] = _audioDspWrapVectorIndex(_audioDspF32(lanes[lane] + fourIncrement), waveSize,
          inverseWaveSize);
      }
    }
  }
  // Any frames past the last whole group go through the scalar interpolation,
  // which carries the index in a double.
  let tailIndex = virtualReadIndex + _audioDspF32(index * increment);
  for (let frame = index; frame < frames; frame++) {
    output[frame] = _audioDspTableSample(_audioDspF32(tailIndex), waveData, mask);
    tailIndex = _audioDspWrapIndex(tailIndex + increment, wave.size);
  }
  state.virtualReadIndex = _audioDspWrapIndex(virtualReadIndex + _audioDspF32(frames * increment),
    wave.size);
  return output;
}

// ---------------------------------------------------------------------------
// DynamicsCompressor
// ---------------------------------------------------------------------------

function _audioDspCompressorState(sampleRate) {
  return {
    sampleRate: _audioDspF32(sampleRate),
    threshold: null,
    knee: null,
    ratio: null,
    attack: null,
    release: null,
    curve: null,
    preDelay: [new Float32Array(_audioDspMaxPreDelayFrames), new Float32Array(_audioDspMaxPreDelayFrames)],
    readIndex: 0,
    writeIndex: _audioDspDefaultPreDelayFrames,
    lastPreDelayFrames: _audioDspDefaultPreDelayFrames,
    detectorAverage: _audioDspF32(0),
    compressorGain: _audioDspF32(1),
    meteringGain: _audioDspF32(1),
    maxAttackCompressionDiff: _audioDspF32(-1),
  };
}

// The soft knee is an exponential that matches the linear region in value and
// slope at the threshold and asymptotes at threshold + 1/k; the ratio region
// starts where the knee reaches the ratio line.
function _audioDspKneeCurve(state, x, k) {
  if (x < state.linearThreshold) return x;
  const distance = _audioDspF32(x - state.linearThreshold);
  const exponent = _audioDspF32(-_audioDspF32(k * distance));
  return _audioDspF32(state.linearThreshold
    + _audioDspF32(_audioDspF32(_audioDspF32(1) - _audioDspF32(Math.exp(exponent))) / k));
}

// `k` is solved for by bisection on the curve's dB slope, matching the ratio
// where the knee meets the ratio line.  The slope is measured over a 0.1%
// interval in linear terms, so the last bits of the dB arithmetic decide the
// answer and the same float32 order is kept.
function _audioDspKAtSlope(state, dbKneeThreshold, desiredSlope) {
  const x = _audioDspDecibelsToLinear(dbKneeThreshold);
  let x2 = _audioDspF32(1);
  let dbX2 = _audioDspF32(0);
  if (!(x < state.linearThreshold)) {
    x2 = _audioDspF32(x * _audioDspF32(1.001));
    dbX2 = _audioDspLinearToDecibels(x2);
  }
  let minK = _audioDspF32(0.1);
  let maxK = _audioDspF32(10000);
  let k = _audioDspF32(5);
  let slope = _audioDspF32(1);
  for (let iteration = 0; iteration < 15; iteration++) {
    if (!(x < state.linearThreshold)) {
      const dbY = _audioDspLinearToDecibels(_audioDspKneeCurve(state, x, k));
      const dbY2 = _audioDspLinearToDecibels(_audioDspKneeCurve(state, x2, k));
      slope = _audioDspF32(_audioDspF32(dbY2 - dbY) / _audioDspF32(dbX2 - dbKneeThreshold));
    }
    if (slope < desiredSlope) maxK = k;
    else minK = k;
    k = _audioDspF32(Math.sqrt(_audioDspF32(minK * maxK)));
  }
  return k;
}

function _audioDspUpdateCurve(state) {
  const dbKneeThreshold = _audioDspF32(state.threshold + state.knee);
  const kneeThreshold = _audioDspDecibelsToLinear(dbKneeThreshold);
  const k = _audioDspKAtSlope(state, dbKneeThreshold, state.slope);
  state.curve = {
    k,
    dbKneeThreshold,
    kneeThreshold,
    dbYkneeThreshold: _audioDspLinearToDecibels(_audioDspKneeCurve(state, kneeThreshold, k)),
  };
  return state.curve;
}

function _audioDspSaturate(state, value, k) {
  const x = _audioDspF32(value);
  const curve = state.curve;
  if (x < curve.kneeThreshold) return _audioDspKneeCurve(state, x, k);
  const dbX = _audioDspLinearToDecibels(x);
  const dbY = _audioDspF32(curve.dbYkneeThreshold
    + _audioDspF32(state.slope * _audioDspF32(dbX - curve.dbKneeThreshold)));
  return _audioDspDecibelsToLinear(dbY);
}

// A parameter change re-derives the curve; a steady graph keeps it.
function _audioDspCompressorPrepare(state, node) {
  const threshold = _audioDspF32((node.threshold && Number(node.threshold.value)) || -24);
  const knee = _audioDspF32((node.knee && Number(node.knee.value)) || 30);
  const ratio = _audioDspF32((node.ratio && Number(node.ratio.value)) || 12);
  const attack = _audioDspF32((node.attack && Number(node.attack.value)) || 0.003);
  const release = _audioDspF32((node.release && Number(node.release.value)) || 0.25);
  if (state.curve && state.threshold === threshold && state.knee === knee && state.ratio === ratio
      && state.attack === attack && state.release === release) {
    return state;
  }
  state.threshold = threshold;
  state.knee = knee;
  state.ratio = ratio;
  state.attack = attack;
  state.release = release;
  state.linearThreshold = _audioDspDecibelsToLinear(threshold);
  state.slope = _audioDspF32(_audioDspF32(1) / ratio);
  _audioDspUpdateCurve(state);
  return state;
}

function _audioDspSetPreDelay(state, seconds) {
  let frames = Math.trunc(seconds * state.sampleRate);
  if (frames > _audioDspMaxPreDelayFrames - 1) frames = _audioDspMaxPreDelayFrames - 1;
  if (state.lastPreDelayFrames !== frames) {
    state.lastPreDelayFrames = frames;
    state.preDelay[0].fill(0);
    state.preDelay[1].fill(0);
    state.readIndex = 0;
    state.writeIndex = frames;
  }
}

// One render quantum of the compressor.  The detector follows the *undelayed*
// input while the audio leaves through the look-ahead delay line, so the first
// pre-delay samples of a fresh compressor are always silence: the onset of a
// rendered chain is a position a page can read back.
function _audioDspCompressorQuantum(node, state, source, frames, destination) {
  _audioDspCompressorPrepare(state, node);
  const curve = state.curve;
  const k = curve.k;
  const linearPostGain = _audioDspF32(Math.pow(1 / _audioDspSaturate(state, _audioDspF32(1), k), 0.6));
  const attackFrames = _audioDspF32(_audioDspF32(Math.max(_audioDspF32(0.001), state.attack))
    * state.sampleRate);
  const releaseFrames = _audioDspF32(state.sampleRate * state.release);
  const satReleaseFrames = _audioDspF32(_audioDspF32(_audioDspSatReleaseTime) * state.sampleRate);
  const curveA = _audioDspF32(releaseFrames * _audioDspReleaseCurve.a);
  const curveB = _audioDspF32(releaseFrames * _audioDspReleaseCurve.b);
  const curveC = _audioDspF32(releaseFrames * _audioDspReleaseCurve.c);
  const curveD = _audioDspF32(releaseFrames * _audioDspReleaseCurve.d);
  const curveE = _audioDspF32(releaseFrames * _audioDspReleaseCurve.e);
  _audioDspSetPreDelay(state, _audioDspPreDelaySeconds);

  const left = source[0];
  const right = source.length > 1 ? source[1] : source[0];
  let frameIndex = 0;
  while (frameIndex < frames) {
    const detectorStart = Number.isFinite(state.detectorAverage) ? state.detectorAverage : 1;
    const scaledDesiredGain = _audioDspF32(_audioDspF32(Math.asin(detectorStart)) / _audioDspHalfPi);
    const isReleasing = scaledDesiredGain > state.compressorGain;
    let dbCompressionDiff;
    if (scaledDesiredGain === 0) {
      dbCompressionDiff = isReleasing ? -1 : 1;
    } else {
      dbCompressionDiff = _audioDspLinearToDecibels(_audioDspF32(state.compressorGain / scaledDesiredGain));
    }
    let envelopeRate;
    if (isReleasing) {
      // Release: the gain climbs back toward unity at a rate that depends on
      // how far it has been pulled down.
      state.maxAttackCompressionDiff = _audioDspF32(-1);
      let x = _audioDspF32(Math.min(Math.max(dbCompressionDiff, -12), 0));
      x = _audioDspF32(_audioDspF32(0.25) * _audioDspF32(x + 12));
      const x2 = _audioDspF32(x * x);
      const x3 = _audioDspF32(x2 * x);
      const x4 = _audioDspF32(x2 * x2);
      const releaseFramesForDiff = _audioDspF32(curveA + _audioDspF32(curveB * x)
        + _audioDspF32(curveC * x2) + _audioDspF32(curveD * x3) + _audioDspF32(curveE * x4));
      envelopeRate = _audioDspDecibelsToLinear(_audioDspF32(_audioDspF32(5) / releaseFramesForDiff));
    } else {
      // Attack: the rate follows the largest reduction seen so far in this
      // stretch of attack, which is what keeps the first transient from being
      // half-compressed.
      if (state.maxAttackCompressionDiff === _audioDspF32(-1)
          || state.maxAttackCompressionDiff < dbCompressionDiff) {
        state.maxAttackCompressionDiff = dbCompressionDiff;
      }
      const effectiveDiff = _audioDspF32(Math.max(_audioDspF32(0.5), state.maxAttackCompressionDiff));
      const x = _audioDspF32(_audioDspF32(0.25) / effectiveDiff);
      envelopeRate = _audioDspF32(1 - _audioDspF32(Math.pow(x, 1 / attackFrames)));
    }

    let readIndex = state.readIndex;
    let writeIndex = state.writeIndex;
    let detectorAverage = detectorStart;
    let compressorGain = state.compressorGain;
    const loopFrames = Math.min(_audioDspDivisionFrames, frames - frameIndex);
    for (let division = 0; division < loopFrames; division++) {
      const undelayed = left[frameIndex];
      state.preDelay[0][writeIndex] = undelayed;
      state.preDelay[1][writeIndex] = right[frameIndex];
      let compressorInput = _audioDspF32(Math.abs(undelayed));
      const otherInput = _audioDspF32(Math.abs(right[frameIndex]));
      if (compressorInput < otherInput) compressorInput = otherInput;
      const absInput = _audioDspF32(Math.abs(compressorInput));
      const shapedInput = _audioDspSaturate(state, absInput, k);
      const attenuation = absInput <= _audioDspF32(0.0001)
        ? _audioDspF32(1)
        : _audioDspF32(shapedInput / absInput);
      const dbAttenuation = _audioDspF32(Math.max(_audioDspF32(2),
        -_audioDspLinearToDecibels(attenuation)));
      const dbPerFrame = _audioDspF32(dbAttenuation / satReleaseFrames);
      const satReleaseRate = _audioDspF32(_audioDspDecibelsToLinear(dbPerFrame) - _audioDspF32(1));
      const isRelease = attenuation > detectorAverage;
      const rate = isRelease ? satReleaseRate : _audioDspF32(1);
      detectorAverage = _audioDspF32(detectorAverage
        + _audioDspF32(_audioDspF32(attenuation - detectorAverage) * rate));
      detectorAverage = _audioDspF32(Math.min(_audioDspF32(1), detectorAverage));
      if (!Number.isFinite(detectorAverage)) detectorAverage = _audioDspF32(1);

      if (envelopeRate < 1) {
        compressorGain = _audioDspF32(compressorGain
          + _audioDspF32(_audioDspF32(scaledDesiredGain - compressorGain) * envelopeRate));
      } else {
        compressorGain = _audioDspF32(Math.min(_audioDspF32(1), _audioDspF32(compressorGain * envelopeRate)));
      }

      const postWarpGain = _audioDspF32(Math.sin(_audioDspF32(_audioDspHalfPi * compressorGain)));
      const totalGain = _audioDspF32(linearPostGain * postWarpGain);
      const dbRealGain = _audioDspLinearToDecibels(postWarpGain);
      if (dbRealGain < state.meteringGain) {
        state.meteringGain = dbRealGain;
      } else {
        state.meteringGain = _audioDspF32(state.meteringGain
          + _audioDspF32(_audioDspF32(dbRealGain - state.meteringGain)
            * _audioDspDiscreteTimeConstant(_audioDspMeteringReleaseTimeConstant, state.sampleRate)));
      }

      destination[0][frameIndex] = _audioDspF32(state.preDelay[0][readIndex] * totalGain);
      destination[1][frameIndex] = _audioDspF32(state.preDelay[1][readIndex] * totalGain);
      frameIndex++;
      readIndex = (readIndex + 1) & (_audioDspMaxPreDelayFrames - 1);
      writeIndex = (writeIndex + 1) & (_audioDspMaxPreDelayFrames - 1);
    }
    state.readIndex = readIndex;
    state.writeIndex = writeIndex;
    state.detectorAverage = detectorAverage;
    state.compressorGain = compressorGain;
  }
  node.reduction = state.meteringGain;
}

// ---------------------------------------------------------------------------
// Graph rendering
// ---------------------------------------------------------------------------

function _audioDspSilence(channels, frames) {
  const output = [];
  for (let channel = 0; channel < channels; channel++) output.push(new Float32Array(frames));
  return output;
}

// Speaker layout mixing: mono spreads to both stereo channels, stereo folds to
// mono at half the sum.
function _audioDspMixToChannels(channels, count, frames) {
  if (channels.length === count) return channels;
  const output = _audioDspSilence(count, frames);
  if (count === 1) {
    const left = channels[0] || new Float32Array(frames);
    const right = channels.length > 1 ? channels[1] : left;
    for (let i = 0; i < frames; i++) {
      output[0][i] = _audioDspF32(_audioDspF32(0.5) * _audioDspF32(left[i] + right[i]));
    }
    return output;
  }
  if (channels.length === 1) {
    output[0].set(channels[0]);
    output[1].set(channels[0]);
    return output;
  }
  for (let channel = 0; channel < count && channel < channels.length; channel++) {
    output[channel].set(channels[channel]);
  }
  return output;
}

function _audioDspRenderInputs(state, quantum, stateOf) {
  const frames = quantum.frames;
  if (!state.inputs.length) return [];
  let output = null;
  for (const source of state.inputs) {
    const rendered = _audioDspRender(source, quantum, stateOf);
    if (!rendered.length) continue;
    if (!output) {
      output = _audioDspSilence(rendered.length, frames);
    } else if (rendered.length > output.length) {
      output = _audioDspMixToChannels(output, rendered.length, frames);
    }
    const mixed = _audioDspMixToChannels(rendered, output.length, frames);
    for (let channel = 0; channel < output.length; channel++) {
      const into = output[channel];
      const from = mixed[channel];
      for (let i = 0; i < frames; i++) into[i] = _audioDspF32(into[i] + from[i]);
    }
  }
  return output || [];
}

function _audioDspIsOscillator(node) {
  return !!(node.detune && node.frequency && node.type !== undefined);
}

// Render one node's output for the current quantum.  The result is cached per
// quantum, so a node feeding two destinations is rendered once, and a feedback
// edge renders as silence rather than recursing.
function _audioDspRender(node, quantum, stateOf) {
  const state = stateOf(node);
  if (state.renderToken === quantum.token) return state.renderOutput;
  if (state.renderActive) return [];
  if (!state.sampleRate) state.sampleRate = quantum.sampleRate;
  state.renderActive = true;
  state.renderToken = quantum.token;
  state.renderOutput = [];
  const frames = quantum.frames;
  let output = [];
  if (_audioDspIsOscillator(node)) {
    output = _audioDspSilence(1, frames);
    if (state.started) {
      const startFrame = Math.round((state.startTime || 0) * state.sampleRate);
      const offset = quantum.start - startFrame;
      const wave = _audioDspWaveTables(node.type === 'custom' ? 'sine' : node.type, state.sampleRate);
      if (offset >= 0) {
        _audioDspOscillatorQuantum(node, state, wave, frames, output[0], quantum.start);
      } else if (offset + frames > 0) {
        const silent = -offset;
        _audioDspOscillatorQuantum(node, state, wave, frames - silent, output[0].subarray(silent),
          quantum.start);
      }
    }
  } else if (node.buffer !== undefined && node.loop !== undefined) {
    output = _audioDspSilence(1, frames);
    const stored = (node.buffer && node.buffer._chs) || [];
    const channel = stored[0];
    const startFrame = Math.round((state.startTime || 0) * state.sampleRate);
    if (channel && state.started) {
      for (let i = 0; i < frames; i++) {
        const index = quantum.start + i - startFrame;
        output[0][i] = index >= 0 && index < channel.length ? channel[index] : 0;
      }
    }
  } else if (node.threshold && node.knee && node.ratio && node.attack && node.release) {
    const inputs = _audioDspRenderInputs(state, quantum, stateOf);
    const stereo = inputs.length
      ? _audioDspMixToChannels(inputs, 2, frames)
      : _audioDspSilence(2, frames);
    if (!state.compressor) state.compressor = _audioDspCompressorState(state.sampleRate);
    output = _audioDspSilence(2, frames);
    _audioDspCompressorQuantum(node, state.compressor, stereo, frames, output);
  } else {
    output = _audioDspRenderInputs(state, quantum, stateOf);
    if (node.gain && node.gain.value !== undefined) {
      const gain = _audioDspF32(Number(node.gain.value));
      for (const channel of output) {
        for (let i = 0; i < frames; i++) channel[i] = _audioDspF32(channel[i] * gain);
      }
    }
  }
  state.renderActive = false;
  state.renderOutput = output;
  return output;
}

// Render an offline context into `buffer`, a quantum at a time.  The quantum
// size is not a detail: the phase and the compressor's division groups are
// both aligned to it.
function _audioDspRenderOffline(context, buffer, stateOf) {
  const frames = buffer.length;
  const channelCount = buffer.numberOfChannels;
  const sampleRate = context.sampleRate || 44100;
  const destination = context.destination;
  const destinationState = destination ? stateOf(destination) : null;
  const data = [];
  for (let channel = 0; channel < channelCount; channel++) data.push(buffer.getChannelData(channel));
  if (!destinationState || !destinationState.inputs.length) return buffer;
  let token = 0;
  for (let start = 0; start < frames; start += 128) {
    const quantum = { start, frames: Math.min(128, frames - start), token: ++token, sampleRate };
    // Parameter assignments are timed against the render position, so the
    // context has to know where it is while the graph is being pulled.
    context._audioRenderFrame = start;
    const rendered = _audioDspRenderInputs(destinationState, quantum, stateOf);
    const mixed = _audioDspMixToChannels(rendered, channelCount, quantum.frames);
    for (let channel = 0; channel < channelCount; channel++) {
      if (mixed[channel]) data[channel].set(mixed[channel], start);
    }
  }
  context._audioRenderFrame = frames;
  return buffer;
}

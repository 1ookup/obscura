class TimeRanges {
  constructor(key) {
    if (key !== _timeRangesKey) throw new TypeError('Illegal constructor');
  }
  get length() { return 0; }
  start(index) {
    throw new DOMException(
      "Failed to execute 'start' on 'TimeRanges': The index provided (" +
      (index >>> 0) + ') is greater than or equal to the maximum bound (0).',
      'IndexSizeError');
  }
  end(index) {
    throw new DOMException(
      "Failed to execute 'end' on 'TimeRanges': The index provided (" +
      (index >>> 0) + ') is greater than or equal to the maximum bound (0).',
      'IndexSizeError');
  }
  get [Symbol.toStringTag]() { return 'TimeRanges'; }
}
globalThis.TimeRanges = _markNative(TimeRanges);

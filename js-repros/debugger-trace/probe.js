globalThis.debuggerTraceFixture = {
  stack: new Error('probe').stack.split('\n').slice(0, 2),
  op: typeof document.querySelector === 'function',
};

// EventSource object shape and its connection placeholder behavior. Real SSE
// transport is not implemented by the V8 runtime, so an open event is queued
// after construction and close transitions to CLOSED synchronously.
if (typeof EventSource === 'undefined') {
  globalThis.EventSource = class EventSource {
    constructor(url, init) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.withCredentials = !!(init && init.withCredentials);
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      _makeListenerBox(this);
      Promise.resolve().then(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1; // OPEN
        const event = new Event('open');
        if (typeof this.onopen === 'function') {
          try { this.onopen(event); } catch (_error) {}
        }
        try { this.dispatchEvent(event); } catch (_error) {}
      });
    }
    close() { this.readyState = 2; }
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
  };
}

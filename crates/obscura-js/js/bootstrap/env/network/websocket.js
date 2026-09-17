// WebSocket object shape and host-op behavior. The Rust bridge owns the real
// socket; this module only translates its lifecycle records into Web API
// events and keeps the browser-visible state machine.
if (typeof WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {
    constructor(url, protocols) {
      // Validate URL scheme per spec: Chrome throws SyntaxError for non-ws/wss.
      if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) {
        throw new DOMException(
          "Failed to construct 'WebSocket': The URL '" + url + "' is invalid.",
          'SyntaxError'
        );
      }
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.extensions = '';
      this.protocol = Array.isArray(protocols) ? (protocols[0] || '') : (protocols || '');
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._id = null;
      this._closedByUser = false;
      this._closeDispatched = false;
      _makeListenerBox(this);
      const open = Deno.core.ops.op_websocket_open?.(this.url, this.protocol);
      Promise.resolve(open).then((id) => {
        if (this._closedByUser) {
          if (id != null) Deno.core.ops.op_websocket_close?.(Number(id), 1000, '');
          this._dispatchClose(1000, '', true);
          return;
        }
        this._id = Number(id);
        this.readyState = 1;
        const event = new Event('open');
        if (typeof this.onopen === 'function') {
          try { this.onopen(event); } catch (_error) {}
        }
        try { this.dispatchEvent(event); } catch (_error) {}
        this._pump();
      }, (error) => {
        this.readyState = 3;
        const event = new Event('error');
        event.error = error;
        if (typeof this.onerror === 'function') {
          try { this.onerror(event); } catch (_error) {}
        }
        try { this.dispatchEvent(event); } catch (_error) {}
        this._dispatchClose(1006, '', false);
      });
    }
    _dispatchClose(code, reason, wasClean) {
      if (this._closeDispatched) return;
      this._closeDispatched = true;
      this.readyState = 3;
      const close = new Event('close');
      close.code = code || 1000;
      close.reason = reason || '';
      close.wasClean = wasClean !== false;
      if (typeof this.onclose === 'function') {
        try { this.onclose(close); } catch (_error) {}
      }
      try { this.dispatchEvent(close); } catch (_error) {}
    }
    _pump() {
      if (this._id == null || this.readyState >= 2) return;
      Promise.resolve(Deno.core.ops.op_websocket_recv?.(this._id)).then((raw) => {
        if (!raw || this.readyState >= 2) return;
        let event;
        try { event = JSON.parse(raw); } catch (_error) {
          event = { type: 'error', message: raw };
        }
        if (event.type === 'message') {
          const message = new MessageEvent('message', {
            data: event.data,
            origin: new URL(this.url).origin,
          });
          if (typeof this.onmessage === 'function') {
            try { this.onmessage(message); } catch (_error) {}
          }
          try { this.dispatchEvent(message); } catch (_error) {}
        } else if (event.type === 'error') {
          const error = new Event('error');
          error.message = event.message || '';
          if (typeof this.onerror === 'function') {
            try { this.onerror(error); } catch (_error) {}
          }
          try { this.dispatchEvent(error); } catch (_error) {}
        } else if (event.type === 'close') {
          this._dispatchClose(event.code || 1000, event.reason || '', event.wasClean !== false);
          return;
        }
        this._pump();
      });
    }
    send(data) {
      if (this.readyState !== 1) {
        throw new DOMException('WebSocket is not open: readyState ' + this.readyState, 'InvalidStateError');
      }
      const value = typeof data === 'string'
        ? data
        : (data instanceof ArrayBuffer ? new TextDecoder().decode(new Uint8Array(data)) : String(data));
      if (!Deno.core.ops.op_websocket_send?.(this._id, value)) {
        throw new DOMException('Failed to send WebSocket message.', 'NetworkError');
      }
    }
    close(code, reason) {
      if (this.readyState >= 2) return;
      this._closedByUser = true;
      this.readyState = 2;
      if (this._id != null) Deno.core.ops.op_websocket_close?.(this._id, code || 1000, reason || '');
      this._dispatchClose(code || 1000, reason || '', true);
    }
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
  };
}

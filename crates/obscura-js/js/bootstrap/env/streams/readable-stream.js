if (typeof ReadableStream === 'undefined') {
  globalThis.ReadableStream = class ReadableStream {
    constructor(source = {}, strategy = {}) {
      this._source = source;
      this._queue = [];
      this._reads = [];
      this._state = "readable";
      this._error = null;
      this.locked = false;
      const stream = this;
      this._controller = {
        enqueue(chunk) {
          if (stream._state !== "readable") return;
          const pending = stream._reads.shift();
          if (pending) pending.resolve({value: chunk, done: false});
          else stream._queue.push(chunk);
        },
        close() {
          if (stream._state !== "readable") return;
          stream._state = "closed";
          while (stream._reads.length) {
            stream._reads.shift().resolve({value: undefined, done: true});
          }
        },
        error(error) {
          if (stream._state !== "readable") return;
          stream._state = "errored";
          stream._error = error;
          while (stream._reads.length) stream._reads.shift().reject(error);
        },
        get desiredSize() { return Math.max(0, 1 - stream._queue.length); },
      };
      try {
        const started = source.start?.(this._controller);
        if (started && typeof started.then === "function") {
          started.catch((error) => this._controller.error(error));
        }
      } catch (error) {
        this._controller.error(error);
      }
    }
    getReader() {
      if (this.locked) throw new TypeError("ReadableStream is locked");
      this.locked = true;
      const stream = this;
      return {
        read() {
          if (stream._queue.length > 0) return Promise.resolve({ value: stream._queue.shift(), done: false });
          if (stream._state === "closed") return Promise.resolve({ value: undefined, done: true });
          if (stream._state === "errored") return Promise.reject(stream._error);
          return new Promise((resolve, reject) => stream._reads.push({resolve, reject}));
        },
        releaseLock() { stream.locked = false; },
        cancel(reason) { return stream.cancel(reason); },
        get closed() {
          if (stream._state === "closed") return Promise.resolve();
          if (stream._state === "errored") return Promise.reject(stream._error);
          return new Promise((resolve, reject) => {
            const poll = () => {
              if (stream._state === "closed") resolve();
              else if (stream._state === "errored") reject(stream._error);
              else setTimeout(poll, 0);
            };
            poll();
          });
        },
      };
    }
    cancel(reason) {
      this._queue.length = 0;
      this._controller.close();
      try { return Promise.resolve(this._source.cancel?.(reason)); }
      catch (error) { return Promise.reject(error); }
    }
    async pipeTo(destination) {
      const reader = this.getReader();
      const writer = destination.getWriter();
      try {
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        await writer.close();
      } catch (error) {
        try { await writer.abort(error); } catch {}
        throw error;
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    }
    pipeThrough(transform) {
      this.pipeTo(transform.writable).catch((error) => {
        try { transform.readable._controller?.error(error); } catch {}
      });
      return transform.readable;
    }
    tee() {
      let leftController;
      let rightController;
      const left = new ReadableStream({start(controller) { leftController = controller; }});
      const right = new ReadableStream({start(controller) { rightController = controller; }});
      (async () => {
        try {
          const reader = this.getReader();
          while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            leftController.enqueue(value);
            rightController.enqueue(value);
          }
          leftController.close();
          rightController.close();
        } catch (error) {
          leftController.error(error);
          rightController.error(error);
        }
      })();
      return [left, right];
    }
    [Symbol.asyncIterator]() {
      const reader = this.getReader();
      return { next: () => reader.read(), return: () => { reader.releaseLock(); return Promise.resolve({done:true}); } };
    }
  };
}

globalThis.StorageEvent = class StorageEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key !== undefined ? init.key : null;
    this.oldValue = init.oldValue !== undefined ? init.oldValue : null;
    this.newValue = init.newValue !== undefined ? init.newValue : null;
    this.url = init.url || "";
    this.storageArea = init.storageArea || null;
  }
  initStorageEvent(type, bubbles, cancelable, key, oldValue, newValue, url, storageArea) {
    this.initEvent(type, bubbles, cancelable);
    this.key = key !== undefined ? key : null;
    this.oldValue = oldValue !== undefined ? oldValue : null;
    this.newValue = newValue !== undefined ? newValue : null;
    this.url = url || "";
    this.storageArea = storageArea || null;
  }
};
_markNative(globalThis.StorageEvent);

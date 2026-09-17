globalThis.ProgressEvent = class ProgressEvent extends Event {
  constructor(type, init) {
    super(type, init || {});
    const i = init || {};
    this.lengthComputable = !!i.lengthComputable;
    this.loaded = i.loaded != null ? Number(i.loaded) : 0;
    this.total = i.total != null ? Number(i.total) : 0;
  }
};

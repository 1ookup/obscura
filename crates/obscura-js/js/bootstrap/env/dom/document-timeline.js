class DocumentTimeline {
  constructor(options = {}) {
    this.originTime = Number(options.originTime) || 0;
  }
  get currentTime() { return performance.now() - this.originTime; }
}

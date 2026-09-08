class TextTrack extends Node {
  constructor(element, kind, label, language) {
    super();
    this._element = element || null;
    this.kind = kind || "subtitles";
    this.label = label || "";
    this.language = language || "";
    this.id = element?.id || "";
    this.mode = element?.hasAttribute?.("default") ? "showing" : "disabled";
    this.inBandMetadataTrackDispatchType = "";
    this._parsedSrc = null;
    this._cues = new TextTrackCueList();
    this.activeCues = new TextTrackCueList();
    this.oncuechange = null;
  }
  get cues() {
    const src = this._element?.getAttribute?.("src") || "";
    if (src !== this._parsedSrc) {
      this._parsedSrc = src;
      this._cues = _parseWebVttCues(src);
    }
    return this._cues;
  }
}

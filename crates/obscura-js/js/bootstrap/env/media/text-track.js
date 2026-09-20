class TextTrack extends Node {
  constructor(element, kind, label, language) {
    super();
    _hset(this, "_element", element || null);
    this.kind = kind || "subtitles";
    this.label = label || "";
    this.language = language || "";
    this.id = element?.id || "";
    this.mode = element?.hasAttribute?.("default") ? "showing" : "disabled";
    this.inBandMetadataTrackDispatchType = "";
    _hset(this, "_parsedSrc", null);
    _hset(this, "_cues", new TextTrackCueList());
    this.activeCues = new TextTrackCueList();
    this.oncuechange = null;
  }
  get cues() {
    const src = this._element?.getAttribute?.("src") || "";
    if (src !== this._parsedSrc) {
      _hset(this, "_parsedSrc", src);
      _hset(this, "_cues", _parseWebVttCues(src));
    }
    return this._cues;
  }
}

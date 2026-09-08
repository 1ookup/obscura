class HTMLTrackElement extends Element {
  static NONE = 0;
  static LOADING = 1;
  static LOADED = 2;
  static ERROR = 3;
  get kind() { return this.getAttribute("kind") || "subtitles"; }
  set kind(value) { this.setAttribute("kind", value); }
  get src() { return this.getAttribute("src") || ""; }
  set src(value) { this.setAttribute("src", value); }
  get srclang() { return this.getAttribute("srclang") || ""; }
  set srclang(value) { this.setAttribute("srclang", value); }
  get label() { return this.getAttribute("label") || ""; }
  set label(value) { this.setAttribute("label", value); }
  get default() { return this.hasAttribute("default"); }
  set default(value) { value ? this.setAttribute("default", "") : this.removeAttribute("default"); }
  get readyState() { return HTMLTrackElement.LOADED; }
  get track() {
    if (!this._textTrack) {
      this._textTrack = new TextTrack(this, this.kind, this.label, this.srclang);
    }
    return this._textTrack;
  }
}

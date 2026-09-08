class TextTrackCue {
  constructor(startTime, endTime, text) {
    this.id = "";
    this.startTime = Number(startTime);
    this.endTime = Number(endTime);
    this.text = String(text ?? "");
    this.pauseOnExit = false;
    this.vertical = "";
    this.snapToLines = true;
    this.line = "auto";
    this.lineAlign = "start";
    this.position = "auto";
    this.positionAlign = "auto";
    this.size = 100;
    this.align = "center";
    this.region = null;
    this.onenter = null;
    this.onexit = null;
  }
  getCueAsHTML() {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode(this.text));
    return fragment;
  }
}

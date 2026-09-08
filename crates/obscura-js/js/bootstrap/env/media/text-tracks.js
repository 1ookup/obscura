const _cache = new Map();

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
class VTTCue extends TextTrackCue {}
class TextTrackCueList extends Array {
  getCueById(id) {
    return this.find((cue) => cue && cue.id === String(id)) || null;
  }
  item(index) { return this[index] || null; }
}
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
class TextTrackList extends Array {
  item(index) { return this[index] || null; }
  getTrackById(id) {
    return this.find((track) => track && track.id === String(id)) || null;
  }
}
function _vttTime(value) {
  const parts = String(value).trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}
function _parseWebVttCues(src) {
  const cues = new TextTrackCueList();
  if (!src || !src.startsWith("data:text/vtt")) return cues;
  let text = "";
  try {
    const comma = src.indexOf(",");
    if (comma < 0) return cues;
    const meta = src.slice(0, comma);
    const body = src.slice(comma + 1);
    text = /;base64(?:;|$)/i.test(meta) ? atob(body) : decodeURIComponent(body);
  } catch (_error) {
    return cues;
  }
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    if (!lines.length || lines[0].trim() === "WEBVTT" || lines[0].trim().startsWith("NOTE")) continue;
    let timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].split("-->");
    const endToken = (timing[1] || "").trim().split(/\s+/)[0];
    const cue = new VTTCue(_vttTime(timing[0]), _vttTime(endToken), lines.slice(timingIndex + 1).join("\n"));
    if (timingIndex > 0) cue.id = lines[timingIndex - 1].trim();
    cues.push(cue);
  }
  return cues;
}

function _imageEncodingError() {
  return new DOMException("The source image cannot be decoded.", "EncodingError");
}


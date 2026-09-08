const _cache = new Map();






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

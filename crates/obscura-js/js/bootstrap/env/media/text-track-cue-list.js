class TextTrackCueList extends Array {
  getCueById(id) {
    return this.find((cue) => cue && cue.id === String(id)) || null;
  }
  item(index) { return this[index] || null; }
}

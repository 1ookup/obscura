class TextTrackList extends Array {
  item(index) { return this[index] || null; }
  getTrackById(id) {
    return this.find((track) => track && track.id === String(id)) || null;
  }
}

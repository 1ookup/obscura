// ChildNode mixin: also mix before/after/replaceWith/remove into
// CharacterData.prototype (covers Text, Comment, ProcessingInstruction).
// These are the same implementations as Element.prototype — frameworks
// (Svelte 5, Vue, Lit) anchor on Comment/Text nodes and call these methods.
if (!CharacterData.prototype.before) CharacterData.prototype.before = Element.prototype.before;
if (!CharacterData.prototype.after) CharacterData.prototype.after = Element.prototype.after;
if (!CharacterData.prototype.replaceWith) CharacterData.prototype.replaceWith = Element.prototype.replaceWith;
if (!CharacterData.prototype.remove) CharacterData.prototype.remove = Element.prototype.remove;

// DocumentType implements ChildNode too, and Chrome declares the four
// operations on DocumentType.prototype itself, between the doctype fields and
// `constructor` (`document.firstChild.remove()` works there).
if (typeof DocumentType === 'function') {
  if (!DocumentType.prototype.before) DocumentType.prototype.before = Element.prototype.before;
  if (!DocumentType.prototype.after) DocumentType.prototype.after = Element.prototype.after;
  if (!DocumentType.prototype.replaceWith) DocumentType.prototype.replaceWith = Element.prototype.replaceWith;
  if (!DocumentType.prototype.remove) DocumentType.prototype.remove = Element.prototype.remove;
}

if (!('isConnected' in Node.prototype)) {
  Object.defineProperty(Node.prototype, 'isConnected', {
    get() {
      const root = this.getRootNode({ composed: true });
      return !!root && root.nodeType === 9;
    }
  });
}


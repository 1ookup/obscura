class Text extends CharacterData {
  // Two construction shapes: the internal wrappers build from an existing
  // node id (document.js / iframe-element.js pass the numeric nid through),
  // while a page's `new Text("data")` must mint a real node the way Chrome's
  // constructor does -- the earlier shape left the string in the nid slot, so
  // the detached instance answered empty data and relied on prototype
  // shadowing for nodeName/nodeType.
  constructor(dataOrNid) {
    super(typeof dataOrNid === 'number'
      ? dataOrNid
      : +_dom("create_text_node", String(dataOrNid ?? "")));
  }
  get wholeText() { return this.data; }
  get assignedSlot() {
    // Slottable mixin. The engine tracks no slot assignment yet (no
    // assigned_slot op on the bridge), so a text node is never slotted and
    // Chrome's null default is the truthful answer for every tree we build.
    return null;
  }
  splitText(offset) {
    const d = this.data;
    const tail = d.substring(offset);
    this.data = d.substring(0, offset);
    const newNid = +_dom("create_text_node", tail);
    const parent = this.parentNode;
    if (parent) {
      const ref = this.nextSibling;
      parent.insertBefore(_wrap(newNid), ref);
    }
    return _wrap(newNid);
  }
}
// nodeName/nodeType/cloneNode stay unshadowed: Node.prototype owns them
// (Chrome's Text.prototype own-key census is exactly
// [wholeText, assignedSlot, splitText, constructor]) and the real nid this
// constructor now mints lets the base answers be the true ones.
OBSCURA_GEOM_CTOR_LAST(Text.prototype);

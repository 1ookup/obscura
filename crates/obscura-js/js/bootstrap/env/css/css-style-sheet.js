class CSSStyleSheet extends StyleSheet {
  constructor(_options) {
    super(_styleSheetConstructionKey);
    this.ownerRule = null;
    _hset(this, "_disabled", false);
    _hset(this, "_ownerNode", null);
    _hset(this, "_sourceNode", null);
    _hset(this, "_sourceText", "");
    _hset(this, "_sourceTextRead", null);
    _hset(this, "_sourceEpochDom", -1);
    _hset(this, "_sourceEpochNative", null);
    _hset(this, "_href", null);
    _hset(this, "_media", null);
    _hset(this, "_originClean", true);
    _hset(this, "_rules", []);
    _hset(this, "_cssRules", new CSSRuleList(this));
    _hset(this, "_adopters", new Set());
  }
  get cssRules() {
    this._assertOriginClean();
    this._refreshFromOwner();
    return this._cssRules;
  }
  get rules() { return this.cssRules; }
  _bindOwner(ownerNode, sourceNode = ownerNode) {
    _hset(this, "_ownerNode", ownerNode);
    _hset(this, "_sourceNode", sourceNode);
    _hset(this, "_sourceText", null);
    _hset(this, "_sourceTextRead", null);
    this._refreshFromOwner();
  }
  _bindLinkedOwner(ownerNode, sourceNode, href, originClean) {
    _hset(this, "_ownerNode", ownerNode);
    _hset(this, "_sourceNode", sourceNode);
    _hset(this, "_sourceText", null);
    _hset(this, "_sourceTextRead", null);
    _hset(this, "_href", href || null);
    _hset(this, "_originClean", originClean !== false);
    if (this._originClean) this._refreshFromOwner();
    else {
      this._setRules([]);
      _hset(this, "_sourceText", sourceNode?.textContent || "");
    }
  }
  _assertOriginClean() {
    if (!this._originClean) {
      throw new DOMException("Cannot access rules in a cross-origin stylesheet", "SecurityError");
    }
  }
  // `textContent` on the source node is a native op that serializes the whole
  // subtree, and the live rule list refreshes on every index access (twice per
  // rule during enumeration). A 400-rule walk therefore paid hundreds of
  // full-sheet reads, ~20x Chrome's cssomWalk. Cache the raw text and re-read
  // only when a mutation could have changed it. The JS DOM mutation epoch
  // covers same-realm mutations in every build shape; the native activity
  // epoch additionally covers parent-document mutations issued from frame
  // realms (render builds register that op).
  _readSourceText() {
    const domEpoch = _domMutationEpoch;
    const nativeEpoch = Deno.core.ops.op_layout_metrics_epoch
      ? Deno.core.ops.op_layout_metrics_epoch()
      : null;
    if (this._sourceTextRead !== null
      && this._sourceEpochDom === domEpoch
      && this._sourceEpochNative === nativeEpoch) {
      return this._sourceTextRead;
    }
    _hset(this, "_sourceTextRead", this._sourceNode.textContent || "");
    _hset(this, "_sourceEpochDom", domEpoch);
    _hset(this, "_sourceEpochNative", nativeEpoch);
    return this._sourceTextRead;
  }
  _refreshFromOwner() {
    if (!this._sourceNode || !this._originClean) return;
    const text = this._readSourceText();
    if (text === this._sourceText) return;
    // Incremental append: scripts commonly append rules to an existing
    // sheet. Re-parsing the unchanged prefix rebuilt every rule object (and
    // their identities) on each append and made the append pay a full-sheet
    // scan. The previously parsed text always ends at a rule boundary, so
    // parsing only the suffix and appending is equivalent; any parse doubt
    // falls back to the full re-parse.
    if (this._sourceText !== null
      && text.length > this._sourceText.length
      && text.startsWith(this._sourceText)) {
      const added = _splitTopLevelCssRules(text.slice(this._sourceText.length));
      if (added.valid) {
        for (const rule of added.rules.map(_cssRuleFromText).filter(Boolean)) {
          _hset(rule, "_parentStyleSheet", this);
          this._rules.push(rule);
        }
        _hset(this, "_sourceText", text);
        return;
      }
    }
    const parsed = _splitTopLevelCssRules(text);
    const rules = parsed.rules.map(_cssRuleFromText).filter(Boolean);
    this._setRules(rules);
    _hset(this, "_sourceText", text);
  }
  _setRules(rules) {
    for (const rule of this._rules) _hset(rule, "_parentStyleSheet", null);
    this._rules.splice(0, this._rules.length, ...rules);
    for (const rule of this._rules) _hset(rule, "_parentStyleSheet", this);
  }
  _serializeText() { return this._rules.map(rule => rule.cssText).join("\n"); }
  _ruleChanged() {
    const text = this._serializeText();
    _hset(this, "_sourceText", text);
    // DOM text is the renderer bridge for this bounded CSSOM implementation:
    // its ordinary style-element mutation path invalidates cascade/layout.
    // Avoiding the observable text rewrite requires a future native effective-
    // source channel shared by CSSOM and the renderer.
    if (this._sourceNode && this._sourceNode.textContent !== text) this._sourceNode.textContent = text;
    // The write (or the comparison read) above leaves the DOM text equal to
    // `text`; seed the raw cache with that value so the next refresh does not
    // re-serialize the subtree just to discover nothing changed.
    if (this._sourceNode) {
      _hset(this, "_sourceTextRead", text);
      _hset(this, "_sourceEpochDom", _domMutationEpoch);
      _hset(this, "_sourceEpochNative", Deno.core.ops.op_layout_metrics_epoch
        ? Deno.core.ops.op_layout_metrics_epoch()
        : null);
    }
    _syncAdoptedStyleSheet(this);
  }
  insertRule(rule, index = 0) {
    if (arguments.length < 1) throw new TypeError("CSSStyleSheet.insertRule requires a rule");
    this._assertOriginClean();
    this._refreshFromOwner();
    const idx = Number(index) >>> 0;
    if (idx > this._rules.length) throw new DOMException("Rule index is out of range", "IndexSizeError");
    const parsed = _splitTopLevelCssRules(String(rule));
    if (!parsed.valid || parsed.rules.length !== 1) {
      throw new DOMException("The rule could not be parsed", "SyntaxError");
    }
    const cssRule = _cssRuleFromText(parsed.rules[0]);
    if (!cssRule) throw new DOMException("The rule could not be parsed", "SyntaxError");
    _hset(cssRule, "_parentStyleSheet", this);
    this._rules.splice(idx, 0, cssRule);
    this._ruleChanged();
    return idx;
  }
  deleteRule(index) {
    if (arguments.length < 1) throw new TypeError("CSSStyleSheet.deleteRule requires an index");
    this._assertOriginClean();
    this._refreshFromOwner();
    const idx = Number(index) >>> 0;
    if (idx >= this._rules.length) throw new DOMException("Rule index is out of range", "IndexSizeError");
    const [removed] = this._rules.splice(idx, 1);
    if (removed) _hset(removed, "_parentStyleSheet", null);
    this._ruleChanged();
  }
  addRule(selector, style, index) {
    this.insertRule(String(selector) + "{" + String(style) + "}", index ?? this._rules.length);
    return -1;
  }
  removeRule(index = 0) { this.deleteRule(index); }
  replace(text) { this.replaceSync(text); return Promise.resolve(this); }
  replaceSync(text) {
    this._assertOriginClean();
    const parsed = _splitTopLevelCssRules(String(text));
    this._setRules(parsed.rules.map(_cssRuleFromText).filter(Boolean));
    this._ruleChanged();
  }
}
globalThis.CSSStyleSheet = CSSStyleSheet;

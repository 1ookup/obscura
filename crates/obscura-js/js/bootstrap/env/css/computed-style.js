const _computedStyleSnapshotCache = new WeakMap();
globalThis.getComputedStyle = (el) => {
  if (!el) el = document.body || {};
  const style = el?.style || el?._style || new CSSStyleDeclaration();
  // Render builds expose one immutable snapshot from the retained final
  // cascade/layout. The native snapshot is shared per element and epoch while
  // each call still returns a distinct, live CSSStyleDeclaration proxy.
  const cacheable = (typeof el === 'object' && el !== null) || typeof el === 'function';
  let snapshot = cacheable ? _computedStyleSnapshotCache.get(el) : null;
  if (!snapshot) {
    snapshot = { rendered: null, epoch: -1, names: _CSS_COMPUTED_PROPERTY_NAMES };
    if (cacheable) _computedStyleSnapshotCache.set(el, snapshot);
  }
  const refreshRendered = () => {
    const hasRunningAnimation = typeof _animationsForTarget === 'function'
      && _animationsForTarget(el).some(animation => animation.playState === 'running');
    if (snapshot.epoch === _domMutationEpoch && !hasRunningAnimation) return;
    snapshot.epoch = _domMutationEpoch;
    snapshot.rendered = null;
    if (typeof Deno.core.ops.op_computed_style === 'function' && el?.[_nidSym] != null) {
      try {
        const raw = Deno.core.ops.op_computed_style(String(el[_nidSym] | 0));
        snapshot.rendered = raw ? JSON.parse(raw) : null;
      } catch (e) {}
    }
    const customNames = snapshot.rendered
      ? Object.keys(snapshot.rendered).filter(name => name.startsWith('--')) : [];
    snapshot.names = customNames.length
      ? _CSS_COMPUTED_PROPERTY_NAMES.concat(customNames)
      : _CSS_COMPUTED_PROPERTY_NAMES;
  };
  // React virtualization libraries (react-window, tanstack-virtual,
  // react-virtuoso) all compute container dimensions via getComputedStyle.
  // The defaults table previously returned `auto` for width/height and
  // `'static'` for position, which made every list render 0 items. Pulling
  // width/height from the synthesized bounding rect makes those libraries
  // actually render content.
  const dimensionFor = (name) => {
    try {
      const r = el.getBoundingClientRect && el.getBoundingClientRect();
      if (!r) return null;
      switch (name) {
        case 'width': case 'inline-size':
          return r.width != null ? `${r.width}px` : null;
        case 'height': case 'block-size':
          return r.height != null ? `${r.height}px` : null;
        case 'left': return r.left != null ? `${r.left}px` : null;
        case 'top': return r.top != null ? `${r.top}px` : null;
        case 'right': return r.right != null ? `${r.right}px` : null;
        case 'bottom': return r.bottom != null ? `${r.bottom}px` : null;
        case 'client-width': case 'offset-width':
          return r.width != null ? `${r.width}px` : null;
        case 'client-height': case 'offset-height':
          return r.height != null ? `${r.height}px` : null;
      }
    } catch (e) {}
    return null;
  };

  const defaultsKebab = {
    display: 'block', visibility: 'visible', opacity: '1',
    position: 'static', overflow: 'visible',
    transform: 'none', 'transform-origin': '0px 0px',
    transition: 'none', animation: 'none',
    float: 'none', clear: 'none',
    margin: '0px', padding: '0px',
    'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
    'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
    'font-size': '16px', 'line-height': 'normal', 'font-weight': '400',
    'letter-spacing': 'normal',
    'font-family': 'Times',
    color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)',
    'border-width': '0px', 'border-style': 'none', 'border-color': 'rgb(0, 0, 0)',
    'border-top-width': '0px', 'border-right-width': '0px',
    'border-bottom-width': '0px', 'border-left-width': '0px',
    'border-radius': '0px',
    'z-index': 'auto', 'pointer-events': 'auto',
    'box-sizing': 'content-box', cursor: 'auto',
    'white-space': 'normal', 'text-align': 'start',
    'flex-flow': 'row nowrap', 'flex-direction': 'row', 'flex-wrap': 'nowrap', 'align-items': 'normal',
    'justify-content': 'normal', gap: 'normal',
    'grid-template-columns': 'none', 'grid-template-rows': 'none',
    'will-change': 'auto', 'backface-visibility': 'visible',
  };

  const lookup = (rawProp) => {
    if (typeof rawProp !== 'string') return '';
    refreshRendered();
    let kebab = rawProp.replace(/([A-Z])/g, '-$1').toLowerCase();
    // CSSOM camelCase vendor properties omit the punctuation from their JS
    // spelling (`webkitLineClamp`) but computed-property names retain it
    // (`-webkit-line-clamp`). Normalize the prefix once for every WebKit
    // property instead of adding per-property aliases to the native snapshot.
    if (kebab.startsWith('webkit-')) kebab = '-' + kebab;
    if (snapshot.rendered && Object.prototype.hasOwnProperty.call(snapshot.rendered, kebab))
      return snapshot.rendered[kebab];
    // Non-render builds and properties outside the renderer snapshot retain
    // the lightweight inline CSSOM behavior.
    const inlineVal = target.getPropertyValue ? target.getPropertyValue(rawProp) : '';
    if (inlineVal) {
      if (kebab === 'opacity') {
        const value = Number(inlineVal);
        if (Number.isFinite(value)) return String(Math.min(1, Math.max(0, value)));
      }
      return inlineVal;
    }
    const dim = dimensionFor(kebab);
    if (dim != null) return dim;
    if (defaultsKebab[rawProp]) return defaultsKebab[rawProp];
    if (defaultsKebab[kebab]) return defaultsKebab[kebab];
    return '';
  };

  const target = style;
  return new Proxy(style, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) return undefined;
      if (prop === Symbol.toStringTag) return 'CSSStyleDeclaration';
      if (prop === 'getPropertyValue') return (name) => lookup(name);
      if (prop === 'getPropertyPriority') return () => '';
      if (prop === 'item') return (i) => {
        refreshRendered();
        return snapshot.names[i | 0] || '';
      };
      if (prop === 'length') {
        refreshRendered();
        return snapshot.names.length;
      }
      if (prop === 'cssText') return '';
      if (prop === 'parentRule') return null;
      // CSSStyleDeclaration's `has` trap intentionally reports every known
      // CSS IDL property. Checking `prop in target` before this lookup therefore
      // returned the empty inline declaration for e.g. computed.display and
      // prevented every computed/default fallback below from running.
      if (typeof prop === 'string'
          && (_CSS_PROP_SET.has(prop)
              || _CSS_PROP_SET.has(_cssKebabToCamel(prop))
              || prop.includes('-'))) {
        return lookup(prop);
      }
      if (prop in target) return target[prop];
      if (typeof prop === 'string') return lookup(prop);
      return undefined;
    },
    ownKeys() {
      refreshRendered();
      const keys = [];
      for (let index = 0; index < snapshot.names.length; index++) keys.push(String(index));
      keys.push(..._CSS_PROPERTY_NAMES);
      return keys;
    },
    getOwnPropertyDescriptor(_, prop) {
      if (typeof prop !== 'string') return undefined;
      refreshRendered();
      if (/^\d+$/.test(prop) && +prop < snapshot.names.length) {
        return { value: snapshot.names[+prop], writable: false, enumerable: true, configurable: true };
      }
      if (_CSS_PROP_SET.has(prop)) {
        return { value: lookup(prop), writable: true, enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
};

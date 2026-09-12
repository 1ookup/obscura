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
  // Chrome answers `auto` for the offset properties of a static box. The
  // synthesized rect only stands in for them once the box is positioned,
  // otherwise every static element reported an offset resolved from its own
  // border box, which no browser does and which a layout probe reads as a
  // value the renderer invented.
  const computedPosition = () => {
    if (snapshot.rendered && typeof snapshot.rendered.position === 'string') {
      return snapshot.rendered.position;
    }
    const authored = target.getPropertyValue ? target.getPropertyValue('position') : '';
    return authored || 'static';
  };
  const dimensionFor = (name) => {
    try {
      const positioned = name !== 'left' && name !== 'top'
        && name !== 'right' && name !== 'bottom';
      if (!positioned && computedPosition() === 'static') return null;
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

  // Longhands Chrome always resolves. Anything absent here fell through to
  // `''`, which in CSSOM means "no such property", so a probe that read a
  // supported property such as `font-style` or `word-spacing` was told the
  // declaration does not exist. Only entries whose computed value is
  // well known are listed; the renderer snapshot still wins when it has one.
  const defaultsKebab = {
    display: 'block', visibility: 'visible', opacity: '1',
    position: 'static', overflow: 'visible',
    'overflow-x': 'visible', 'overflow-y': 'visible',
    transform: 'none', 'transform-origin': '0px 0px',
    translate: 'none', rotate: 'none', scale: 'none',
    transition: 'none', animation: 'none',
    float: 'none', clear: 'none',
    margin: '0px', padding: '0px',
    'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
    'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
    'font-size': '16px', 'line-height': 'normal', 'font-weight': '400',
    'letter-spacing': 'normal',
    'font-family': 'Times',
    'font-style': 'normal', 'font-variant': 'normal', 'font-stretch': '100%',
    'font-kerning': 'auto', 'font-feature-settings': 'normal',
    'font-variation-settings': 'normal', 'font-optical-sizing': 'auto',
    'font-size-adjust': 'none', 'font-synthesis': 'weight style small-caps',
    color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)',
    'background-image': 'none', 'background-repeat': 'repeat',
    'background-position': '0% 0%', 'background-size': 'auto',
    'border-width': '0px', 'border-style': 'none', 'border-color': 'rgb(0, 0, 0)',
    'border-top-width': '0px', 'border-right-width': '0px',
    'border-bottom-width': '0px', 'border-left-width': '0px',
    'border-radius': '0px',
    'border-collapse': 'separate', 'border-spacing': '0px',
    'z-index': 'auto', 'pointer-events': 'auto',
    'box-sizing': 'content-box', cursor: 'auto',
    'white-space': 'normal', 'text-align': 'start', 'text-align-last': 'auto',
    'text-indent': '0px', 'text-transform': 'none', 'text-shadow': 'none',
    'text-overflow': 'clip', 'text-rendering': 'auto',
    'text-decoration-line': 'none', 'text-decoration-style': 'solid',
    'text-decoration-color': 'rgb(0, 0, 0)', 'text-underline-offset': 'auto',
    'text-underline-position': 'auto',
    'word-spacing': '0px', 'word-break': 'normal', 'overflow-wrap': 'normal',
    'line-break': 'auto', 'hyphens': 'manual', 'tab-size': '8',
    'direction': 'ltr', 'unicode-bidi': 'normal', 'writing-mode': 'horizontal-tb',
    'vertical-align': 'baseline',
    'list-style-type': 'disc', 'list-style-position': 'outside', 'list-style-image': 'none',
    'caption-side': 'top', 'empty-cells': 'show', 'table-layout': 'auto',
    'left': 'auto', 'top': 'auto', 'right': 'auto', 'bottom': 'auto',
    'min-width': 'auto', 'min-height': 'auto', 'max-width': 'none', 'max-height': 'none',
    'flex-flow': 'row nowrap', 'flex-direction': 'row', 'flex-wrap': 'nowrap', 'align-items': 'normal',
    'align-self': 'auto', 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto',
    'justify-content': 'normal', 'justify-items': 'legacy', 'justify-self': 'auto',
    'order': '0', gap: 'normal', 'row-gap': 'normal', 'column-gap': 'normal',
    'grid-template-columns': 'none', 'grid-template-rows': 'none',
    'aspect-ratio': 'auto', 'object-fit': 'fill', 'object-position': '50% 50%',
    'image-rendering': 'auto', 'mix-blend-mode': 'normal', 'isolation': 'auto',
    'box-shadow': 'none', 'filter': 'none', 'clip': 'auto', content: 'normal',
    quotes: 'auto', resize: 'none', 'caret-color': 'auto', 'accent-color': 'auto',
    'user-select': 'auto', 'touch-action': 'auto', 'scroll-behavior': 'auto',
    'overscroll-behavior': 'auto', 'color-scheme': 'normal',
    'content-visibility': 'visible', zoom: '1',
    'outline-color': 'rgb(0, 0, 0)', 'outline-style': 'none', 'outline-width': '0px',
    'fill': 'rgb(0, 0, 0)', stroke: 'none', 'stroke-width': '1px',
    'vector-effect': 'none', d: 'none',
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

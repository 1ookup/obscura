// Chrome's computed values for an unstyled element, keyed by the camelCase
// own-property spelling the computed-style surface exposes. Consulted only
// after the rendered snapshot, inline declarations, box geometry, and the
// hand-listed defaults above, so a real value always wins.
const _CHROME_COMPUTED_DEFAULTS = {"accentColor":"auto","additiveSymbols":"","alignContent":"normal","alignItems":"normal","alignSelf":"auto","alignmentBaseline":"auto","all":"","anchorName":"none","anchorScope":"none","animation":"none","animationComposition":"replace","animationDelay":"0s","animationDirection":"normal","animationDuration":"0s","animationFillMode":"none","animationIterationCount":"1","animationName":"none","animationPlayState":"running","animationRange":"normal","animationRangeEnd":"normal","animationRangeStart":"normal","animationTimeline":"auto","animationTimingFunction":"ease","animationTrigger":"none","appRegion":"none","appearance":"none","ascentOverride":"","aspectRatio":"auto","backdropFilter":"none","backfaceVisibility":"visible","background":"rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box","backgroundAttachment":"scroll","backgroundBlendMode":"normal","backgroundClip":"border-box","backgroundColor":"rgba(0, 0, 0, 0)","backgroundImage":"none","backgroundOrigin":"padding-box","backgroundPosition":"0% 0%","backgroundPositionX":"0%","backgroundPositionY":"0%","backgroundRepeat":"repeat","backgroundSize":"auto","basePalette":"","baselineShift":"0px","baselineSource":"auto","blockSize":"0px","border":"0px none rgb(0, 0, 0)","borderBlock":"0px none rgb(0, 0, 0)","borderBlockColor":"rgb(0, 0, 0)","borderBlockEnd":"0px none rgb(0, 0, 0)","borderBlockEndColor":"rgb(0, 0, 0)","borderBlockEndStyle":"none","borderBlockEndWidth":"0px","borderBlockStart":"0px none rgb(0, 0, 0)","borderBlockStartColor":"rgb(0, 0, 0)","borderBlockStartStyle":"none","borderBlockStartWidth":"0px","borderBlockStyle":"none","borderBlockWidth":"0px","borderBottom":"0px none rgb(0, 0, 0)","borderBottomColor":"rgb(0, 0, 0)","borderBottomLeftRadius":"0px","borderBottomRightRadius":"0px","borderBottomStyle":"none","borderBottomWidth":"0px","borderCollapse":"separate","borderColor":"rgb(0, 0, 0)","borderEndEndRadius":"0px","borderEndStartRadius":"0px","borderImage":"none","borderImageOutset":"0","borderImageRepeat":"stretch","borderImageSlice":"100%","borderImageSource":"none","borderImageWidth":"1","borderInline":"0px none rgb(0, 0, 0)","borderInlineColor":"rgb(0, 0, 0)","borderInlineEnd":"0px none rgb(0, 0, 0)","borderInlineEndColor":"rgb(0, 0, 0)","borderInlineEndStyle":"none","borderInlineEndWidth":"0px","borderInlineStart":"0px none rgb(0, 0, 0)","borderInlineStartColor":"rgb(0, 0, 0)","borderInlineStartStyle":"none","borderInlineStartWidth":"0px","borderInlineStyle":"none","borderInlineWidth":"0px","borderLeft":"0px none rgb(0, 0, 0)","borderLeftColor":"rgb(0, 0, 0)","borderLeftStyle":"none","borderLeftWidth":"0px","borderRadius":"0px","borderRight":"0px none rgb(0, 0, 0)","borderRightColor":"rgb(0, 0, 0)","borderRightStyle":"none","borderRightWidth":"0px","borderShape":"none","borderSpacing":"0px","borderStartEndRadius":"0px","borderStartStartRadius":"0px","borderStyle":"none","borderTop":"0px none rgb(0, 0, 0)","borderTopColor":"rgb(0, 0, 0)","borderTopLeftRadius":"0px","borderTopRightRadius":"0px","borderTopStyle":"none","borderTopWidth":"0px","borderWidth":"0px","bottom":"auto","boxDecorationBreak":"slice","boxShadow":"none","boxSizing":"content-box","breakAfter":"auto","breakBefore":"auto","breakInside":"auto","bufferedRendering":"auto","captionSide":"top","caretAnimation":"auto","caretColor":"rgb(0, 0, 0)","caretShape":"auto","clear":"none","clip":"auto","clipPath":"none","clipRule":"nonzero","color":"rgb(0, 0, 0)","colorInterpolation":"srgb","colorInterpolationFilters":"linearrgb","colorRendering":"auto","colorScheme":"normal","columnCount":"auto","columnFill":"balance","columnGap":"normal","columnHeight":"auto","columnRule":"3px rgb(0, 0, 0)","columnRuleColor":"rgb(0, 0, 0)","columnRuleStyle":"none","columnRuleWidth":"3px","columnSpan":"none","columnWidth":"auto","columnWrap":"auto","columns":"auto","contain":"none","containIntrinsicBlockSize":"none","containIntrinsicHeight":"none","containIntrinsicInlineSize":"none","containIntrinsicSize":"none","containIntrinsicWidth":"none","container":"none","containerName":"none","containerType":"normal","content":"normal","contentVisibility":"visible","cornerBlockEndShape":"round","cornerBlockStartShape":"round","cornerBottomLeftShape":"round","cornerBottomRightShape":"round","cornerBottomShape":"round","cornerEndEndShape":"round","cornerEndStartShape":"round","cornerInlineEndShape":"round","cornerInlineStartShape":"round","cornerLeftShape":"round","cornerRightShape":"round","cornerShape":"round","cornerStartEndShape":"round","cornerStartStartShape":"round","cornerTopLeftShape":"round","cornerTopRightShape":"round","cornerTopShape":"round","counterIncrement":"none","counterReset":"none","counterSet":"none","cursor":"auto","cx":"0px","cy":"0px","d":"none","descentOverride":"","direction":"ltr","display":"block","dominantBaseline":"auto","dynamicRangeLimit":"no-limit","emptyCells":"show","fallback":"","fieldSizing":"fixed","fill":"rgb(0, 0, 0)","fillOpacity":"1","fillRule":"nonzero","filter":"none","flex":"0 1 auto","flexBasis":"auto","flexDirection":"row","flexFlow":"row nowrap","flexGrow":"0","flexShrink":"1","flexWrap":"nowrap","float":"none","floodColor":"rgb(0, 0, 0)","floodOpacity":"1","font":"16px \"PingFang SC\"","fontDisplay":"","fontFamily":"\"PingFang SC\"","fontFeatureSettings":"normal","fontKerning":"auto","fontLanguageOverride":"normal","fontOpticalSizing":"auto","fontPalette":"normal","fontSize":"16px","fontSizeAdjust":"none","fontStretch":"100%","fontStyle":"normal","fontSynthesis":"weight style small-caps","fontSynthesisSmallCaps":"auto","fontSynthesisStyle":"auto","fontSynthesisWeight":"auto","fontVariant":"normal","fontVariantAlternates":"normal","fontVariantCaps":"normal","fontVariantEastAsian":"normal","fontVariantEmoji":"normal","fontVariantLigatures":"normal","fontVariantNumeric":"normal","fontVariantPosition":"normal","fontVariationSettings":"normal","fontWeight":"400","forcedColorAdjust":"auto","gap":"normal","grid":"none / none / none / row / auto / auto","gridArea":"auto","gridAutoColumns":"auto","gridAutoFlow":"row","gridAutoRows":"auto","gridColumn":"auto","gridColumnEnd":"auto","gridColumnGap":"normal","gridColumnStart":"auto","gridGap":"normal","gridRow":"auto","gridRowEnd":"auto","gridRowGap":"normal","gridRowStart":"auto","gridTemplate":"none","gridTemplateAreas":"none","gridTemplateColumns":"none","gridTemplateRows":"none","height":"0px","hyphenateCharacter":"auto","hyphenateLimitChars":"auto","hyphens":"manual","imageOrientation":"from-image","imageRendering":"auto","inherits":"","initialLetter":"normal","initialValue":"","inlineSize":"0px","inset":"auto","insetBlock":"auto","insetBlockEnd":"auto","insetBlockStart":"auto","insetInline":"auto","insetInlineEnd":"auto","insetInlineStart":"auto","interactivity":"auto","interestDelay":"normal","interestDelayEnd":"normal","interestDelayStart":"normal","interpolateSize":"numeric-only","isolation":"auto","justifyContent":"normal","justifyItems":"normal","justifySelf":"auto","left":"auto","letterSpacing":"normal","lightingColor":"rgb(255, 255, 255)","lineBreak":"auto","lineGapOverride":"","lineHeight":"normal","listStyle":"outside none disc","listStyleImage":"none","listStylePosition":"outside","listStyleType":"disc","margin":"8px","marginBlock":"8px","marginBlockEnd":"8px","marginBlockStart":"8px","marginBottom":"8px","marginInline":"8px","marginInlineEnd":"8px","marginInlineStart":"8px","marginLeft":"8px","marginRight":"8px","marginTop":"8px","marker":"none","markerEnd":"none","markerMid":"none","markerStart":"none","mask":"none","maskClip":"border-box","maskComposite":"add","maskImage":"none","maskMode":"match-source","maskOrigin":"border-box","maskPosition":"0% 0%","maskRepeat":"repeat","maskSize":"auto","maskType":"luminance","mathDepth":"0","mathShift":"normal","mathStyle":"normal","maxBlockSize":"none","maxHeight":"none","maxInlineSize":"none","maxWidth":"none","minBlockSize":"0px","minHeight":"0px","minInlineSize":"0px","minWidth":"0px","mixBlendMode":"normal","navigation":"","negative":"","objectFit":"fill","objectPosition":"50% 50%","objectViewBox":"none","offset":"none 0px auto 0deg","offsetAnchor":"auto","offsetDistance":"0px","offsetPath":"none","offsetPosition":"normal","offsetRotate":"auto 0deg","opacity":"1","order":"0","orphans":"2","outline":"rgb(0, 0, 0) none 3px","outlineColor":"rgb(0, 0, 0)","outlineOffset":"0px","outlineStyle":"none","outlineWidth":"3px","overflow":"visible","overflowAnchor":"auto","overflowBlock":"visible","overflowClipMargin":"0px","overflowInline":"visible","overflowWrap":"normal","overflowX":"visible","overflowY":"visible","overlay":"none","overrideColors":"","overscrollBehavior":"auto","overscrollBehaviorBlock":"auto","overscrollBehaviorInline":"auto","overscrollBehaviorX":"auto","overscrollBehaviorY":"auto","pad":"","padding":"0px","paddingBlock":"0px","paddingBlockEnd":"0px","paddingBlockStart":"0px","paddingBottom":"0px","paddingInline":"0px","paddingInlineEnd":"0px","paddingInlineStart":"0px","paddingLeft":"0px","paddingRight":"0px","paddingTop":"0px","page":"auto","pageBreakAfter":"auto","pageBreakBefore":"auto","pageBreakInside":"auto","pageOrientation":"","paintOrder":"normal","perspective":"none","perspectiveOrigin":"0px 0px","placeContent":"normal","placeItems":"normal","placeSelf":"auto","pointerEvents":"auto","position":"static","positionAnchor":"none","positionArea":"none","positionTry":"none","positionTryFallbacks":"none","positionTryOrder":"normal","positionVisibility":"anchors-visible","prefix":"","printColorAdjust":"economy","quotes":"auto","r":"0px","range":"","readingFlow":"normal","readingOrder":"0","resize":"none","result":"","right":"auto","rotate":"none","rowGap":"normal","rubyAlign":"space-around","rubyPosition":"over","rx":"auto","ry":"auto","scale":"none","scrollBehavior":"auto","scrollInitialTarget":"none","scrollMargin":"0px","scrollMarginBlock":"0px","scrollMarginBlockEnd":"0px","scrollMarginBlockStart":"0px","scrollMarginBottom":"0px","scrollMarginInline":"0px","scrollMarginInlineEnd":"0px","scrollMarginInlineStart":"0px","scrollMarginLeft":"0px","scrollMarginRight":"0px","scrollMarginTop":"0px","scrollMarkerGroup":"none","scrollPadding":"auto","scrollPaddingBlock":"auto","scrollPaddingBlockEnd":"auto","scrollPaddingBlockStart":"auto","scrollPaddingBottom":"auto","scrollPaddingInline":"auto","scrollPaddingInlineEnd":"auto","scrollPaddingInlineStart":"auto","scrollPaddingLeft":"auto","scrollPaddingRight":"auto","scrollPaddingTop":"auto","scrollSnapAlign":"none","scrollSnapStop":"normal","scrollSnapType":"none","scrollTargetGroup":"none","scrollTimeline":"none","scrollTimelineAxis":"block","scrollTimelineName":"none","scrollbarColor":"auto","scrollbarGutter":"auto","scrollbarWidth":"auto","shapeImageThreshold":"0","shapeMargin":"0px","shapeOutside":"none","shapeRendering":"auto","size":"","sizeAdjust":"","speak":"normal","speakAs":"","src":"","stopColor":"rgb(0, 0, 0)","stopOpacity":"1","stroke":"none","strokeDasharray":"none","strokeDashoffset":"0px","strokeLinecap":"butt","strokeLinejoin":"miter","strokeMiterlimit":"4","strokeOpacity":"1","strokeWidth":"1px","suffix":"","symbols":"","syntax":"","system":"","tabSize":"8","tableLayout":"auto","textAlign":"start","textAlignLast":"auto","textAnchor":"start","textAutospace":"no-autospace","textBox":"normal","textBoxEdge":"auto","textBoxTrim":"none","textCombineUpright":"none","textDecoration":"none","textDecorationColor":"rgb(0, 0, 0)","textDecorationLine":"none","textDecorationSkipInk":"auto","textDecorationStyle":"solid","textDecorationThickness":"auto","textEmphasis":"none rgb(0, 0, 0)","textEmphasisColor":"rgb(0, 0, 0)","textEmphasisPosition":"over","textEmphasisStyle":"none","textIndent":"0px","textJustify":"auto","textOrientation":"mixed","textOverflow":"clip","textRendering":"auto","textShadow":"none","textSizeAdjust":"auto","textSpacingTrim":"normal","textTransform":"none","textUnderlineOffset":"auto","textUnderlinePosition":"auto","textWrap":"wrap","textWrapMode":"wrap","textWrapStyle":"auto","timelineScope":"none","timelineTrigger":"none","timelineTriggerActivationRange":"normal","timelineTriggerActivationRangeEnd":"normal","timelineTriggerActivationRangeStart":"normal","timelineTriggerActiveRange":"auto","timelineTriggerActiveRangeEnd":"auto","timelineTriggerActiveRangeStart":"auto","timelineTriggerName":"none","timelineTriggerSource":"auto","top":"auto","touchAction":"auto","transform":"none","transformBox":"view-box","transformOrigin":"0px 0px","transformStyle":"flat","transition":"all","transitionBehavior":"normal","transitionDelay":"0s","transitionDuration":"0s","transitionProperty":"all","transitionTimingFunction":"ease","translate":"none","triggerScope":"none","types":"","unicodeBidi":"normal","unicodeRange":"","userSelect":"auto","vectorEffect":"none","verticalAlign":"baseline","viewTimeline":"none","viewTimelineAxis":"block","viewTimelineInset":"auto","viewTimelineName":"none","viewTransitionClass":"none","viewTransitionGroup":"normal","viewTransitionName":"none","viewTransitionScope":"none","visibility":"visible","webkitAlignContent":"normal","webkitAlignItems":"normal","webkitAlignSelf":"auto","webkitAnimation":"none","webkitAnimationDelay":"0s","webkitAnimationDirection":"normal","webkitAnimationDuration":"0s","webkitAnimationFillMode":"none","webkitAnimationIterationCount":"1","webkitAnimationName":"none","webkitAnimationPlayState":"running","webkitAnimationTimingFunction":"ease","webkitAppRegion":"none","webkitAppearance":"none","webkitBackfaceVisibility":"visible","webkitBackgroundClip":"border-box","webkitBackgroundOrigin":"padding-box","webkitBackgroundSize":"auto","webkitBorderAfter":"0px none rgb(0, 0, 0)","webkitBorderAfterColor":"rgb(0, 0, 0)","webkitBorderAfterStyle":"none","webkitBorderAfterWidth":"0px","webkitBorderBefore":"0px none rgb(0, 0, 0)","webkitBorderBeforeColor":"rgb(0, 0, 0)","webkitBorderBeforeStyle":"none","webkitBorderBeforeWidth":"0px","webkitBorderBottomLeftRadius":"0px","webkitBorderBottomRightRadius":"0px","webkitBorderEnd":"0px none rgb(0, 0, 0)","webkitBorderEndColor":"rgb(0, 0, 0)","webkitBorderEndStyle":"none","webkitBorderEndWidth":"0px","webkitBorderHorizontalSpacing":"0px","webkitBorderImage":"none","webkitBorderRadius":"0px","webkitBorderStart":"0px none rgb(0, 0, 0)","webkitBorderStartColor":"rgb(0, 0, 0)","webkitBorderStartStyle":"none","webkitBorderStartWidth":"0px","webkitBorderTopLeftRadius":"0px","webkitBorderTopRightRadius":"0px","webkitBorderVerticalSpacing":"0px","webkitBoxAlign":"stretch","webkitBoxDecorationBreak":"slice","webkitBoxDirection":"normal","webkitBoxFlex":"0","webkitBoxOrdinalGroup":"1","webkitBoxOrient":"horizontal","webkitBoxPack":"start","webkitBoxReflect":"none","webkitBoxShadow":"none","webkitBoxSizing":"content-box","webkitClipPath":"none","webkitColumnBreakAfter":"auto","webkitColumnBreakBefore":"auto","webkitColumnBreakInside":"auto","webkitColumnCount":"auto","webkitColumnGap":"normal","webkitColumnRule":"3px rgb(0, 0, 0)","webkitColumnRuleColor":"rgb(0, 0, 0)","webkitColumnRuleStyle":"none","webkitColumnRuleWidth":"3px","webkitColumnSpan":"none","webkitColumnWidth":"auto","webkitColumns":"auto","webkitFilter":"none","webkitFlex":"0 1 auto","webkitFlexBasis":"auto","webkitFlexDirection":"row","webkitFlexFlow":"row nowrap","webkitFlexGrow":"0","webkitFlexShrink":"1","webkitFlexWrap":"nowrap","webkitFontFeatureSettings":"normal","webkitFontSmoothing":"auto","webkitHyphenateCharacter":"auto","webkitJustifyContent":"normal","webkitLineBreak":"auto","webkitLineClamp":"none","webkitLocale":"auto","webkitLogicalHeight":"0px","webkitLogicalWidth":"0px","webkitMarginAfter":"8px","webkitMarginBefore":"8px","webkitMarginEnd":"8px","webkitMarginStart":"8px","webkitMask":"none","webkitMaskBoxImage":"none","webkitMaskBoxImageOutset":"0","webkitMaskBoxImageRepeat":"stretch","webkitMaskBoxImageSlice":"0 fill","webkitMaskBoxImageSource":"none","webkitMaskBoxImageWidth":"auto","webkitMaskClip":"border-box","webkitMaskComposite":"add","webkitMaskImage":"none","webkitMaskOrigin":"border-box","webkitMaskPosition":"0% 0%","webkitMaskPositionX":"0%","webkitMaskPositionY":"0%","webkitMaskRepeat":"repeat","webkitMaskSize":"auto","webkitMaxLogicalHeight":"none","webkitMaxLogicalWidth":"none","webkitMinLogicalHeight":"0px","webkitMinLogicalWidth":"0px","webkitOpacity":"1","webkitOrder":"0","webkitPaddingAfter":"0px","webkitPaddingBefore":"0px","webkitPaddingEnd":"0px","webkitPaddingStart":"0px","webkitPerspective":"none","webkitPerspectiveOrigin":"0px 0px","webkitPerspectiveOriginX":"","webkitPerspectiveOriginY":"","webkitPrintColorAdjust":"economy","webkitRtlOrdering":"logical","webkitRubyPosition":"before","webkitShapeImageThreshold":"0","webkitShapeMargin":"0px","webkitShapeOutside":"none","webkitTapHighlightColor":"rgba(0, 0, 0, 0.18)","webkitTextCombine":"none","webkitTextDecorationsInEffect":"none","webkitTextEmphasis":"none rgb(0, 0, 0)","webkitTextEmphasisColor":"rgb(0, 0, 0)","webkitTextEmphasisPosition":"over","webkitTextEmphasisStyle":"none","webkitTextFillColor":"rgb(0, 0, 0)","webkitTextOrientation":"vertical-right","webkitTextSecurity":"none","webkitTextSizeAdjust":"auto","webkitTextStroke":"0px rgb(0, 0, 0)","webkitTextStrokeColor":"rgb(0, 0, 0)","webkitTextStrokeWidth":"0px","webkitTransform":"none","webkitTransformOrigin":"0px 0px","webkitTransformOriginX":"","webkitTransformOriginY":"","webkitTransformOriginZ":"","webkitTransformStyle":"flat","webkitTransition":"all","webkitTransitionDelay":"0s","webkitTransitionDuration":"0s","webkitTransitionProperty":"all","webkitTransitionTimingFunction":"ease","webkitUserDrag":"auto","webkitUserModify":"read-only","webkitUserSelect":"auto","webkitWritingMode":"horizontal-tb","whiteSpace":"normal","whiteSpaceCollapse":"collapse","widows":"2","width":"0px","willChange":"auto","wordBreak":"normal","wordSpacing":"0px","wordWrap":"normal","writingMode":"horizontal-tb","x":"0px","y":"0px","zIndex":"auto","zoom":"1"};

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
  // Chrome clamps every resolved layout length at LayoutUnit's maximum
  // (2^31 / 64 = 33554431.98 -> the observable clamp value is 33554430): an
  // authored `width: 8e37px`, `-8e37px`, `8e37%` or an overflowing em/vw unit
  // all answer `3.35544e+07px`, and the box measures ~33554430 CSS px.
  // Chrome also serializes computed lengths >= 1e6 in CSSOM scientific form.
  // Answering the raw magnitude (or `infpx`) is a value no browser produces.
  const _LAYOUT_UNIT_MAX = 33554430;
  const _sciPx = (v) => {
    const [mant, exp] = v.toExponential(5).split('e');
    const e = parseInt(exp, 10);
    return `${mant}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}px`;
  };
  const chromeLengthPx = (v) => {
    if (!Number.isFinite(v)) return _sciPx(_LAYOUT_UNIT_MAX);
    const clamped = Math.abs(v) > _LAYOUT_UNIT_MAX ? _LAYOUT_UNIT_MAX : v;
    return Math.abs(clamped) >= 1e6 ? _sciPx(clamped) : `${clamped}px`;
  };
  const _DIMENSION_PROPS = new Set(['width', 'height', 'inline-size', 'block-size',
    'min-width', 'min-height', 'max-width', 'max-height', 'max-inline-size', 'max-block-size',
    'left', 'top', 'right', 'bottom', 'client-width', 'client-height',
    'offset-width', 'offset-height']);
  // Authored dimension values that overflow Chrome's layout range answer the
  // clamp instead of echoing the authored magnitude.
  const clampAuthoredDimension = (kebab, value) => {
    if (!_DIMENSION_PROPS.has(kebab) || typeof value !== 'string') return value;
    const t = value.trim();
    if (/^[-+]?(inf(inity)?|nan)(px|%)?$/i.test(t)) return chromeLengthPx(Infinity);
    const m = t.match(/^(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|em|rem|ex|ch|vw|vh|%|cm|mm|in|pt|pc|q|vmin|vmax)?$/);
    if (!m) return value;
    const n = Number(m[1]);
    if (Number.isFinite(n) && Math.abs(n) <= _LAYOUT_UNIT_MAX) return value;
    return chromeLengthPx(n);
  };
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
          return r.width != null ? chromeLengthPx(r.width) : null;
        case 'height': case 'block-size':
          return r.height != null ? chromeLengthPx(r.height) : null;
        case 'left': return r.left != null ? chromeLengthPx(r.left) : null;
        case 'top': return r.top != null ? chromeLengthPx(r.top) : null;
        case 'right': return r.right != null ? chromeLengthPx(r.right) : null;
        case 'bottom': return r.bottom != null ? chromeLengthPx(r.bottom) : null;
        case 'client-width': case 'offset-width':
          return r.width != null ? chromeLengthPx(r.width) : null;
        case 'client-height': case 'offset-height':
          return r.height != null ? chromeLengthPx(r.height) : null;
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

  const lookupValue = (rawProp) => {
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
      return clampAuthoredDimension(kebab, inlineVal);
    }
    const dim = dimensionFor(kebab);
    if (dim != null) return dim;
    if (defaultsKebab[rawProp]) return defaultsKebab[rawProp];
    if (defaultsKebab[kebab]) return defaultsKebab[kebab];
    const camelFallback = _cssKebabToCamel(kebab);
    if (Object.prototype.hasOwnProperty.call(_CHROME_COMPUTED_DEFAULTS, camelFallback)) {
      return _CHROME_COMPUTED_DEFAULTS[camelFallback];
    }
    if (Object.prototype.hasOwnProperty.call(_CHROME_COMPUTED_DEFAULTS, rawProp)) {
      return _CHROME_COMPUTED_DEFAULTS[rawProp];
    }
    return '';
  };

  const target = style;
  // Every answer for a box-dimension property passes the layout-range clamp,
  // whichever source produced it (renderer snapshot, inline echo, or the
  // synthesized rect): Chrome reports the clamp for any overflowing value.
  const lookup = (rawProp) => {
    const value = lookupValue(rawProp);
    if (typeof rawProp !== 'string') return value;
    const kebab = rawProp.replace(/([A-Z])/g, '-$1').toLowerCase();
    return clampAuthoredDimension(kebab, value);
  };
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
      // The indexed getters answer with the property NAME, like every
      // browser's CSSStyleDeclaration; they must not fall through to
      // lookup(), which answers '' for a numeric string.
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        refreshRendered();
        const name = snapshot.names[+prop];
        return name !== undefined ? name : undefined;
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
      // Chrome's computed style carries camelCase own keys (descriptor
      // reflections included); dashed spellings stay reachable through the
      // get trap without being enumerable own properties.
      keys.push(..._CSS_COMPUTED_CAMEL_KEYS);
      return keys;
    },
    getOwnPropertyDescriptor(_, prop) {
      if (typeof prop !== 'string') return undefined;
      refreshRendered();
      if (/^\d+$/.test(prop) && +prop < snapshot.names.length) {
        return { value: snapshot.names[+prop], writable: false, enumerable: true, configurable: true };
      }
      if (_CSS_PROP_SET.has(prop) || _CSS_COMPUTED_CAMEL_SET.has(prop)) {
        return { value: lookup(prop), writable: true, enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
};

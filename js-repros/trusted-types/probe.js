// Trusted Types: the API surface a page can observe with no CSP in force.
//
// Obscura had no implementation at all -- `window.trustedTypes` was undefined,
// which is a Firefox/Safari answer, not a Chrome one. This pins the factory,
// the policy objects, the three trusted wrapper types and the sink behaviour
// on a document that sends no Content-Security-Policy.
globalThis.ttFixturePromise = (async () => {
  const out = {};

  out.factoryType = typeof globalThis.trustedTypes;
  out.interfaceObjects = {};
  for (const name of [
    'TrustedTypePolicyFactory', 'TrustedTypePolicy',
    'TrustedHTML', 'TrustedScript', 'TrustedScriptURL',
  ]) {
    const value = globalThis[name];
    out.interfaceObjects[name] = typeof value === 'undefined' ? 'undefined' : {
      type: typeof value,
      construct: (() => {
        try { new value(); return 'constructed'; }
        catch (error) { return `${error.name}: ${error.message}`; }
      })(),
    };
  }
  if (typeof globalThis.trustedTypes === 'undefined') {
    globalThis.ttFixtureResult = out;
    return out;
  }
  const tt = globalThis.trustedTypes;

  const attempt = thunk => {
    try { return {ok: true, value: thunk()}; }
    catch (error) { return {ok: false, name: error.name, message: error.message}; }
  };
  const describe = value => ({
    tag: Object.prototype.toString.call(value),
    string: String(value),
    ctor: value && value.constructor && value.constructor.name,
    json: typeof value?.toJSON === 'function' ? value.toJSON() : 'no-toJSON',
    typeofValue: typeof value,
  });

  out.factoryTag = Object.prototype.toString.call(tt);
  out.factoryCtorName = tt.constructor && tt.constructor.name;
  out.factoryOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, 'trustedTypes');
  out.emptyHTML = describe(tt.emptyHTML);
  out.emptyScript = describe(tt.emptyScript);
  out.defaultPolicyBefore = tt.defaultPolicy;
  out.memberTypes = {};
  for (const key of [
    'createPolicy', 'isHTML', 'isScript', 'isScriptURL',
    'getAttributeType', 'getPropertyType',
  ]) {
    out.memberTypes[key] = typeof tt[key];
  }

  const policy = tt.createPolicy('probe-policy', {
    createHTML: input => input.replace(/</g, '&lt;'),
    createScript: input => `/*checked*/${input}`,
    createScriptURL: input => `${input}?checked`,
  });
  out.policyTag = Object.prototype.toString.call(policy);
  out.policyCtorName = policy.constructor && policy.constructor.name;
  out.policyName = policy.name;
  out.policyNameWritable = (() => {
    const descriptor =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(policy), 'name');
    return descriptor ? {accessor: typeof descriptor.get === 'function'} : 'own-or-missing';
  })();

  const html = policy.createHTML('<img src=x>');
  const script = policy.createScript('alert(1)');
  const scriptUrl = policy.createScriptURL('https://example.com/a.js');
  out.html = describe(html);
  out.script = describe(script);
  out.scriptUrl = describe(scriptUrl);
  out.brandChecks = {
    isHTML: tt.isHTML(html),
    isHTMLOnString: tt.isHTML('<b>'),
    isHTMLOnScript: tt.isHTML(script),
    isScript: tt.isScript(script),
    isScriptURL: tt.isScriptURL(scriptUrl),
    instanceofHTML: html instanceof TrustedHTML,
    instanceofScript: script instanceof TrustedScript,
    instanceofScriptURL: scriptUrl instanceof TrustedScriptURL,
  };
  // A forged object must not pass the brand check.
  out.forged = tt.isHTML(Object.create(TrustedHTML.prototype));

  // A policy without a given callback cannot produce that type.
  const bare = tt.createPolicy('bare-policy', {});
  out.bareCreateHTML = attempt(() => bare.createHTML('x'));
  out.duplicateName = attempt(() => tt.createPolicy('probe-policy', {}));
  out.emptyName = attempt(() => tt.createPolicy(''));
  out.missingArgument = attempt(() => tt.createPolicy());
  out.createHTMLNoArgs = attempt(() => policy.createHTML());

  out.attributeTypes = {
    scriptSrc: tt.getAttributeType('script', 'src'),
    divId: tt.getAttributeType('div', 'id'),
    iframeSrcdoc: tt.getAttributeType('iframe', 'srcdoc'),
    embedSrc: tt.getAttributeType('embed', 'src'),
    objectData: tt.getAttributeType('object', 'data'),
    objectCodebase: tt.getAttributeType('object', 'codebase'),
    divOnclick: tt.getAttributeType('div', 'onclick'),
    upperCase: tt.getAttributeType('SCRIPT', 'SRC'),
    imgSrc: tt.getAttributeType('img', 'src'),
    missingArg: attempt(() => tt.getAttributeType('div')),
  };
  out.propertyTypes = {
    divInnerHTML: tt.getPropertyType('div', 'innerHTML'),
    divOuterHTML: tt.getPropertyType('div', 'outerHTML'),
    divTextContent: tt.getPropertyType('div', 'textContent'),
    scriptText: tt.getPropertyType('script', 'text'),
    scriptTextContent: tt.getPropertyType('script', 'textContent'),
    scriptInnerText: tt.getPropertyType('script', 'innerText'),
    scriptSrc: tt.getPropertyType('script', 'src'),
    divId: tt.getPropertyType('div', 'id'),
    iframeSrcdoc: tt.getPropertyType('iframe', 'srcdoc'),
    embedSrc: tt.getPropertyType('embed', 'src'),
    objectData: tt.getPropertyType('object', 'data'),
    upperCaseProperty: tt.getPropertyType('DIV', 'innerHTML'),
    unknownProperty: tt.getPropertyType('div', 'innerHTMLX'),
  };

  // With no CSP the sinks stay permissive, and a trusted value stringifies
  // into them like any other object with a toString.
  const host = document.createElement('div');
  out.sinkAcceptsString = attempt(() => { host.innerHTML = '<b>plain</b>'; return host.innerHTML; });
  out.sinkAcceptsTrusted = attempt(() => {
    host.innerHTML = policy.createHTML('<i>x</i>');
    return host.innerHTML;
  });

  // Creating a policy named "default" installs it as defaultPolicy.
  const fallback = tt.createPolicy('default', {createHTML: input => `DEFAULT:${input}`});
  out.defaultPolicyAfter = tt.defaultPolicy === fallback ? 'same-object' : String(tt.defaultPolicy);
  out.defaultPolicyName = tt.defaultPolicy && tt.defaultPolicy.name;

  globalThis.ttFixtureResult = out;
  return out;
})();

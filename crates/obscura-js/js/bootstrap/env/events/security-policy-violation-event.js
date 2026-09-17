// CSP violations are real WebIDL events in every document, including frame
// documents. Keep their payload in a WeakMap so constructing one does not add
// observable own string properties beyond Event's `isTrusted` slot.
const _securityPolicyViolationState = new WeakMap();
globalThis.SecurityPolicyViolationEvent = class SecurityPolicyViolationEvent extends Event {
  constructor(type, init = {}) {
    if (arguments.length < 1) {
      throw new TypeError("Failed to construct 'SecurityPolicyViolationEvent': 1 argument required, but only 0 present.");
    }
    super(type, init);
    const value = init && typeof init === 'object' ? init : {};
    _securityPolicyViolationState.set(this, {
      documentURI: value.documentURI == null ? '' : String(value.documentURI),
      referrer: value.referrer == null ? '' : String(value.referrer),
      blockedURI: value.blockedURI == null ? '' : String(value.blockedURI),
      violatedDirective: value.violatedDirective == null ? '' : String(value.violatedDirective),
      effectiveDirective: value.effectiveDirective == null ? '' : String(value.effectiveDirective),
      originalPolicy: value.originalPolicy == null ? '' : String(value.originalPolicy),
      disposition: value.disposition == null ? 'enforce' : String(value.disposition),
      sourceFile: value.sourceFile == null ? '' : String(value.sourceFile),
      statusCode: Number.isFinite(Number(value.statusCode)) ? Number(value.statusCode) : 0,
      lineNumber: Number.isFinite(Number(value.lineNumber)) ? Number(value.lineNumber) : 0,
      columnNumber: Number.isFinite(Number(value.columnNumber)) ? Number(value.columnNumber) : 0,
      sample: value.sample == null ? '' : String(value.sample),
    });
  }
};
for (const name of [
  'documentURI', 'referrer', 'blockedURI', 'violatedDirective',
  'effectiveDirective', 'originalPolicy', 'disposition', 'sourceFile',
  'statusCode', 'lineNumber', 'columnNumber', 'sample',
]) {
  Object.defineProperty(SecurityPolicyViolationEvent.prototype, name, {
    configurable: true,
    enumerable: true,
    get() {
      const state = _securityPolicyViolationState.get(this);
      if (!state) throw new TypeError('Illegal invocation');
      return state[name];
    },
  });
}
Object.defineProperty(SecurityPolicyViolationEvent.prototype, Symbol.toStringTag, {
  value: 'SecurityPolicyViolationEvent', configurable: true,
});
{
  const constructor = Object.getOwnPropertyDescriptor(
    SecurityPolicyViolationEvent.prototype, 'constructor');
  delete SecurityPolicyViolationEvent.prototype.constructor;
  Object.defineProperty(SecurityPolicyViolationEvent.prototype, 'constructor', constructor);
}
_markNative(globalThis.SecurityPolicyViolationEvent);

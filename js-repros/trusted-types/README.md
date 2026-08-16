# Trusted Types fixture

**Status: partially enabled.** The API surface is installed, the CSP
`trusted-types` policy-name allowlist is enforced, and common HTML/script sinks
honour `require-trusted-types-for 'script'`.

`eval(TrustedScript)` is wired through the vendored V8
`ModifyCodeGenerationFromStrings` callback. The callback converts only the
TrustedScript brand and preserves ordinary eval(object) behavior.

## Capture

```bash
node js-repros/trusted-types/capture-chrome.mjs
```

```bash
python3 -m http.server 8733 --directory js-repros/trusted-types
obscura fetch http://127.0.0.1:8733/ --allow-private-network --wait 2 \
  --eval 'JSON.stringify(globalThis.ttFixtureResult)'
```

`chrome-oracle.json` is the Google Chrome 146.0.7680.80 capture, taken on a
document that sends no Content-Security-Policy.

## Result

All 101 observables are identical to Chrome. That covers:

- The five interface objects, each throwing
  `Failed to construct 'X': Illegal constructor`.
- `trustedTypes` as an **own** property of the global, tagged
  `[object TrustedTypePolicyFactory]`.
- `createPolicy` and the resulting `TrustedTypePolicy` (a `name` accessor on the
  prototype), its three `create*` methods, and their `TrustedHTML` /
  `TrustedScript` / `TrustedScriptURL` results with matching `toString`,
  `toJSON` and `@@toStringTag`.
- **Real brand checks**: `isHTML(Object.create(TrustedHTML.prototype))` is
  `false`. Membership is tracked in a WeakMap, so a prototype-only forgery does
  not pass -- matching Chrome, and the whole point of the type.
- Error shapes: a policy with no `createHTML` member, a missing argument to
  `createPolicy` or `createHTML`.
- Duplicate and empty policy names being **accepted** (only a CSP
  `trusted-types` directive makes them errors), and `default` installing
  `trustedTypes.defaultPolicy`.
- The `getAttributeType` / `getPropertyType` sink tables, including
  case-insensitive element and attribute names, case-*sensitive* property
  names, and `on*` content attributes reporting `TrustedScript`.

## Remaining CSP gaps

The `trusted-types` policy-name allowlist, common script sinks, and
`eval(TrustedScript)` are enforced. The full CSP resource matrix is still being
expanded.

On a document that sends `require-trusted-types-for 'script'`, Obscura now
rejects plain strings at `innerHTML`, `srcdoc`, and script text sinks, while
allowing values returned by an allowed policy or its `default` policy.

Completing the remaining behavior needs broader CSP sink and resource
instrumentation.

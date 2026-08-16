# Trusted Types fixture

**Status: partially enabled.** The API surface is installed, the CSP
`trusted-types` policy-name allowlist is enforced, and common HTML/script sinks
honour `require-trusted-types-for 'script'`.

Why it is off: `eval(trustedScript)` cannot be implemented from JavaScript. eval
returns a non-string argument unchanged; Trusted Types replaces that step with a
host hook, which Chrome services through V8's ModifyCodeGenerationFromStrings
callback. rusty_v8 does not expose it, and official builds link the prebuilt
librusty_v8. Every other sink is correct -- only eval is missing -- but a page
that feature-detects `window.trustedTypes` switches to the Trusted Types path on
that one check alone, and its `eval(policy.createScript(...))` then silently does
nothing. That regressed a real challenge page; the failure was bisected to
`1f963b7` and reproduced by injecting an equivalent surface into the preceding
build. See docs/Cloudflare-challenge-profile.md step 49-52.

The remaining engine-level gap is `eval(TrustedScript)`: it needs V8's
`ModifyCodeGenerationFromStrings` callback, which rusty_v8 does not expose.
Consequently the full Chrome oracle remains ignored until that hook is added.

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

The `trusted-types` policy-name allowlist and common script sinks are enforced.
The full CSP resource matrix is still being expanded, and `eval(TrustedScript)`
cannot yet be wired to the V8 host hook.

On a document that sends `require-trusted-types-for 'script'`, Obscura now
rejects plain strings at `innerHTML`, `srcdoc`, and script text sinks, while
allowing values returned by an allowed policy or its `default` policy.

Completing the remaining behavior needs the V8 eval hook plus broader sink and
resource instrumentation.

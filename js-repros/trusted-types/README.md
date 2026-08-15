# Trusted Types fixture

`window.trustedTypes` did not exist at all. That is a Firefox/Safari answer, and
it contradicts every other Chrome signal this build sends -- a page that reads
`typeof trustedTypes` gets "undefined" from something claiming to be Chrome 146.

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

## Not implemented: CSP enforcement

`require-trusted-types-for 'script'` is **not** enforced, and neither is the
`trusted-types` directive's policy-name allowlist. Nothing in the engine parses
or enforces any CSP directive yet: `Content-Security-Policy` is read off the
response and stored on the document (`DocumentInfo.csp`), and no further.

This is invisible to a document that sends no such policy, which is what the
oracle above covers -- Chrome's sinks are permissive then too, and the fixture
confirms Obscura's are as well, for both plain strings and trusted values. On a
document that *does* send `require-trusted-types-for 'script'`, Chrome refuses a
plain string at `innerHTML` and Obscura accepts it. Sites that ship such a
policy do their own work through a policy object, so their code path still runs;
what is missing is the refusal, not the mechanism.

Closing this needs a CSP parser and sink instrumentation, which is a larger
piece of work than the API surface and is deliberately not faked here.

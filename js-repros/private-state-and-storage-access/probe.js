globalThis.privateStateFixturePromise = (async () => {
  const describe = name => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
    return descriptor && {
      name: descriptor.value.name,
      length: descriptor.value.length,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
      writable: descriptor.writable,
      string: String(descriptor.value),
    };
  };
  const outcome = async callback => {
    try { return { kind: 'resolve', value: await callback() }; }
    catch (error) { return { kind: 'reject', name: error.name }; }
  };
  const firstPromise = document.hasPrivateToken('https://one.example/path');
  return {
    descriptors: {
      token: describe('hasPrivateToken'),
      redemption: describe('hasRedemptionRecord'),
      storage: describe('hasStorageAccess'),
    },
    returnsPromise: firstPromise instanceof Promise,
    tokenFirst: await firstPromise,
    tokenSecond: await document.hasPrivateToken('https://two.example'),
    tokenThird: await outcome(() => document.hasPrivateToken('https://three.example')),
    redemptionThird: await outcome(() => document.hasRedemptionRecord('https://three.example')),
    invalidIssuer: await outcome(() => document.hasRedemptionRecord('http://issuer.example')),
    missingArgument: await outcome(() => document.hasPrivateToken()),
    detachedToken: await outcome(() => Document.prototype.hasPrivateToken.call(
      document.implementation.createHTMLDocument('detached'),
      'https://issuer.example')),
    topLevelStorageAccess: await document.hasStorageAccess(),
    detachedStorage: await outcome(() => Document.prototype.hasStorageAccess.call(
      document.implementation.createHTMLDocument('detached'))),
  };
})().then(result => {
  globalThis.privateStateFixtureResult = result;
  return result;
})

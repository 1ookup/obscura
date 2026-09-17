// What `fetch(url, {redirect})` does with each of the three modes.
//
// `Request` has recorded `init.redirect` since the class was written, and the
// value went nowhere: the fetch path never passed it on, so all three modes
// behaved as `follow`. `error` is supposed to reject and `manual` is supposed
// to hand back an opaque-redirect response, and both are supposed to leave the
// redirect *target* unfetched -- which is visible in the server's access log
// without any page-side check at all.
//
// Served over loopback HTTP by serve.mjs; the port is random, so every URL is
// reported with the origin replaced by `<origin>`.
globalThis.fetchRedirectFixturePromise = (async () => {
  const origin = location.origin;
  const scrub = value => typeof value === 'string' ? value.split(origin).join('<origin>') : value;

  async function describe(path, init) {
    try {
      const response = await fetch(path, init);
      let bodyText = null;
      let bodyError = null;
      try {
        bodyText = await response.text();
      } catch (error) {
        bodyError = error?.name || String(error);
      }
      return {
        settled: 'fulfilled',
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        type: response.type,
        redirected: response.redirected,
        url: scrub(response.url),
        bodyText,
        bodyError,
        // An opaque-redirect response has a *guarded, empty* header list --
        // the Location that drove the redirect must not be readable.
        headerNames: [...response.headers.keys()].sort(),
        location: response.headers.get('location'),
      };
    } catch (error) {
      return {
        settled: 'rejected',
        name: error?.name || null,
        isTypeError: error instanceof TypeError,
        message: scrub(error?.message || String(error)),
      };
    }
  }

  const result = {};

  // The default. Named explicitly so the fixture pins that `follow` is what
  // you get when nothing is asked for.
  result.defaultNoInit = await describe('/redirect-once');
  result.explicitFollow = await describe('/redirect-once', {redirect: 'follow'});
  result.followTwoHops = await describe('/redirect-twice', {redirect: 'follow'});
  result.followToMissing = await describe('/redirect-to-404', {redirect: 'follow'});

  // `error`: the redirect is the failure, and it is a TypeError with no
  // further detail -- the same shape as any other network failure.
  result.errorOnRedirect = await describe('/redirect-once', {redirect: 'error'});
  result.errorOnTwoHops = await describe('/redirect-twice', {redirect: 'error'});
  // No redirect happens, so `error` must not interfere at all.
  result.errorOnPlain = await describe('/target.txt', {redirect: 'error'});
  // A 3xx with no Location is not a redirect; `error` must let it through.
  result.errorOnNoLocation = await describe('/redirect-no-location', {redirect: 'error'});

  // `manual`: an opaque-redirect response. Status, headers and body are all
  // withheld; the point is that a navigation-like consumer can hand the
  // response somewhere else without the page learning where it points.
  result.manualOnRedirect = await describe('/redirect-once', {redirect: 'manual'});
  result.manualOnTwoHops = await describe('/redirect-twice', {redirect: 'manual'});
  result.manualWithBody = await describe('/redirect-with-body', {redirect: 'manual'});
  result.manualOnPlain = await describe('/target.txt', {redirect: 'manual'});
  result.manualOnNoLocation = await describe('/redirect-no-location', {redirect: 'manual'});

  // Status codes other than 302, in case any of them is treated differently.
  result.manualOn301 = await describe('/redirect-301', {redirect: 'manual'});
  result.manualOn303 = await describe('/redirect-303', {redirect: 'manual'});
  result.manualOn307 = await describe('/redirect-307', {redirect: 'manual'});
  result.manualOn308 = await describe('/redirect-308', {redirect: 'manual'});
  result.errorOn308 = await describe('/redirect-308', {redirect: 'error'});

  // A Request carries the mode, and fetch(request) must honour what the
  // Request says rather than only what an inline init says.
  result.viaRequestObject = await describe(
    new Request(origin + '/redirect-once', {redirect: 'error'}),
  );
  result.requestRedirectReadback = {
    default: new Request(origin + '/x').redirect,
    error: new Request(origin + '/x', {redirect: 'error'}).redirect,
    manual: new Request(origin + '/x', {redirect: 'manual'}).redirect,
    follow: new Request(origin + '/x', {redirect: 'follow'}).redirect,
  };
  // An init on the call site overrides what the Request was built with.
  result.initOverridesRequest = await describe(
    new Request(origin + '/redirect-once', {redirect: 'error'}),
    {redirect: 'follow'},
  );

  // An invalid enum value. Chrome's WebIDL layer decides this, not the fetch
  // algorithm, so it should throw synchronously rather than reject.
  try {
    const bogus = new Request(origin + '/x', {redirect: 'sideways'});
    result.invalidRedirectValue = {threw: false, value: bogus.redirect};
  } catch (error) {
    result.invalidRedirectValue = {
      threw: true,
      name: error?.name || null,
      isTypeError: error instanceof TypeError,
    };
  }

  return result;
})();

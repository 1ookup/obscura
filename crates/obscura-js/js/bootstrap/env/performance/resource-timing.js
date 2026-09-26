// A Resource Timing entry's transferSize counts the response headers as well
// as the body, so it always exceeds encodedBodySize on a real connection --
// by a flat 300 bytes on the h2 links these responses arrive over. Reporting
// the two as equal is a one-subtraction tell.
const _RESOURCE_HEADER_BYTES = 300;

// The transport decodes gzip and brotli before the body reaches this realm, so
// a response's own byte length is its decodedBodySize and says nothing about
// what crossed the wire. Chrome reports the encoded length there, and a
// document that is served compressed but claims a body-sized encodedBodySize
// is a tell -- 77937 on the wire against 337517 decoded is what a real browser
// sees for the same response. The encoded length survives the decode only as
// the response's Content-Length, which is the compressed size whenever a
// content coding was applied and the decoded size otherwise.
function _encodedBodySizeFor(headers, decodedSize) {
  const declared = Number(headers && headers['content-length']);
  return Number.isFinite(declared) && declared >= 0
    ? declared
    : Math.max(0, +decodedSize || 0);
}

// The protocol a response arrived over. The transport does not surface the
// negotiated ALPN value, and every https origin the engine talks to serves
// h2, so derive it from the scheme rather than leave the attribute empty --
// no browser ever reports "" for a resource whose timing is exposed.
function _nextHopProtocolFor(url) {
  try {
    return new URL(url).protocol === 'https:' ? 'h2' : 'http/1.1';
  } catch (_error) {
    return '';
  }
}

// File a response that came back through `op_fetch_url` in this realm's
// Performance Timeline. Callers used to inline their own copy of the
// Timing-Allow-Origin check and the phase timestamps, and only some of them
// filed an entry at all: a dynamically inserted <script src> left no trace,
// so a page that counts its own resources saw one where a browser sees three.
function _recordFetchResourceTiming(parsed, initiatorType, fetchStart, pageOrigin, bodySize) {
  const record = globalThis.__obscura_performance_record;
  if (typeof record !== 'function' || !parsed || !parsed.status) return;
  const url = String(parsed.url || '');
  const timing = parsed.timing || {};
  const responseEnd = fetchStart + Math.max(0, +timing.responseEnd || 0);
  let allowed = true;
  try {
    const origin = new URL(url).origin;
    if (origin !== pageOrigin) {
      const tao = String((parsed.headers || {})['timing-allow-origin'] || '');
      allowed = tao.split(',').map(value => value.trim())
        .some(value => value === '*' || value === pageOrigin);
    }
  } catch (_error) {}
  const decodedSize = allowed ? Math.max(0, +bodySize || 0) : 0;
  const size = allowed ? _encodedBodySizeFor(parsed.headers, decodedSize) : 0;
  record({
    name: url,
    entryType: 'resource',
    initiatorType,
    // A denied Timing-Allow-Origin hides the protocol along with the phase
    // timestamps and the sizes.
    nextHopProtocol: allowed ? _nextHopProtocolFor(url) : '',
    startTime: fetchStart,
    duration: Math.max(0, responseEnd - fetchStart),
    redirectStart: timing.redirectCount ? fetchStart : 0,
    redirectEnd: timing.redirectCount ? fetchStart + Math.max(0, +timing.redirectEnd || 0) : 0,
    fetchStart,
    domainLookupStart: allowed ? fetchStart : 0,
    domainLookupEnd: allowed ? fetchStart : 0,
    connectStart: allowed ? fetchStart : 0,
    connectEnd: allowed ? fetchStart : 0,
    requestStart: allowed ? fetchStart : 0,
    responseStart: allowed ? fetchStart + Math.max(0, +timing.responseStart || 0) : 0,
    responseEnd,
    transferSize: size ? size + _RESOURCE_HEADER_BYTES : 0,
    encodedBodySize: size,
    decodedBodySize: decodedSize,
    responseStatus: allowed ? parsed.status : 0,
  });
}

// File an image fetch in this realm's Performance Timeline. Only the request
// that actually went to the network carries `timing`, so followers of an
// in-flight fetch and cache hits add no duplicate entry. Without a
// Timing-Allow-Origin grant a cross-origin image exposes only its response
// end and no sizes, exactly like the fetch path above.
function _recordImageResourceTiming(metadata, fetchStart) {
  const timing = metadata && metadata.timing;
  if (!timing || typeof timing !== "object") return;
  const record = globalThis.__obscura_performance_record;
  if (typeof record !== "function") return;
  const allowed = timing.timingAllowed !== false;
  const responseStart = fetchStart + Math.max(0, +timing.responseStart || 0);
  const responseEnd = fetchStart + Math.max(0, +timing.responseEnd || 0);
  const redirected = (+timing.redirectCount || 0) > 0;
  const size = Math.max(0, +timing.encodedBodySize || 0);
  const decoded = Math.max(0, +timing.decodedBodySize || 0) || size;
  record({
    name: String(timing.url || ""),
    entryType: "resource",
    // Resource Timing names the initiator after the element's local name, so
    // an <img> reports "img" -- not "image".
    initiatorType: "img",
    startTime: fetchStart,
    duration: Math.max(0, responseEnd - fetchStart),
    redirectStart: redirected && allowed ? fetchStart : 0,
    redirectEnd: redirected && allowed ? fetchStart + Math.max(0, +timing.redirectEnd || 0) : 0,
    fetchStart,
    domainLookupStart: allowed ? fetchStart : 0,
    domainLookupEnd: allowed ? fetchStart : 0,
    connectStart: allowed ? fetchStart : 0,
    connectEnd: allowed ? fetchStart : 0,
    requestStart: allowed ? fetchStart : 0,
    responseStart: allowed ? responseStart : 0,
    responseEnd,
    nextHopProtocol: allowed ? _nextHopProtocolFor(timing.url || "") : '',
    transferSize: allowed && size ? size + _RESOURCE_HEADER_BYTES : 0,
    encodedBodySize: allowed ? size : 0,
    decodedBodySize: allowed ? decoded : 0,
    responseStatus: allowed ? (+timing.status || 0) : 0,
  });
}


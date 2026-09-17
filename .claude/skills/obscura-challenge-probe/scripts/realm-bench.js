// Two probes: a JIT-friendly arithmetic loop (tells whether the optimizing
// tier is active) and a string/charCodeAt loop shaped like the challenge's
// compute shard.
function benchArith(n){
  var h = 1|0, t0 = performance.now();
  for (var i = 0; i < n; i++) { h = (h * 31 + i) ^ (h >>> 7); h = h | 0; }
  return { ms: performance.now() - t0, h: h };
}
function benchStr(iters){
  var s = 'aAbAcAdAeAfAgAhAiAjAkAlAmAnAoApAqArAsAtAuAvAwAxAyAzA0A1A2A3A4A5A6A7A8A9';
  var t0 = performance.now(), acc = 0;
  for (var k = 0; k < iters; k++) {
    var x = 0;
    for (var j = 0; j < s.length; j++) { x = ((x << 5) - x + s.charCodeAt(j)) | 0; }
    s = s.slice(1) + String.fromCharCode(97 + (acc % 26));
    acc = (acc + x) | 0;
  }
  return { ms: performance.now() - t0, acc: acc, len: s.length };
}
function benchFloat(n){
  var x = 0.5, y = 1.7, t0 = performance.now();
  for (var i = 0; i < n; i++) { x = Math.sin(x * y + i) * 1.0000001; y = x / 1.7 + 0.3; }
  return { ms: performance.now() - t0, x: x };
}
function runAll(){
  // warm up, then measure
  benchArith(50000); benchStr(200); benchFloat(50000);
  return { arith: benchArith(300000), str: benchStr(1500), float: benchFloat(200000),
           resolved: (function(){ try { return !!new (Function.prototype.bind.apply(Function))('return 1')(); } catch(e){ return 'no-eval'; } })() };
}

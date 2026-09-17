// Encode an RGBA pixel buffer into a valid PNG data URL.
// Uses stored-block DEFLATE (no compression) wrapped in zlib.
// This produces a larger file than a real browser but the hash is unique
// per session (from _fpNoise) and valid, so it does not match the known
// headless stub.
function _encodePNG(w, h, rgba) {
  // RGBA scanlines: filter byte (0) + 4 bytes per pixel.
  var rowLen = 1 + w * 4;
  var raw = new Uint8Array(h * rowLen);
  for (var y = 0; y < h; y++) {
    var base = y * rowLen;
    raw[base] = 0;
    for (var x = 0; x < w; x++) {
      var s = (y * w + x) << 2, d = base + 1 + x * 4;
      raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
    }
  }
  // Adler32 of raw
  var s1 = 1, s2 = 0, M = 65521;
  for (var i = 0; i < raw.length; i++) { s1 = (s1 + raw[i]) % M; s2 = (s2 + s1) % M; }
  var adler = ((s2 << 16) | s1) >>> 0;
  // Stored DEFLATE blocks (zlib level 0)
  var MAXB = 65535, nb = Math.ceil(raw.length / MAXB) || 1;
  var dlen = 2 + nb * 5 + raw.length + 4;
  var def = new Uint8Array(dlen), dp = 0;
  def[dp++] = 0x78; def[dp++] = 0x01;
  for (var bi = 0; bi < nb; bi++) {
    var bs = bi * MAXB, be = Math.min(raw.length, bs + MAXB), bl = be - bs;
    def[dp++] = bi === nb-1 ? 1 : 0;
    def[dp++] = bl&0xff; def[dp++] = (bl>>8)&0xff;
    def[dp++] = (~bl)&0xff; def[dp++] = (~bl>>8)&0xff;
    def.set(raw.subarray(bs, be), dp); dp += bl;
  }
  def[dp++]=(adler>>24)&0xff; def[dp++]=(adler>>16)&0xff; def[dp++]=(adler>>8)&0xff; def[dp]=adler&0xff;
  // CRC32 (lazy table)
  if (!_encodePNG._t) {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):(c>>>1); t[n]=c; }
    _encodePNG._t = t;
  }
  var T = _encodePNG._t;
  function crc32(a, st, ln) { var c=0xFFFFFFFF; for(var i=st,e=st+ln;i<e;i++) c=T[(c^a[i])&0xff]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
  function putChunk(out, off, type, data) {
    var dl = data.length;
    out[off]=(dl>>24)&0xff; out[off+1]=(dl>>16)&0xff; out[off+2]=(dl>>8)&0xff; out[off+3]=dl&0xff;
    out[off+4]=type.charCodeAt(0); out[off+5]=type.charCodeAt(1); out[off+6]=type.charCodeAt(2); out[off+7]=type.charCodeAt(3);
    out.set(data, off+8);
    var cr = crc32(out, off+4, 4+dl);
    out[off+8+dl]=(cr>>24)&0xff; out[off+9+dl]=(cr>>16)&0xff; out[off+10+dl]=(cr>>8)&0xff; out[off+11+dl]=cr&0xff;
    return off+12+dl;
  }
  var ihd = new Uint8Array(13);
  ihd[0]=(w>>24)&0xff; ihd[1]=(w>>16)&0xff; ihd[2]=(w>>8)&0xff; ihd[3]=w&0xff;
  ihd[4]=(h>>24)&0xff; ihd[5]=(h>>16)&0xff; ihd[6]=(h>>8)&0xff; ihd[7]=h&0xff;
  ihd[8]=8; ihd[9]=6; // 8-bit RGBA
  var png = new Uint8Array(8 + 25 + (12+dlen) + 12);
  png.set([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  var p = 8;
  p = putChunk(png, p, 'IHDR', ihd);
  p = putChunk(png, p, 'IDAT', def);
  putChunk(png, p, 'IEND', new Uint8Array(0));
  // Base64 encode
  var C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var b64 = 'data:image/png;base64,';
  for (var i = 0; i < png.length; i += 3) {
    var a=png[i], b=i+1<png.length?png[i+1]:0, c=i+2<png.length?png[i+2]:0;
    b64 += C[a>>2] + C[((a&3)<<4)|(b>>4)] + (i+1<png.length?C[((b&15)<<2)|(c>>6)]:'=') + (i+2<png.length?C[c&63]:'=');
  }
  return b64;
}


// --- <input> number/date conversion (valueAsNumber/valueAsDate/stepUp/Down) ---
// Applicable types and their step scale factor + default step (HTML spec).
const _INPUT_NUM_TYPES = { date: 1, month: 1, week: 1, time: 1, 'datetime-local': 1, number: 1, range: 1 };
const _INPUT_DATE_TYPES = { date: 1, month: 1, week: 1, time: 1, 'datetime-local': 1 };
const _INPUT_STEP_SCALE = { date: 86400000, 'datetime-local': 1000, month: 1, number: 1, range: 1, time: 1000, week: 604800000 };
const _INPUT_STEP_DEFAULT = { date: 1, 'datetime-local': 60, month: 1, number: 1, range: 1, time: 60, week: 1 };
function _pad(n, w) { n = String(Math.abs(n | 0)); while (n.length < w) n = '0' + n; return n; }
function _daysInMonth(y, m) { return [31, ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function _isoWeek1Monday(y) { const jan4 = Date.UTC(y, 0, 4); const dow = (new Date(jan4).getUTCDay() + 6) % 7; return jan4 - dow * 86400000; }
// Parse an <input> value string to its numeric form per type; NaN if invalid.
function _inputParseNumber(type, v) {
  v = String(v == null ? '' : v);
  let m;
  switch (type) {
    case 'number': case 'range': { if (v === '') return NaN; const n = Number(v); return isFinite(n) ? n : NaN; }
    case 'date': if ((m = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(v))) { const y = +m[1], mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= _daysInMonth(y, mo)) return Date.UTC(y, mo - 1, d); } return NaN;
    case 'month': if ((m = /^(\d{4,})-(\d{2})$/.exec(v))) { const y = +m[1], mo = +m[2]; if (mo >= 1 && mo <= 12) return (y - 1970) * 12 + (mo - 1); } return NaN;
    case 'week': if ((m = /^(\d{4,})-W(\d{2})$/.exec(v))) { const y = +m[1], w = +m[2]; if (w >= 1 && w <= 53) return _isoWeek1Monday(y) + (w - 1) * 604800000; } return NaN;
    case 'time': if ((m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(v))) { const h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0, ms = m[4] ? +((m[4] + '00').slice(0, 3)) : 0; if (h <= 23 && mi <= 59 && s <= 59) return ((h * 60 + mi) * 60 + s) * 1000 + ms; } return NaN;
    case 'datetime-local': if ((m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(v))) { const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0, ms = m[7] ? +((m[7] + '00').slice(0, 3)) : 0; if (mo >= 1 && mo <= 12 && d >= 1 && d <= _daysInMonth(y, mo) && h <= 23 && mi <= 59 && s <= 59) return Date.UTC(y, mo - 1, d, h, mi, s, ms); } return NaN;
  }
  return NaN;
}
// Format a numeric value back to an <input> value string per type.
function _inputFormatNumber(type, n) {
  switch (type) {
    case 'number': case 'range': return String(n);
    case 'date': { const dt = new Date(n); return _pad(dt.getUTCFullYear(), 4) + '-' + _pad(dt.getUTCMonth() + 1, 2) + '-' + _pad(dt.getUTCDate(), 2); }
    case 'month': { const y = 1970 + Math.floor(n / 12); const mo = ((n % 12) + 12) % 12 + 1; return _pad(y, 4) + '-' + _pad(mo, 2); }
    case 'week': { const d = new Date(n); const dow = (d.getUTCDay() + 6) % 7; const thu = n - dow * 86400000 + 3 * 86400000; const ty = new Date(thu).getUTCFullYear(); const w = Math.round((n - dow * 86400000 - _isoWeek1Monday(ty)) / 604800000) + 1; return _pad(ty, 4) + '-W' + _pad(w, 2); }
    case 'time': { n = ((n % 86400000) + 86400000) % 86400000; const ms = n % 1000; n = Math.floor(n / 1000); const s = n % 60; n = Math.floor(n / 60); const mi = n % 60; const h = Math.floor(n / 60); let str = _pad(h, 2) + ':' + _pad(mi, 2); if (s || ms) { str += ':' + _pad(s, 2); if (ms) str += '.' + _pad(ms, 3); } return str; }
    case 'datetime-local': { const dt = new Date(n); let str = _pad(dt.getUTCFullYear(), 4) + '-' + _pad(dt.getUTCMonth() + 1, 2) + '-' + _pad(dt.getUTCDate(), 2) + 'T' + _pad(dt.getUTCHours(), 2) + ':' + _pad(dt.getUTCMinutes(), 2); const s = dt.getUTCSeconds(), ms = dt.getUTCMilliseconds(); if (s || ms) { str += ':' + _pad(s, 2); if (ms) str += '.' + _pad(ms, 3); } return str; }
  }
  return String(n);
}

// WebIDL interface constants live on both the interface object and the interface
// prototype object (instances inherit; idlharness checks Node.prototype).
Object.assign(Node.prototype, {
  ELEMENT_NODE: 1, ATTRIBUTE_NODE: 2, TEXT_NODE: 3, CDATA_SECTION_NODE: 4,
  ENTITY_REFERENCE_NODE: 5, ENTITY_NODE: 6, PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_TYPE_NODE: 10, DOCUMENT_FRAGMENT_NODE: 11,
  NOTATION_NODE: 12, DOCUMENT_POSITION_DISCONNECTED: 1, DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_CONTAINS: 8,
  DOCUMENT_POSITION_CONTAINED_BY: 16, DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
});

// HTML elements ASCII-lowercase attribute names (setAttribute('accessKey') is
// stored as 'accesskey'). The toLowerCase is gated behind a cheap uppercase
// charCode scan so the all-lowercase common case (href, class, id, data-*)
// allocates nothing and never consults the namespace; only when an uppercase
// ASCII letter is present do we check the element is HTML before folding.
function _htmlAttrName(el, n) {
  n = typeof n === "string" ? n : String(n);
  for (let i = 0; i < n.length; i++) {
    const c = n.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      return el.namespaceURI === "http://www.w3.org/1999/xhtml" ? n.toLowerCase() : n;
    }
  }
  return n;
}


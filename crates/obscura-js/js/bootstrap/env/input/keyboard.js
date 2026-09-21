// The layout the passing reference session's real Chrome on this machine
// reported (payload /IeOS2): a US board plus `IntlBackslash` -> "section",
// 48 entries. Both the membership and the ITERATION ORDER are load-bearing:
// the challenge snapshot serializes the maplike in its own order, and the
// reference order is Chrome's internal hash order, not alphabetical and not
// keyboard-geometric. Keep this array byte-for-byte in that order.
const _KEYBOARD_LAYOUT_US = [
  ['KeyK', 'k'], ['KeyG', 'g'], ['Digit2', '2'], ['Digit0', '0'],
  ['KeyV', 'v'], ['KeyA', 'a'], ['Backquote', '`'], ['KeyL', 'l'],
  ['IntlBackslash', '§'], ['Quote', "'"], ['KeyW', 'w'], ['Digit8', '8'],
  ['KeyM', 'm'], ['KeyH', 'h'], ['Period', '.'], ['Digit7', '7'],
  ['Digit1', '1'], ['KeyP', 'p'], ['KeyD', 'd'], ['KeyF', 'f'],
  ['KeyO', 'o'], ['KeyQ', 'q'], ['KeyC', 'c'], ['KeyN', 'n'],
  ['BracketLeft', '['], ['KeyZ', 'z'], ['KeyY', 'y'], ['Digit3', '3'],
  ['Digit6', '6'], ['Digit5', '5'], ['KeyX', 'x'], ['Slash', '/'],
  ['Backslash', '\\'], ['Comma', ','], ['Minus', '-'], ['Digit4', '4'],
  ['KeyB', 'b'], ['KeyT', 't'], ['Digit9', '9'], ['KeyS', 's'],
  ['KeyI', 'i'], ['KeyU', 'u'], ['Equal', '='], ['KeyJ', 'j'],
  ['Semicolon', ';'], ['KeyR', 'r'], ['BracketRight', ']'], ['KeyE', 'e'],
];
// KeyboardLayoutMap is maplike and read-only: it answers `get`/`has`/`size`
// and iterates, but has no `set`. A plain Map would answer `set` too.

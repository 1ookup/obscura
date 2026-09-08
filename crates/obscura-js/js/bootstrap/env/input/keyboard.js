// This is the US ANSI layout, which is the one the reported Windows identity
// implies -- notably without `IntlBackslash`, the extra key an ISO board has
// and an ANSI board does not.
const _KEYBOARD_LAYOUT_US = [
  ['Backquote', '`'], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'],
  ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['Digit7', '7'],
  ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-'],
  ['Equal', '='],
  ['KeyQ', 'q'], ['KeyW', 'w'], ['KeyE', 'e'], ['KeyR', 'r'], ['KeyT', 't'],
  ['KeyY', 'y'], ['KeyU', 'u'], ['KeyI', 'i'], ['KeyO', 'o'], ['KeyP', 'p'],
  ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\'],
  ['KeyA', 'a'], ['KeyS', 's'], ['KeyD', 'd'], ['KeyF', 'f'], ['KeyG', 'g'],
  ['KeyH', 'h'], ['KeyJ', 'j'], ['KeyK', 'k'], ['KeyL', 'l'],
  ['Semicolon', ';'], ['Quote', "'"],
  ['KeyZ', 'z'], ['KeyX', 'x'], ['KeyC', 'c'], ['KeyV', 'v'], ['KeyB', 'b'],
  ['KeyN', 'n'], ['KeyM', 'm'], ['Comma', ','], ['Period', '.'], ['Slash', '/'],
];
// KeyboardLayoutMap is maplike and read-only: it answers `get`/`has`/`size`
// and iterates, but has no `set`. A plain Map would answer `set` too.

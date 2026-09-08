// interface prototype free of duplicate Node entries so frame `for..in`
// follows the native Document -> Node ordering.
for (const _documentNodeName of [
  'textContent', 'nodeType', 'nodeName', 'ownerDocument',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
]) {
  try { delete Document.prototype[_documentNodeName]; } catch (_e) {}
}

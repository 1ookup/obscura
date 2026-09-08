# Bootstrap Structure

The bootstrap is organized like HaHaVM's `core/env` tree: one Web API object
or constructor lives in one file, and a manifest assembles those files into the
single classic script consumed by V8 snapshots and secondary realms.

`../bootstrap.js` is the ordered manifest. The Rust build assembler adds one
outer IIFE around the concatenated modules. Order is part of the runtime
contract: object files may refer to earlier shared helpers or constructors,
but they must not be converted to ES modules or wrapped in independent IIFEs.
The runtime intentionally shares one lexical global so DOM wrappers keep the
same Rust-backed symbols, WeakMap state, and `instanceof` brands in a realm.

The final `config/webidl-branding.js` module runs after the window surface
finalizer. It owns the late constructor names and `Symbol.toStringTag` pass;
keeping it as a separate final module avoids a cross-file closing `})();`.

`env/dom/element-object.js` is the complete `Element` object. The old
`env/dom/element.js` path is a compatibility placeholder only and is not in the
manifest; it used to hold the middle of a class opened in `html-parser.js`.

Some files remain support modules. They contain shared private state, parsers,
schedulers, or tightly coupled conditional fallbacks used by several objects.
Their corresponding object files are listed immediately after them in the
manifest. Moving only a class while leaving its descriptor/native-marking
postlude behind can read a temporal-dead-zone binding during snapshot creation,
so those postludes stay with the object they initialize.

When adding an API:

1. Put shared state and pure helpers in the smallest existing support module.
2. Put the public constructor/object and its registration in a dedicated object
   file named after the Web API.
3. Add the object file to `bootstrap.js` directly after its support/dependency
   modules, preserving the classic-script order.
4. Run the focused `obscura-js` nextest and the source-build snapshot check.

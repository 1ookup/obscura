# Frame layout cache fixture

Repeated geometry reads of an unchanged iframe document reuse the cached scene;
the cache is keyed by frame document generation and viewport and is discarded
when a connected mutation invalidates style/layout.

Chrome 146 comparison is pending because Chrome is unavailable on the current
host. Rust render tests cover cache reuse and generation invalidation without
depending on a site or timing-sensitive screenshot.

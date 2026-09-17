# IndexedDB persistence fixture

Run once with `--storage-dir DIR`, restart the browser with the same directory,
and verify `indexedDbFixture` returns `{"value":42}` without another upgrade.

Chrome 146 comparison is pending because Chrome is unavailable on the current
host. The persistence check uses one profile directory across two CLI
processes and inspects the origin/name-keyed JSON backing file.

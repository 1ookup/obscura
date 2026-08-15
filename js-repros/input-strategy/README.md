# Input strategy fixture

Run with `OBSCURA_AUTO_CLICK_SELECTOR=#target`. The policy-driven sequence
contains pointer events followed by one activation click; no visible text or
hostname is consulted by the engine.

Chrome 146 comparison is pending because Chrome is unavailable on the current
host. The deterministic assertion is the serialized event order
(`pointerdown,click`).

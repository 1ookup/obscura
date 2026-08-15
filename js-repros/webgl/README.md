# WebGL consistency fixture

The default no-backend policy returns `null`. Set `OBSCURA_WEBGL_PROFILE=1` to
enable the value-level consistency layer and verify vendor, renderer, limits,
and extension values are derived from the browser fingerprint policy.

Chrome 146 comparison is pending because Chrome is unavailable on the current
host. The default result is intentionally `null`; the profile result is only
enabled by the explicit environment policy.

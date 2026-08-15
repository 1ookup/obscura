# Form label IDL fixture

The expected result is `{control:true,labels:1}`. Calling `label.click()` must
also dispatch the activation click on `field`.

Chrome 146 comparison is pending because Chrome is unavailable on the current
host. The Obscura fixture asserts the standard IDL values and activation path.

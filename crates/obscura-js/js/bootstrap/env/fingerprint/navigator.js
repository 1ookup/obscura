// Fingerprint surfaces (UA, plugins, webdriver, etc.) live on the prototype
// hop below, not as own props here: own accessors are a bot tell.
// BatteryManager is an EventTarget-backed interface. Keep the existing
// fingerprint-derived values, but expose one stable branded object with the
// standard change-handler attributes instead of returning a fresh plain record.
if (typeof BatteryManager === 'undefined') {
  globalThis.BatteryManager = class BatteryManager extends EventTarget {
    constructor() { throw new TypeError("Failed to construct 'BatteryManager': Illegal constructor"); }
    get charging() { _batteryManagerAssert(this); return !!_fp('batteryCharging'); }
    get chargingTime() { _batteryManagerAssert(this); return this.charging ? 0 : Infinity; }
    get dischargingTime() {
      _batteryManagerAssert(this);
      return this.charging ? Infinity : Math.floor(3600 + _fpRand(250) * 7200);
    }
    get level() { _batteryManagerAssert(this); return _fp('batteryLevel'); }
  };
}
const _batteryManagerInstances = new WeakSet();
const _batteryManagerAssert = instance => {
  if (!_batteryManagerInstances.has(instance)) throw new TypeError('Illegal invocation');
};
_markNative(BatteryManager);
for (const _batteryGetter of ['charging', 'chargingTime', 'dischargingTime', 'level']) {
  const _descriptor = Object.getOwnPropertyDescriptor(BatteryManager.prototype, _batteryGetter);
  if (_descriptor?.get) _markNative(_descriptor.get);
}
const _batteryEventHandlers = new WeakMap();
for (const _batteryEvent of [
  'chargingchange', 'chargingtimechange', 'dischargingtimechange', 'levelchange',
]) {
  const _slot = 'on' + _batteryEvent;
  Object.defineProperty(BatteryManager.prototype, _slot, {
    get() { _batteryManagerAssert(this); return _batteryEventHandlers.get(this)?.[_slot] || null; },
    set(value) {
      _batteryManagerAssert(this);
      const handlers = _batteryEventHandlers.get(this);
      handlers[_slot] = typeof value === 'function' ? value : null;
    },
    enumerable: true,
    configurable: true,
  });
  const _handlerDescriptor = Object.getOwnPropertyDescriptor(BatteryManager.prototype, _slot);
  _markNative(_handlerDescriptor.get);
  _markNative(_handlerDescriptor.set);
}
Object.defineProperty(BatteryManager.prototype, Symbol.toStringTag, {
  value: 'BatteryManager', configurable: true,
});
const _batteryManagerInstance = Object.create(BatteryManager.prototype);
_batteryManagerInstances.add(_batteryManagerInstance);
_batteryEventHandlers.set(_batteryManagerInstance, Object.create(null));

// VirtualKeyboard is exposed even when no software keyboard backend exists.
// Provide the interface shape and inert state without inventing geometry or
// dispatching synthetic keyboard events.
if (typeof VirtualKeyboard === 'undefined') {
  globalThis.VirtualKeyboard = class VirtualKeyboard extends EventTarget {
    constructor() { throw new TypeError("Failed to construct 'VirtualKeyboard': Illegal constructor"); }
    get boundingRect() {
      _virtualKeyboardData(this);
      return typeof DOMRect === 'function' ? new DOMRect(0, 0, 0, 0) : null;
    }
    get overlaysContent() { return _virtualKeyboardData(this).overlaysContent; }
    set overlaysContent(value) {
      _virtualKeyboardData(this).overlaysContent = Boolean(value);
    }
    get ongeometrychange() { return _virtualKeyboardData(this).ongeometrychange; }
    set ongeometrychange(value) {
      _virtualKeyboardData(this).ongeometrychange = typeof value === 'function' ? value : null;
    }
    hide() {}
    show() {}
  };
}
const _virtualKeyboardState = new WeakMap();
function _virtualKeyboardData(instance) {
  let state = _virtualKeyboardState.get(instance);
  if (!state) {
    if (!(instance instanceof VirtualKeyboard)) throw new TypeError('Illegal invocation');
    state = { overlaysContent: false, ongeometrychange: null };
    _virtualKeyboardState.set(instance, state);
  }
  return state;
}
_markNative(VirtualKeyboard);
for (const _virtualKeyboardMethod of ['hide', 'show']) {
  _markNative(VirtualKeyboard.prototype[_virtualKeyboardMethod]);
}
for (const _virtualKeyboardProperty of ['boundingRect', 'overlaysContent', 'ongeometrychange']) {
  const _descriptor = Object.getOwnPropertyDescriptor(VirtualKeyboard.prototype, _virtualKeyboardProperty);
  if (_descriptor?.get) _markNative(_descriptor.get);
  if (_descriptor?.set) _markNative(_descriptor.set);
}
Object.defineProperty(VirtualKeyboard.prototype, Symbol.toStringTag, {
  value: 'VirtualKeyboard', configurable: true,
});
function registerNavigatorSurface() {
globalThis.navigator = _bootstrapObject('navigator', () => ({
  onLine: true, cookieEnabled: true,
  maxTouchPoints: 0,
  // Legacy Navigator attributes every browser still reports verbatim. Their
  // absence read as `undefined` in an environment probe's value map, which is
  // a value no browser produces for them.
  appName: "Netscape", appCodeName: "Mozilla", vendorSub: "",
  vendor: "Google Inc.", product: "Gecko", productSub: "20030107",
  doNotTrack: null,
  connection: new NetworkInformation(_networkInformationKey),
  pdfViewerEnabled: true,
  userAgentData: _bootstrapObject('navigator.userAgentData', () => ({
    get mobile() { return !!_fingerprint().mobile; },
    get brands() { return _uaBrands(); },
    get platform() { return _fingerprint().uaPlatform || ""; },
    getHighEntropyValues(hints) {
      if (arguments.length === 0) {
        return Promise.reject(new TypeError("Failed to execute 'getHighEntropyValues' on 'NavigatorUAData': 1 argument required, but only 0 present."));
      }
      const requested = new Set(Array.from(hints, String));
      const fingerprint = _fingerprint();
      const result = {};
      if (requested.has('architecture')) result.architecture = fingerprint.architecture || '';
      if (requested.has('bitness')) result.bitness = fingerprint.bitness || '';
      result.brands = _uaBrands();
      if (requested.has('fullVersionList')) {
        result.fullVersionList = (fingerprint.fullVersionList || []).map(item => ({brand:item.brand,version:item.version}));
      }
      result.mobile = !!fingerprint.mobile;
      if (requested.has('model')) result.model = fingerprint.model || '';
      result.platform = fingerprint.uaPlatform || '';
      if (requested.has('platformVersion')) result.platformVersion = fingerprint.uaPlatformVersion || '';
      if (requested.has('uaFullVersion')) result.uaFullVersion = fingerprint.browserVersion || '';
      if (requested.has('wow64')) result.wow64 = !!fingerprint.wow64;
      return Promise.resolve(result);
    },
    toJSON() { return {brands:this.brands,mobile:this.mobile,platform:this.platform}; },
  })),
  // serviceWorker is an accessor on Navigator.prototype (see
  // _installServiceWorkerInterfaces); Chrome has no own property here.
  // The dedicated MediaDevices shape module replaces this slot without
  // changing Navigator's observable property insertion order.
  mediaDevices: undefined,
  clipboard: _bootstrapObject('navigator.clipboard', () => ({ writeText(){return Promise.resolve();}, readText(){return Promise.resolve("");} })),
  permissions: _bootstrapObject('navigator.permissions', () => ({ query(params){
    var n = params && params.name;
    return Promise.resolve({state: _permissionState(n), onchange: null});
  } })),
  getBattery() { return Promise.resolve(_batteryManagerInstance); },
  getGamepads() { return [null, null, null, null]; },
  sendBeacon(url, data) {
    // Beacon queues a credentials-including POST and returns before the
    // response arrives. Reuse the realm fetch path so CSP, proxy, cookies,
    // and request interception stay identical to other page requests.
    try {
      if (arguments.length < 1) return false;
      const target = new URL(String(url), location.href).href;
      let body = data;
      if (data instanceof Blob && data.type) {
        // fetch preserves Blob MIME metadata in the request body.
        body = data;
      }
      Promise.resolve(fetch(target, {
        method: 'POST', body, keepalive: true, credentials: 'include',
      })).catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  },
  javaEnabled() { return false; },
  geolocation: _bootstrapObject('navigator.geolocation', () => ({
    getCurrentPosition(success, error) {
      const coords = {
        latitude: (globalThis.__obscura_geo_lat ?? 50.1109) + (_fpRand(500) - 0.5) * 0.1,
        longitude: (globalThis.__obscura_geo_lon ?? 8.6821) + (_fpRand(501) - 0.5) * 0.1,
        accuracy: 10 + _fpRand(502) * 40,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      };
      const pos = { coords, timestamp: Date.now() };
      if (typeof success === 'function') success(pos);
    },
    watchPosition(success, error) {
      if (typeof success === 'function') {
        const coords = {
          latitude: (globalThis.__obscura_geo_lat ?? 50.1109) + (_fpRand(503) - 0.5) * 0.1,
          longitude: (globalThis.__obscura_geo_lon ?? 8.6821) + (_fpRand(504) - 0.5) * 0.1,
          accuracy: 10 + _fpRand(505) * 40,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        };
        success({ coords, timestamp: Date.now() });
      }
      return 0;
    },
    clearWatch() {},
  })),
  storage: _bootstrapObject('navigator.storage', () => ({
    estimate() { return Promise.resolve({ quota: 5000000000, usage: Math.floor(_fpRand(640) * 100000000) }); },
    persist() { return Promise.resolve(false); },
    persisted() { return Promise.resolve(false); },
  })),
}));
}
registerNavigatorSurface();

// Put spoofed navigator props on a thin prototype above Navigator.prototype
// so hasOwnProperty/getOwnPropertyDescriptor on the instance match Chrome.
// Getters read __obscura_* lazily (snapshot vs per-page) and are _markNative'd.
(function() {
  var _navProto = Object.create(Navigator.prototype);

  function defGetter(key, fn) {
    _markNative(fn);
    Object.defineProperty(_navProto, key, {
      get: fn, set: undefined, enumerable: true, configurable: true,
    });
  }

  defGetter('webdriver', function() { return false; });
  defGetter('userAgent', function() {
    return _fingerprint().userAgent || '';
  });
  defGetter('appVersion', function() {
    return (_fingerprint().userAgent || '').replace('Mozilla/', '');
  });
  defGetter('platform', function() {
    return _fingerprint().navigatorPlatform || '';
  });
  defGetter('language', function() { return _fingerprint().language || "en-US"; });
  defGetter('languages', function() {
    const values = _fingerprint().languages;
    return Array.isArray(values) && values.length
      ? values
      : [_fingerprint().language || "en-US"];
  });

  // Cache plugins/mimeTypes so navigator.plugins === navigator.plugins.
  var _plugins = new PluginArray([
    new Plugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format", []),
    new Plugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format", []),
    new Plugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format", []),
    new Plugin("Microsoft Edge PDF Viewer", "internal-pdf-viewer", "Portable Document Format", []),
    new Plugin("WebKit built-in PDF", "internal-pdf-viewer", "Portable Document Format", []),
  ]);
  var _mimeTypes = new MimeTypeArray([
    new MimeType("application/pdf", "Portable Document Format", "pdf", null),
    new MimeType("text/pdf", "Portable Document Format", "pdf", null),
  ]);
  defGetter('plugins', function() { return _plugins; });
  defGetter('mimeTypes', function() { return _mimeTypes; });

  // Values set per-page by __obscura_init (avoids own data props on navigator).
  defGetter('hardwareConcurrency', function() { return _fingerprint().hardwareConcurrency || 1; });
  defGetter('deviceMemory', function() { return _fingerprint().deviceMemory || 0.25; });

  _navProto.share = _markNative(function share(data) {
    return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
  });
  _navProto.canShare = _markNative(function canShare() { return false; });

  Object.setPrototypeOf(globalThis.navigator, _navProto);
})();

globalThis.chrome = {
  app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } },
  runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, connect() { throw new Error("Could not establish connection. Receiving end does not exist."); }, sendMessage() { throw new Error("Could not establish connection. Receiving end does not exist."); } },
  csi() {
    const t = Date.now();
    return { onloadT: t, startE: t - Math.floor(100 + _fpRand(610) * 200), pageT: 0, tran: 5, flashVersion: "" };
  },
  loadTimes() {
    const t = Date.now() / 1000;
    const request = t - 0.5 - _fpRand(611) * 0.5;
    const startLoad = request + 0.05 + _fpRand(612) * 0.02;
    const commit = request + 0.3 + _fpRand(613) * 0.4;
    const finishDoc = commit + 0.1 + _fpRand(614) * 0.2;
    const finish = finishDoc + 0.05 + _fpRand(615) * 0.1;
    const firstPaint = commit + 0.03 + _fpRand(616) * 0.1;
    const navTypes = ["BackForward","Reload","Link","Other"];
    return {
      requestTime: request, startLoadTime: startLoad * 1000, commitLoadTime: commit * 1000,
      finishDocumentLoadTime: finishDoc * 1000, finishLoadTime: finish * 1000,
      firstPaintTime: firstPaint * 1000, firstPaintAfterLoadTime: 0,
      navigationType: navTypes[Math.floor(_fpRand(617) * 4)],
      wasFetchedViaSpdy: false, wasNpnNegotiated: false,
      npnNegotiatedProtocol: "http/1.1",
      wasAlternateProtocolAvailable: false, connectionInfo: "http/1.1",
    };
  },
};

globalThis.Notification = class Notification {
  static permission = "default";
  static requestPermission() { return Promise.resolve(Notification.permission); }
  constructor() {}
};

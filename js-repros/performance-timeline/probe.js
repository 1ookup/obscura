(() => {
  const navigation = performance.getEntriesByType('navigation')[0];
  const resource = performance.getEntriesByType('resource')
    .find(entry => entry.name.endsWith('/resource.js'));
  const measure = performance.getEntriesByName('fixture-span', 'measure')[0];
  return {
    supportedCoreTypes: ['mark', 'measure', 'navigation', 'paint', 'resource']
      .every(type => PerformanceObserver.supportedEntryTypes.includes(type)),
    navigationCount: performance.getEntriesByType('navigation').length,
    navigationOrdered: !!navigation && navigation.startTime === 0
      && navigation.fetchStart >= navigation.startTime
      && navigation.responseStart >= navigation.requestStart
      && navigation.responseEnd >= navigation.responseStart
      && navigation.loadEventEnd >= navigation.domContentLoadedEventEnd,
    resourceCount: performance.getEntriesByType('resource')
      .filter(entry => entry.name.endsWith('/resource.js')).length,
    resourceOrdered: !!resource && resource.fetchStart >= resource.startTime
      && resource.responseStart >= resource.requestStart
      && resource.responseEnd >= resource.responseStart,
    responseStatus: resource && resource.responseStatus,
    measure: measure && [measure.startTime, measure.duration],
    resourceLoaded: globalThis.performanceTimelineResourceLoaded === true,
  };
})()

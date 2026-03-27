const metrics = {
  operations: {},
  counters: {
    sessionsStarted: 0,
    sessionsCompleted: 0,
    sessionsCancelled: 0,
    pendingRollbacks: 0,
    appliedChanges: 0,
    cleanupRuns: 0,
    cleanedSessions: 0,
    errors: 0
  },
  cleanup: {
    intervalMs: 300000,
    lastRunAt: null,
    lastRemovedCount: 0
  }
};

function getOperationBucket(operation) {
  if (!metrics.operations[operation]) {
    metrics.operations[operation] = {
      count: 0,
      handled: 0,
      success: 0,
      failures: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      lastDurationMs: 0,
      lastRunAt: null
    };
  }

  return metrics.operations[operation];
}

export function recordWaClientConfigOperation(operation, durationMs, {
  handled = true,
  success = true
} = {}) {
  const bucket = getOperationBucket(operation);
  bucket.count += 1;
  bucket.handled += handled ? 1 : 0;
  bucket.success += success ? 1 : 0;
  bucket.failures += success ? 0 : 1;
  bucket.totalDurationMs += durationMs;
  bucket.maxDurationMs = Math.max(bucket.maxDurationMs, durationMs);
  bucket.lastDurationMs = durationMs;
  bucket.lastRunAt = new Date().toISOString();
}

export function incrementWaClientConfigCounter(counterName, value = 1) {
  if (!(counterName in metrics.counters)) {
    metrics.counters[counterName] = 0;
  }
  metrics.counters[counterName] += value;
}

export function recordWaClientConfigCleanup(removedCount, intervalMs) {
  metrics.cleanup.lastRunAt = new Date().toISOString();
  metrics.cleanup.lastRemovedCount = removedCount;
  metrics.cleanup.intervalMs = intervalMs;
  incrementWaClientConfigCounter('cleanupRuns');
  incrementWaClientConfigCounter('cleanedSessions', removedCount);
}

export function getWaClientConfigMetrics() {
  return JSON.parse(JSON.stringify(metrics));
}

export function resetWaClientConfigMetrics() {
  metrics.operations = {};
  metrics.counters = {
    sessionsStarted: 0,
    sessionsCompleted: 0,
    sessionsCancelled: 0,
    pendingRollbacks: 0,
    appliedChanges: 0,
    cleanupRuns: 0,
    cleanedSessions: 0,
    errors: 0
  };
  metrics.cleanup = {
    intervalMs: 300000,
    lastRunAt: null,
    lastRemovedCount: 0
  };
}

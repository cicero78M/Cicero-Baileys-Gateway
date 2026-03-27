import {
  getWaClientConfigMetrics,
  incrementWaClientConfigCounter,
  recordWaClientConfigCleanup,
  recordWaClientConfigOperation,
  resetWaClientConfigMetrics
} from '../../src/service/waClientConfigMetrics.js';

describe('waClientConfigMetrics', () => {
  beforeEach(() => {
    resetWaClientConfigMetrics();
  });

  test('should record counters and per-operation latency snapshots', () => {
    incrementWaClientConfigCounter('sessionsStarted');
    incrementWaClientConfigCounter('appliedChanges', 2);
    recordWaClientConfigOperation('client_selection', 42, { handled: true, success: true });
    recordWaClientConfigOperation('client_selection', 84, { handled: true, success: false });

    const metrics = getWaClientConfigMetrics();

    expect(metrics.counters.sessionsStarted).toBe(1);
    expect(metrics.counters.appliedChanges).toBe(2);
    expect(metrics.operations.client_selection).toEqual(expect.objectContaining({
      count: 2,
      handled: 2,
      success: 1,
      failures: 1,
      maxDurationMs: 84,
      lastDurationMs: 84
    }));
  });

  test('should record cleanup job activity', () => {
    recordWaClientConfigCleanup(3, 120000);

    const metrics = getWaClientConfigMetrics();

    expect(metrics.cleanup.intervalMs).toBe(120000);
    expect(metrics.cleanup.lastRemovedCount).toBe(3);
    expect(metrics.counters.cleanupRuns).toBe(1);
    expect(metrics.counters.cleanedSessions).toBe(3);
  });
});

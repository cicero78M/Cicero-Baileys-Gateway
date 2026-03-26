import { Queue, Worker } from 'bullmq';
import Bottleneck from 'bottleneck';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

/**
 * Simple outbox queue for WhatsApp messages.
 * Jobs are rate limited globally to avoid hitting API limits.
 */
const queueName = 'wa-outbox';

// BullMQ requires an ioredis-compatible connection (node-redis is incompatible).
// maxRetriesPerRequest must be null for BullMQ workers.
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const outboxQueue = new Queue(queueName, { connection });

const limiter = new Bottleneck({
  minTime: 350,
  reservoir: 40,
  reservoirRefreshInterval: 60_000,
  reservoirRefreshAmount: 40,
});

export async function enqueueSend(jid, payload) {
  await outboxQueue.add('send', { jid, payload }, {
    removeOnComplete: true,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export function attachWorker(adapter) {
  // Adapter must implement sendText and optionally sendMedia
  return new Worker(queueName, async (job) => {
    const { jid, payload } = job.data;
    return limiter.schedule(async () => {
      if (payload.mediaPath && adapter.sendMedia) {
        return adapter.sendMedia(jid, payload.mediaPath, payload.text);
      }
      if (payload.text == null) {
        // Non-retryable: bad job payload — discard without spamming retries
        console.warn('[outbox] Skipping job with null/undefined text payload', { jid, jobId: job.id });
        return;
      }
      return adapter.sendText(jid, payload.text);
    });
  }, { connection });
}

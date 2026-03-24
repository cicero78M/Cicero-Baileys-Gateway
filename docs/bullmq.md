# BullMQ Queue Guide
*Last updated: 2026-03-24*

Cicero_V2 uses **BullMQ** (backed by the existing Redis instance) as its job-queue
solution. RabbitMQ was evaluated but removed — it would have required a separate
broker service while Redis is already a mandatory infrastructure component.

## Why BullMQ over RabbitMQ

| Criterion | BullMQ | RabbitMQ |
|---|---|---|
| Infrastructure | Redis (already required) | Separate AMQP broker |
| Retry / backoff | Built-in (exponential) | Manual implementation |
| Rate limiting | Built-in (Bottleneck integration) | Manual implementation |
| Dashboard UI | Bull Board (optional) | Management plugin |
| Node.js first-class | Yes | Via amqplib |
| Operational overhead | Low (shares Redis) | High (additional service) |

## Current Usage

### WhatsApp Outbox (`src/service/waOutbox.js`)

All outbound WhatsApp messages MUST be dispatched through this queue.

```js
import { enqueueSend } from './waOutbox.js';

// Enqueue a text message
await enqueueSend(jid, { text: 'Hello!' });

// Enqueue a media message
await enqueueSend(jid, { text: 'Caption', mediaPath: '/path/to/file.jpg' });
```

**Queue behaviour:**
- Queue name: `wa-outbox`
- Max attempts: **5** with exponential backoff (initial delay 2 s)
- Rate limit: **40 messages / 60 s** (Bottleneck)
- Completed jobs removed automatically (`removeOnComplete: true`)

### Attaching the Worker

Call `attachWorker(adapter)` once on startup, passing the active WA adapter:

```js
import { attachWorker } from './src/service/waOutbox.js';
import { waClient } from './src/service/waService.js';

const worker = attachWorker(waClient);
```

The adapter must implement `sendText(jid, text)` and optionally
`sendMedia(jid, mediaPath, text)`.

## Adding a New Job Type

1. Create a new `Queue` and `Worker` pair in a dedicated service file
   (e.g., `src/service/reportQueue.js`).
2. Use the shared `REDIS_URL` from `src/config/env.js`; pass it as
   `connection` to the Queue/Worker constructors.
3. Register the worker in `app.js` (or a dedicated worker entry point).
4. Add a unit test mocking the Queue to `tests/reportQueue.test.js`.

## Environment

BullMQ uses the existing `REDIS_URL` environment variable — no additional
configuration is needed. Ensure Redis is healthy before the Node process starts.

```
REDIS_URL=redis://localhost:6379
```

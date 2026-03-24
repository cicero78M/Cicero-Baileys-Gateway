import pino from 'pino';

const jakartaTimeZone = 'Asia/Jakarta';
const jakartaUtcOffset = '+07:00';

const jakartaFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: jakartaTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function formatJakartaTimestamp(date) {
  const parts = jakartaFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}.${ms}${jakartaUtcOffset}`;
}

/**
 * Structured pino logger — use this instead of console.* in all new code.
 * Outputs JSON in production, pretty-printed in development.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: () => `,"time":"${formatJakartaTimestamp(new Date())}"`,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: false } }
    : undefined,
});

// Patch console.log to prepend a Jakarta timestamp.
// Legacy code that still uses console.* will be timestamped correctly.
// New code MUST import and use `logger` from this module instead.
const originalLog = console.log;
console.log = (...args) => {
  originalLog(`[${formatJakartaTimestamp(new Date())}]`, ...args);
};

import { env } from '../config/env.js';
import redis from '../config/redis.js';
import { createRequestHash, storeRequestHash } from '../utils/requestHash.js';

const TTL_SEC = 5 * 60; // 5 minutes

export async function dedupRequest(req, res, next) {
  // Skip all checks if disabled via env var
  if (env.ALLOW_DUPLICATE_REQUESTS) {
    return next();
  }

  const urlCandidates = [req.originalUrl, req.baseUrl].filter(Boolean);

  // Skip deduplication entirely for claim flow endpoints
  if (
    urlCandidates.some(
      (url) => url === '/api/claim' || url.startsWith('/api/claim/')
    )
  ) {
    return next();
  }

  // Allow duplicate requests for the root path or for all GET requests
  if (req.path === '/' || req.method === 'GET') {
    return next();
  }
  try {
    const tokenPart = req.headers.authorization
      ? req.headers.authorization.split(' ')[1]
      : '';
    const userPart =
      tokenPart ||
      req.user?.client_id ||
      req.headers['x-client-id'] ||
      req.ip ||
      '';
    const hash = createRequestHash(req, userPart);
    const key = `dedup:${hash}`;
    const exists = await redis.exists(key);
    if (exists) {
      return res
        .status(429)
        .json({ success: false, message: 'Duplicate request detected' });
    }
    await storeRequestHash(hash, TTL_SEC);
  } catch (e) {
    console.error(e);
    // If hashing fails or redis error, ignore dedup check
  }
  next();
}

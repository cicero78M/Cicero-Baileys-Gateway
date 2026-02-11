import { sendConsoleDebug } from './debugHandler.js';

export function sensitivePathGuard(req, res, next) {
  const requestPath = (req.path || '').toLowerCase();
  if (!requestPath.includes('.env')) {
    return next();
  }

  sendConsoleDebug({
    tag: 'SECURITY',
    msg: `Blocked sensitive path probe: ${req.originalUrl}`
  });

  return res.status(404).json({ success: false, message: 'Endpoint not found' });
}

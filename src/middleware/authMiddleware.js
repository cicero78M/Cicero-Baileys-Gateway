// src/middleware/authMiddleware.js
import jwt from 'jsonwebtoken';

const operatorAllowlist = [
  { path: '/clients/profile', type: 'exact' },
  { path: '/aggregator', type: 'prefix' },
  { path: '/amplify/rekap', type: 'exact' },
  { path: '/amplify/rekap-khusus', type: 'exact' },
  { path: '/amplify-khusus/rekap', type: 'exact' },
  { path: '/insta/rekap-likes', type: 'exact' },
  { path: '/insta/rapid-profile', type: 'exact' },
  { path: '/tiktok/rekap-komentar', type: 'exact' },
  { path: '/users', type: 'exact' },
  { path: '/users/create', type: 'exact' },
  { path: '/users/list', type: 'exact' },
];

const operatorMethodAllowlist = [
  { method: 'PUT', pattern: /^\/users\/[^/]+$/ },
  { method: 'POST', pattern: /^\/link-reports$/ },
  { method: 'POST', pattern: /^\/link-reports-khusus$/ },
  { method: 'PUT', pattern: /^\/link-reports\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/link-reports-khusus\/[^/]+$/ },
];

function isOperatorAllowedPath(method, pathname) {
  const isPathAllowed = operatorAllowlist.some(({ path, type }) => {
    if (type === 'prefix') {
      return pathname === path || pathname.startsWith(`${path}/`);
    }
    return pathname === path;
  });
  if (isPathAllowed) {
    return true;
  }
  return operatorMethodAllowlist.some(({ method: allowedMethod, pattern }) => {
    if (allowedMethod !== method) {
      return false;
    }
    return pattern.test(pathname);
  });
}

export function authRequired(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    if (decoded.role === 'operator' && !isOperatorAllowedPath(req.method, req.path)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  } catch (err) {
    // Bisa log err di backend untuk trace
    return res.status(401).json({ success: false, message: 'Invalid token', error: err.message });
  }
}

import jwt from 'jsonwebtoken';
import redis from '../config/redis.js';

export async function verifyPenmasToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const exists = await redis.get(`login_token:${token}`);
    if (!exists || !String(exists).startsWith('penmas:')) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    req.penmasUser = payload;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

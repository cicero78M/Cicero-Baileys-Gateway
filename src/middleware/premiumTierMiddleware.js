function normalizeTier(tier) {
  return typeof tier === 'string' ? tier.trim().toLowerCase() : null;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.getTime() < Date.now();
}

export function requirePremiumTier(allowedTiers = []) {
  const normalizedAllowed = Array.isArray(allowedTiers)
    ? allowedTiers.map(normalizeTier).filter(Boolean)
    : [];

  return (req, res, next) => {
    const userContext = req.dashboardUser || req.user || {};
    const premiumStatus = Boolean(userContext.premium_status);
    const premiumTier = normalizeTier(userContext.premium_tier);
    const expiresAt = userContext.premium_expires_at || null;

    if (!premiumStatus || isExpired(expiresAt)) {
      return res.status(402).json({
        success: false,
        message: 'Akses premium diperlukan untuk endpoint ini',
        premium_status: premiumStatus,
        premium_tier: userContext.premium_tier || null,
        premium_expires_at: expiresAt,
      });
    }

    if (normalizedAllowed.length > 0 && (!premiumTier || !normalizedAllowed.includes(premiumTier))) {
      return res.status(403).json({
        success: false,
        message: 'Premium tier tidak diizinkan untuk endpoint ini',
        premium_tier: userContext.premium_tier || null,
      });
    }

    return next();
  };
}

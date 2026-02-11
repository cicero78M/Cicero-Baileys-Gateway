/**
 * Handle OAuth provider callback.
 * Example usage: GET /oauth/callback?code=AUTH_CODE&state=STATE
 */
export async function handleOAuthCallback(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ success: false, message: 'Missing code parameter' });
  }

  console.log('[OAUTH CALLBACK]', { code, state });

  // Placeholder: exchange code for access token using provider API
  // You can add provider-specific logic here.

  return res.status(200).json({ success: true, code, state });
}


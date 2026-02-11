import { Router } from 'express';
import { handleOAuthCallback } from '../controller/oauthController.js';

const router = Router();

// OAuth provider redirects users to this callback URL
router.get('/callback', handleOAuthCallback);

export default router;

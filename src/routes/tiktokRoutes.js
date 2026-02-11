import { Router } from 'express';
import {
  getTiktokComments,
  getTiktokRekapKomentar,
  getTiktokPosts,
  getRapidTiktokProfile,
  getRapidTiktokPosts,
  getRapidTiktokInfo
} from '../controller/tiktokController.js';
import { authRequired } from '../middleware/authMiddleware.js';

const router = Router();

router.use(authRequired);
router.get('/comments', getTiktokComments);
router.get('/rekap-komentar', getTiktokRekapKomentar);
router.get('/posts', getTiktokPosts);
router.get('/rapid-profile', getRapidTiktokProfile);
router.get('/rapid-posts', getRapidTiktokPosts);
router.get('/rapid-info', getRapidTiktokInfo);

export default router;

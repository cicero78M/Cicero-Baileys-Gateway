import { Router } from 'express';
import { getAmplifyKhususRekap } from '../controller/amplifyKhususController.js';
import { authRequired } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/rekap', authRequired, getAmplifyKhususRekap);

export default router;

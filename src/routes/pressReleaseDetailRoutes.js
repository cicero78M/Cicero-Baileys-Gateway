import express from 'express';
import * as controller from '../controller/pressReleaseDetailController.js';
import { verifyPenmasToken } from '../middleware/penmasAuth.js';

const router = express.Router();

router.use(verifyPenmasToken);
router.get('/:id', controller.getDetail);
router.post('/', controller.createDetail);
router.put('/:id', controller.updateDetail);

export default router;

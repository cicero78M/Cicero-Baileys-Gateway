import express from 'express';
import * as controller from '../controller/premiumRequestController.js';

const router = express.Router();

router.post('/', controller.createPremiumRequest);
router.put('/:id', controller.updatePremiumRequest);

export default router;

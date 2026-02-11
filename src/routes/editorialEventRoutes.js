import express from 'express';
import * as controller from '../controller/editorialEventController.js';
import { verifyPenmasToken } from '../middleware/penmasAuth.js';
import * as logController from '../controller/changeLogController.js';

const router = express.Router();

router.use(verifyPenmasToken);
router.get('/', controller.getEvents);
router.post('/', controller.createEvent);
router.put('/:id', controller.updateEvent);
router.delete('/:id', controller.deleteEvent);
router.get('/:id/logs', logController.getLogs);
router.post('/:id/logs', logController.addLog);

export default router;

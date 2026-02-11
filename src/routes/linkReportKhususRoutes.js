import express from 'express';
import * as controller from '../controller/linkReportKhususController.js';

const router = express.Router();

router.get('/', controller.getAllLinkReports);
router.get('/:shortcode', controller.getLinkReportByShortcode);
router.post('/', controller.createLinkReport);
router.put('/:shortcode', controller.updateLinkReport);
router.delete('/:shortcode', controller.deleteLinkReport);

export default router;

import express from 'express';
import * as controller from '../controller/linkReportController.js';

const router = express.Router();

router.get('/', controller.getAllLinkReports);
router.get('/excel', controller.downloadMonthlyLinkReportExcel);
router.get('/:shortcode', controller.getLinkReportByShortcode);
router.post('/', controller.createLinkReport);
router.put('/:shortcode', controller.updateLinkReport);
router.delete('/:shortcode', controller.deleteLinkReport);

export default router;

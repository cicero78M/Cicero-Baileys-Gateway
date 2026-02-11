import express from 'express';
import { getVisitorLogs } from '../model/visitorLogModel.js';

const router = express.Router();

router.get('/visitors', async (_req, res) => {
  const logs = await getVisitorLogs();
  res.json(logs);
});

export default router;

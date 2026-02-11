import { Router } from 'express';
import { getMetadata } from '../controller/metaController.js';

const router = Router();

router.get('/', getMetadata);

export default router;

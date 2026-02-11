import { Router } from 'express';
import { getRandomQuote } from '../controller/quoteController.js';

const router = Router();

router.get('/random', getRandomQuote);

export default router;

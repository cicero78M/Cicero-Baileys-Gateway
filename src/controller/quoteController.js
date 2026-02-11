import { fetchTranslatedRandomQuote } from '../service/quoteService.js';
import { sendSuccess } from '../utils/response.js';

export async function getRandomQuote(req, res, next) {
  try {
    const data = await fetchTranslatedRandomQuote();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

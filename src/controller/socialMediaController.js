import { analyzeInstagramData } from '../utils/analyzeInstagram.js';
import { sendConsoleDebug } from '../middleware/debugHandler.js';

export function analyzeInstagramJson(req, res) {
  try {
    const json = req.body;
    const result = analyzeInstagramData(json);
    res.json({ success: true, data: result });
  } catch (err) {
    sendConsoleDebug({ tag: 'SOCIAL_MEDIA', msg: `Error analyzeInstagramJson: ${err.message}` });
    res.status(500).json({ success: false, message: err.message });
  }
}

import { getRekapLikesByClient } from "../model/instaLikeModel.js";
import { sendConsoleDebug } from "../middleware/debugHandler.js";
import { formatLikesRecapResponse } from "../utils/likesRecapFormatter.js";

export async function getDitbinmasLikes(req, res) {
  const periode = req.query.periode || "harian";
  const tanggal = req.query.tanggal;
  const startDate = req.query.start_date || req.query.tanggal_mulai;
  const endDate = req.query.end_date || req.query.tanggal_selesai;

  try {
    sendConsoleDebug({ tag: "LIKES", msg: `getDitbinmasLikes ${periode} ${tanggal || ''} ${startDate || ''} ${endDate || ''}` });
    const { rows, totalKonten } = await getRekapLikesByClient(
      "ditbinmas",
      periode,
      tanggal,
      startDate,
      endDate,
      "ditbinmas"
    );

    const payload = formatLikesRecapResponse(rows, totalKonten);

    res.json({
      success: true,
      ...payload,
    });
  } catch (err) {
    sendConsoleDebug({ tag: "LIKES", msg: `Error getDitbinmasLikes: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

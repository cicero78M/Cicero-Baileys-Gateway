import { absensiLoginWeb } from '../handler/fetchabsensi/dashboard/absensiLoginWeb.js';

function parseDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

export async function getDashboardWebLoginRecap(req, res) {
  try {
    const mode = (req.query.mode || 'harian').toLowerCase();
    const startTime = parseDate(req.query.start_time || req.query.startDate);
    const endTime = parseDate(req.query.end_time || req.query.endDate);

    if ((req.query.start_time || req.query.startDate) && !startTime) {
      return res.status(400).json({ success: false, message: 'start_time tidak valid' });
    }

    if ((req.query.end_time || req.query.endDate) && !endTime) {
      return res.status(400).json({ success: false, message: 'end_time tidak valid' });
    }

    const message = await absensiLoginWeb({ mode, startTime, endTime });

    return res.json({
      success: true,
      message,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

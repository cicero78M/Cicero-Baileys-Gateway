import { sendConsoleDebug } from "../middleware/debugHandler.js";
import { ALLOWED_TIME_RANGES, getAnevSummary, resolveTimeRange } from "../service/anevService.js";
import { UserDirectoryError } from "../service/userDirectoryService.js";

function normalizeClientIdList(clientIds) {
  if (!Array.isArray(clientIds)) return [];
  return clientIds
    .filter((id) => id != null && String(id).trim() !== "")
    .map((id) => String(id).trim());
}

export async function getAnevDashboard(req, res) {
  try {
    const timeRangeInput = req.query.time_range || req.query.timeRange || "7d";
    const { startDate, endDate, timeRange, error } = resolveTimeRange(
      timeRangeInput,
      req.query.start_date || req.query.startDate,
      req.query.end_date || req.query.endDate
    );
    if (error) {
      return res.status(400).json({ success: false, message: error, permitted_time_ranges: ALLOWED_TIME_RANGES });
    }

    const allowedClientIds = normalizeClientIdList(req.dashboardUser?.client_ids);
    const dashboardRole = (req.dashboardUser?.role || "").toLowerCase();
    const requestedClientId = req.query.client_id || req.headers["x-client-id"];
    const normalizedRequestedClientId = requestedClientId
      ? String(requestedClientId).trim()
      : null;
    let clientId = null;
    if (normalizedRequestedClientId) {
      const normalizedRequested = normalizedRequestedClientId.toLowerCase();
      if (allowedClientIds.length > 0) {
        const matchIndex = allowedClientIds.findIndex(
          (id) => String(id).toLowerCase() === normalizedRequested
        );
        if (matchIndex === -1) {
          return res.status(403).json({ success: false, message: "client_id tidak diizinkan" });
        }
        clientId = allowedClientIds[matchIndex];
      } else if (
        req.dashboardUser?.client_id &&
        String(req.dashboardUser.client_id).toLowerCase() === normalizedRequested
      ) {
        clientId = req.dashboardUser.client_id;
      } else {
        clientId = normalizedRequestedClientId;
      }
    } else if (dashboardRole === "operator") {
      if (allowedClientIds.length === 1) {
        [clientId] = allowedClientIds;
      } else if (allowedClientIds.length === 0 && req.dashboardUser?.client_id) {
        clientId = req.dashboardUser.client_id;
      } else {
        return res.status(400).json({ success: false, message: "client_id wajib diisi" });
      }
    } else if (req.dashboardUser?.client_id) {
      clientId = req.dashboardUser.client_id;
    } else if (allowedClientIds.length === 1) {
      [clientId] = allowedClientIds;
    } else if (allowedClientIds.length > 0 && dashboardRole !== "operator") {
      [clientId] = allowedClientIds;
    }

    if (!clientId) {
      return res.status(400).json({ success: false, message: "client_id wajib diisi" });
    }

    const resolvedRole = (req.query.role || req.dashboardUser?.role || "").toLowerCase() || null;
    const resolvedScope = (req.query.scope || req.dashboardUser?.scope || "org").toLowerCase();
    if (!["org", "direktorat"].includes(resolvedScope)) {
      return res.status(400).json({ success: false, message: "scope tidak valid" });
    }
    if (!resolvedRole) {
      return res.status(400).json({ success: false, message: "role wajib diisi" });
    }

    const regionalId = req.query.regional_id
      ? String(req.query.regional_id).trim().toUpperCase()
      : null;

    const summary = await getAnevSummary({
      clientId,
      role: resolvedRole,
      scope: resolvedScope,
      regionalId,
      startDate,
      endDate,
      timeRange,
      requesterRole: dashboardRole,
      requesterClientId: req.dashboardUser?.client_id,
      requesterClientIds: allowedClientIds,
    });

    return res.json({ success: true, data: summary });
  } catch (err) {
    if (err instanceof UserDirectoryError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    sendConsoleDebug({ tag: "ANEV", msg: `Error getAnevDashboard: ${err.message}` });
    return res.status(500).json({ success: false, message: err.message });
  }
}

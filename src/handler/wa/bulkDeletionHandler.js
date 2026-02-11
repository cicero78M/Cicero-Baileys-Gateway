import { clearSession } from "../../utils/sessionsHelper.js";
import { formatNama, normalizeUserId } from "../../utils/utilsHelper.js";

export const BULK_STATUS_HEADER_REGEX = /Permohonan Penghapusan Data Personil/i;
const NUMERIC_ID_REGEX = /\b\d{6,}\b/g;
const BOT_SUMMARY_HEADER_REGEX =
  /^📄\s*[*_]{0,3}\s*Permohonan Penghapusan Data Personil/i;
const BULK_STATUS_SUMMARY_KEYWORDS =
  /(?:Status dinonaktifkan|entri gagal diproses)/i;

function standardizeDash(value) {
  return value.replace(/[\u2012-\u2015]/g, "-").replace(/[•●▪]/g, "-");
}

function extractNameAndReason(segment) {
  const trimmed = segment.trim();
  const match = trimmed.match(/^(?<reason>[^()]+?)\s*\((?<name>.+?)\)$/);
  if (match?.groups) {
    const { reason, name } = match.groups;
    return {
      name: name.trim(),
      reason: reason.trim(),
    };
  }
  return { name: trimmed, reason: "" };
}

function extractNarrativeSentence(text, index) {
  let start = index;
  while (start > 0) {
    const prevChar = text[start - 1];
    if (/[.!?\n]/.test(prevChar)) break;
    start -= 1;
  }

  let end = index;
  while (end < text.length) {
    const char = text[end];
    if (/[.!?\n]/.test(char)) {
      end += 1;
      break;
    }
    end += 1;
  }

  return text.slice(start, end).trim();
}

function extractNarrativeReason(sentence, rawId) {
  if (!sentence) return "";

  const cleaned = sentence.replace(/\s+/g, " ").trim();
  const normalizedId = (rawId || "").trim();
  const idPattern = normalizedId
    ? normalizedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    : "";

  if (idPattern) {
    const afterIdRegex = new RegExp(
      `${idPattern}\\s*(?:[-:–—]|karena|dengan alasan)?\\s*(.+)$`,
      "i"
    );
    const afterMatch = cleaned.match(afterIdRegex);
    if (afterMatch?.[1]) {
      return afterMatch[1]
        .replace(/^(?:[-:–—]|karena|dengan alasan)\s*/i, "")
        .trim();
    }
  }

  const reasonPatterns = [
    /(?:karena|dengan alasan|alasan)\s*[:\-–—]?\s*(.+)$/i,
    /(?:status|keterangan)\s*[:\-–—]?\s*(.+)$/i,
  ];

  for (const pattern of reasonPatterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  const segments = cleaned
    .split(/[-–—]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length >= 3) {
    return segments[segments.length - 1];
  }

  return "";
}

function extractNarrativeName(sentence, rawId) {
  if (!sentence) return "";
  const cleaned = sentence.replace(/\s+/g, " ").trim();
  const normalizedId = (rawId || "").trim();
  if (!normalizedId) return "";

  const escapedId = normalizedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const idMatch = cleaned.match(new RegExp(`(.+?)\\b${escapedId}\\b`, "i"));
  if (!idMatch?.[1]) return "";

  let candidate = idMatch[1]
    .replace(/^\s*\d+[.)]\s*/g, "")
    .replace(/^\s*(?:nama|personel|anggota)\s*[:\-–—]?\s*/i, "")
    .replace(/(?:nrp|nip|id)\s*[:\-–—]?\s*$/i, "")
    .replace(/[-:–—]+\s*$/g, "")
    .trim();

  if (!candidate) return "";

  if (/^(?:permohonan|mohon|harap|penghapusan|data personil)/i.test(candidate)) {
    return "";
  }

  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length > 10) {
    candidate = words.slice(-10).join(" ");
  }

  return candidate;
}

export function parseBulkStatusEntries(message) {
  if (!message || typeof message !== "string") {
    return { entries: [], headerLine: "" };
  }

  const standardized = standardizeDash(message);
  const lines = standardized.split(/\r?\n/);
  const entries = [];
  const knownRawIds = new Set();
  const knownNormalizedIds = new Set();
  const entryRegex = /^\s*(\d+)\.\s+(.+?)\s+-\s+(.+?)\s+-\s+(.+)$/;
  const fallbackRegex = /^\s*(\d+)\.\s+(.+?)\s+-\s+(.+)$/;

  function addEntry({ index, name, rawId, reason, line }) {
    const trimmedRawId = rawId.trim();
    const normalizedId = normalizeUserId(trimmedRawId) || "";

    if (normalizedId && knownNormalizedIds.has(normalizedId)) return;
    if (!normalizedId && knownRawIds.has(trimmedRawId)) return;

    knownRawIds.add(trimmedRawId);
    if (normalizedId) knownNormalizedIds.add(normalizedId);

    entries.push({
      index: Number(index),
      name: (name || "").trim(),
      rawId: trimmedRawId,
      normalizedId,
      reason: (reason || "").trim(),
      line: (line || "").trim(),
    });
  }

  for (const line of lines) {
    const match = line.match(entryRegex);
    if (match) {
      const [, index, name, rawId, reason] = match;
      addEntry({ index, name, rawId, reason, line });
      continue;
    }

    const fallbackMatch = line.match(fallbackRegex);
    if (!fallbackMatch) continue;

    const [, index, firstSegment, rawId] = fallbackMatch;
    const { name, reason } = extractNameAndReason(firstSegment);

    addEntry({ index, name, rawId, reason, line });
  }

  let nextIndex = entries.reduce((max, entry) => Math.max(max, entry.index || 0), 0) + 1;

  const matches = standardized.matchAll(NUMERIC_ID_REGEX);
  for (const match of matches) {
    const rawId = match[0];
    if (knownRawIds.has(rawId)) continue;

    const sentence = extractNarrativeSentence(standardized, match.index);
    if (!sentence) continue;

    const reason = extractNarrativeReason(sentence, rawId);
    const name = extractNarrativeName(sentence, rawId);

    addEntry({
      index: nextIndex,
      name,
      rawId,
      reason,
      line: sentence.trim(),
    });
    nextIndex += 1;
  }

  const headerLine =
    lines.find((line) => BULK_STATUS_HEADER_REGEX.test(line))?.trim() || "";

  return { entries, headerLine };
}

function isGatewayForward(text) {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  return /^(wagateway|wabot)\b/.test(normalized);
}

function isBulkDeletionSummaryEcho(text) {
  if (!text) return false;
  const normalized = text.trim();
  if (BOT_SUMMARY_HEADER_REGEX.test(normalized)) return true;
  if (BULK_STATUS_SUMMARY_KEYWORDS.test(normalized)) return true;
  const arrowCount = (normalized.match(/→/g) || []).length;
  return arrowCount >= 2;
}

export async function sendBulkDeletionSummary({
  headerLine,
  successes,
  failures,
  chatId,
  waClient,
  session,
}) {
  const lines = [];
  const title = headerLine || "Permohonan Penghapusan Data Personil";
  lines.push(`📄 *${title}*`);

  if (successes.length) {
    lines.push("", `✅ Permintaan diproses untuk ${successes.length} personel:`);
    successes.forEach(
      ({ userId, name, reason, rawId, targetRole, statusAfter }) => {
        const displayName = name || rawId || userId;
        const reasonLabel = reason ? ` • ${reason}` : "";
        const roleLabel = targetRole ? ` • role: ${targetRole}` : "";
        const statusLabel =
          statusAfter === false ? " • status: nonaktif" : " • status: aktif";
        lines.push(
          `- ${userId} (${displayName})${roleLabel}${reasonLabel}${statusLabel}`
        );
      }
    );
  }

  if (failures.length) {
    lines.push("", `❌ ${failures.length} entri gagal diproses:`);
    failures.forEach(({ rawId, userId, name, reason, error }) => {
      const idLabel = userId || rawId || "-";
      const displayName = name || idLabel;
      const reasonLabel = reason ? ` • ${reason}` : "";
      lines.push(`- ${idLabel} (${displayName})${reasonLabel} → ${error}`);
    });
  }

  lines.push("", "Selesai diproses. Terima kasih.");

  await waClient.sendMessage(chatId, lines.join("\n").trim());
  if (session) {
    delete session.bulkStatusContext;
    session.step = "main";
  }
  clearSession(chatId);
}

export async function sendBulkRolePrompt(session, chatId, waClient) {
  const pending = session?.bulkStatusContext?.pendingSelections || [];
  const current = pending[0];
  if (!current) {
    session.step = "main";
    return;
  }

  const choices = current.roles.map((role, index) => `${index + 1}. ${role}`);
  const promptLines = [
    `User ${current.name || current.userId || "-"} memiliki lebih dari satu role aktif.`,
    `NRP/NIP: ${current.userId}`,
  ];
  if (current.reason) {
    promptLines.push(`Alasan: ${current.reason}`);
  }
  promptLines.push(
    "",
    "Pilih role yang akan dihapus:",
    choices.join("\n"),
    "",
    "Balas angka sesuai pilihan atau ketik *batal* untuk membatalkan proses."
  );
  session.step = "bulkStatus_applySelection";
  await waClient.sendMessage(chatId, promptLines.join("\n"));
}

export async function applyBulkDeletionChoice({
  entry,
  targetRole,
  userModel,
  successes,
  failures,
}) {
  try {
    const updatedUser = await userModel.deactivateRoleOrUser(
      entry.userId,
      targetRole
    );
    if (updatedUser?.status === false) {
      try {
        await userModel.updateUserField(entry.userId, "whatsapp", "");
      } catch (err) {
        const note = err?.message || String(err);
        failures.push({
          ...entry,
          targetRole,
          error: `status dinonaktifkan, namun gagal mengosongkan WhatsApp: ${note}`,
        });
        return;
      }
    }

    successes.push({
      ...entry,
      targetRole,
      statusAfter: updatedUser?.status,
    });
  } catch (err) {
    failures.push({
      ...entry,
      targetRole,
      error: err?.message || String(err),
    });
  }
}

function normalizeRoles(roles = []) {
  return Array.from(new Set((roles || []).filter(Boolean)));
}

function pickPrimaryRole(user) {
  if (!user) return null;
  if (user.ditbinmas) return "ditbinmas";
  if (user.ditlantas) return "ditlantas";
  if (user.bidhumas) return "bidhumas";
  if (user.operator) return "operator";
  return null;
}

async function resolveActiveRoles(dbUser, userModel) {
  if (!dbUser) return [];
  const roles = new Set();
  if (typeof userModel?.getUserRoles === "function") {
    try {
      const dynamicRoles = await userModel.getUserRoles(dbUser.user_id);
      normalizeRoles(dynamicRoles).forEach((role) => roles.add(role));
    } catch (err) {
      console.warn(
        `Failed to load roles for ${dbUser.user_id}: ${err?.message || err}`
      );
    }
  }

  if (roles.size === 0) {
    if (dbUser.ditbinmas) roles.add("ditbinmas");
    if (dbUser.ditlantas) roles.add("ditlantas");
    if (dbUser.bidhumas) roles.add("bidhumas");
    if (dbUser.ditsamapta) roles.add("ditsamapta");
    if (dbUser.operator) roles.add("operator");
  }

  return Array.from(roles);
}

export async function processBulkDeletionRequest({
  session,
  chatId,
  text,
  waClient,
  userModel,
}) {
  const currentSession = session || {};
  delete currentSession.bulkStatusContext;

  const trimmed = (text || "").trim();
  if (!trimmed) {
    await waClient.sendMessage(
      chatId,
      "Format tidak dikenali. Mohon kirimkan template lengkap atau ketik *batal*."
    );
    if (session) {
      delete currentSession.bulkStatusContext;
      currentSession.step = "main";
    }
    clearSession(chatId);
    return { processed: false };
  }

  if (isGatewayForward(trimmed) || isBulkDeletionSummaryEcho(trimmed)) {
    return { processed: false };
  }

  if (trimmed.toLowerCase() === "batal") {
    await waClient.sendMessage(chatId, "Permohonan penghapusan dibatalkan.");
    if (session) {
      delete currentSession.bulkStatusContext;
      currentSession.step = "main";
    }
    clearSession(chatId);
    return { processed: true, cancelled: true };
  }

  if (!BULK_STATUS_HEADER_REGEX.test(trimmed)) {
    await waClient.sendMessage(
      chatId,
      "Format tidak valid. Gunakan judul `Permohonan Penghapusan Data Personil – <SATKER>` lalu daftar personel per baris."
    );
    if (session) {
      delete currentSession.bulkStatusContext;
      currentSession.step = "main";
    }
    clearSession(chatId);
    return { processed: false };
  }

  const { entries, headerLine } = parseBulkStatusEntries(trimmed);
  if (!entries.length) {
    await waClient.sendMessage(
      chatId,
      "Tidak menemukan daftar personel. Pastikan format setiap baris: `1. NAMA – USER_ID – alasan`."
    );
    if (session) {
      delete currentSession.bulkStatusContext;
      currentSession.step = "main";
    }
    clearSession(chatId);
    return { processed: false };
  }

  const successes = [];
  const failures = [];
  const pendingSelections = [];

  for (const entry of entries) {
    const normalizedId = entry.normalizedId || normalizeUserId(entry.rawId);
    const fallbackName = entry.name || "";
    if (!normalizedId) {
      failures.push({
        ...entry,
        name: fallbackName,
        userId: "",
        error: "user_id tidak valid",
      });
      continue;
    }

    let dbUser;
    try {
      dbUser = await userModel.findUserById(normalizedId);
    } catch (err) {
      failures.push({
        ...entry,
        name: fallbackName,
        userId: normalizedId,
        error: `gagal mengambil data user: ${err?.message || String(err)}`,
      });
      continue;
    }

    if (!dbUser) {
      failures.push({
        ...entry,
        name: fallbackName,
        userId: normalizedId,
        error: "user tidak ditemukan",
      });
      continue;
    }

    const officialName =
      formatNama(dbUser) || dbUser.nama || fallbackName || normalizedId;

    const activeRoles = await resolveActiveRoles(dbUser, userModel);
    if (activeRoles.length > 1) {
      pendingSelections.push({
        ...entry,
        name: officialName,
        userId: normalizedId,
        roles: activeRoles,
      });
      continue;
    }

    const targetRole =
      activeRoles.length === 1
        ? activeRoles[0]
        : pickPrimaryRole(dbUser) || activeRoles[0] || null;

    await applyBulkDeletionChoice({
      entry: { ...entry, name: officialName, userId: normalizedId },
      targetRole,
      userModel,
      successes,
      failures,
    });
  }

  if (pendingSelections.length) {
    currentSession.bulkStatusContext = {
      headerLine,
      successes,
      failures,
      pendingSelections,
    };
    currentSession.step = "bulkStatus_chooseRole";
    await sendBulkRolePrompt(currentSession, chatId, waClient);
    return { processed: true, pending: true };
  }

  await sendBulkDeletionSummary({
    headerLine,
    successes,
    failures,
    chatId,
    waClient,
    session: currentSession,
  });
  return { processed: true };
}

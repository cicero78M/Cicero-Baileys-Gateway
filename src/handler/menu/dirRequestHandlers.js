import { getUsersSocialByClient, getClientsByRole } from "../../model/userModel.js";
import {
  getShortcodesTodayByClient,
  getPostsTodayByClient as getInstaPostsTodayByClient,
} from "../../model/instaPostModel.js";
import {
  getVideoIdsTodayByClient,
  getPostsTodayByClient as getTiktokPostsTodayByClient,
} from "../../model/tiktokPostModel.js";
import { getRekapLikesByClient } from "../../model/instaLikeModel.js";
import { getRekapKomentarByClient } from "../../model/tiktokCommentModel.js";
import {
  absensiLikes,
  lapharDitbinmas,
  absensiLikesDitbinmasReport,
  collectLikesRecap,
  absensiLikesDitbinmasSimple as absensiLikesDitbinmasSimpleReport,
} from "../fetchabsensi/insta/absensiLikesInsta.js";
import {
  lapharTiktokDitbinmas,
  collectKomentarRecap,
  absensiKomentarDitbinmasReport,
  absensiKomentar,
  absensiKomentarDitbinmasSimple as absensiKomentarDitbinmasSimpleReport,
} from "../fetchabsensi/tiktok/absensiKomentarTiktok.js";
import { absensiRegistrasiDashboardDirektorat } from "../fetchabsensi/dashboard/absensiRegistrasiDashboardDirektorat.js";
import { findClientById, findAllClientsByType } from "../../service/clientService.js";
import { getGreeting, sortDivisionKeys, formatNama, filterAttendanceUsers } from "../../utils/utilsHelper.js";
import { sendWAFile, safeSendMessage, sendWithClientFallback } from "../../utils/waHelper.js";
import { writeFile, mkdir, readFile, unlink, stat } from "fs/promises";
import { join, basename } from "path";
import {
  saveLikesRecapExcel,
  saveLikesRecapPerContentExcel,
} from "../../service/likesRecapExcelService.js";
import {
  saveCommentRecapExcel,
  saveCommentRecapPerContentExcel,
} from "../../service/commentRecapExcelService.js";
import { saveWeeklyLikesRecapExcel } from "../../service/weeklyLikesRecapExcelService.js";
import { saveWeeklyCommentRecapExcel } from "../../service/weeklyCommentRecapExcelService.js";
import { generateWeeklyInstagramHighLowReport } from "../../service/weeklyInstagramHighLowService.js";
import { generateWeeklyTiktokHighLowReport } from "../../service/weeklyTiktokHighLowService.js";
import { saveMonthlyLikesRecapExcel } from "../../service/monthlyLikesRecapExcelService.js";
import { saveSatkerUpdateMatrixExcel } from "../../service/satkerUpdateMatrixService.js";
import { saveEngagementRankingExcel } from "../../service/engagementRankingExcelService.js";
import { generateKasatkerReport } from "../../service/kasatkerReportService.js";
import { generateKasatkerAttendanceSummary } from "../../service/kasatkerAttendanceService.js";
import { generateKasatBinmasLikesRecap } from "../../service/kasatBinmasLikesRecapService.js";
import { sendKasatBinmasLikesRecapExcel } from "../../service/kasatBinmasLikesRecapExcelService.js";
import { sendKasatBinmasTiktokCommentRecapExcel } from "../../service/kasatBinmasTiktokCommentRecapExcelService.js";
import {
  generateKasatBinmasTiktokCommentRecap,
  resolveBaseDate,
} from "../../service/kasatBinmasTiktokCommentRecapService.js";
import { hariIndo } from "../../utils/constants.js";
import { fetchInstagramInfo } from "../../service/instaRapidService.js";
import {
  buildSatbinmasOfficialInstagramRecap,
  buildSatbinmasOfficialTiktokRecap,
  buildSatbinmasOfficialInstagramDbRecap,
  buildSatbinmasOfficialTiktokDbRecap,
} from "../../service/satbinmasOfficialReportService.js";
import { syncSatbinmasOfficialTiktokSecUidForOrgClients } from "../../service/satbinmasOfficialTiktokService.js";
import { generateInstagramAllDataRecap } from "../../service/instagramAllDataRecapService.js";
import { generateTiktokAllDataRecap } from "../../service/tiktokAllDataRecapService.js";
import { appendSubmenuBackInstruction } from "./menuPromptHelpers.js";

const dirRequestGroup = "120363419830216549@g.us";
const DITBINMAS_CLIENT_ID = "DITBINMAS";

const isGroupChatId = (value) => String(value || "").trim().endsWith("@g.us");

const sendMenuMessage = async (waClient, chatId, message, options = {}) => {
  const {
    fallbackClients,
    fallbackContext,
    reportClient,
    ...sendOptions
  } = options || {};
  if (Array.isArray(fallbackClients) && fallbackClients.length) {
    return sendWithClientFallback({
      chatId,
      message,
      clients: fallbackClients,
      sendOptions,
      reportClient: reportClient || waClient,
      reportContext: fallbackContext,
    });
  }
  if (isGroupChatId(chatId)) {
    return safeSendMessage(waClient, chatId, message, sendOptions);
  }
  if (!sendOptions || Object.keys(sendOptions).length === 0) {
    return waClient.sendMessage(chatId, message);
  }
  return waClient.sendMessage(chatId, message, sendOptions);
};

const isDitbinmas = (value) =>
  String(value || "")
    .trim()
    .toUpperCase() === DITBINMAS_CLIENT_ID;

const ENGAGEMENT_RECAP_PERIOD_MAP = {
  "1": {
    period: "today",
    label: "hari ini",
    description: "Hari ini",
  },
  "2": {
    period: "yesterday",
    label: "hari sebelumnya",
    description: "Hari sebelumnya",
  },
  "3": {
    period: "this_week",
    label: "minggu ini",
    description: "Minggu ini",
  },
  "4": {
    period: "last_week",
    label: "minggu sebelumnya",
    description: "Minggu sebelumnya",
  },
  "5": {
    period: "this_month",
    label: "bulan ini",
    description: "Bulan ini",
  },
  "6": {
    period: "last_month",
    label: "bulan sebelumnya",
    description: "Bulan sebelumnya",
  },
};

const KASATKER_REPORT_PERIOD_MAP = {
  "1": {
    period: "today",
    label: "hari ini",
    description: "Laporan harian (periode hari ini)",
  },
  "2": {
    period: "this_week",
    label: "minggu ini",
    description: "Laporan mingguan (periode minggu ini)",
  },
  "3": {
    period: "this_month",
    label: "bulan ini",
    description: "Laporan bulanan (periode bulan ini)",
  },
  "4": {
    period: "all_time",
    label: "semua periode",
    description: "Laporan semua periode (seluruh data)",
  },
};

const DIGIT_EMOJI = {
  "0": "0️⃣",
  "1": "1️⃣",
  "2": "2️⃣",
  "3": "3️⃣",
  "4": "4️⃣",
  "5": "5️⃣",
  "6": "6️⃣",
  "7": "7️⃣",
  "8": "8️⃣",
  "9": "9️⃣",
};

const ENGAGEMENT_RECAP_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih periode rekap ranking engagement jajaran:\n" +
    Object.entries(ENGAGEMENT_RECAP_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const KASATKER_REPORT_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih periode Laporan Kasatker:\n" +
    Object.entries(KASATKER_REPORT_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const KASAT_BINMAS_LIKES_PERIOD_MAP = {
  "1": {
    period: "daily",
    description: "Rekap absensi likes harian (hari ini)",
  },
  "2": {
    period: "weekly",
    description: "Rekap absensi likes mingguan (Senin - Minggu)",
  },
  "3": {
    period: "monthly",
    description: "Rekap absensi likes bulanan",
  },
};

const KASAT_BINMAS_LIKES_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih rekap Absensi Likes Kasat Binmas:\n" +
    Object.entries(KASAT_BINMAS_LIKES_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const KASAT_BINMAS_LIKES_EXCEL_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih rekap Likes Instagram Kasat Binmas (Excel):\n" +
    Object.entries(KASAT_BINMAS_LIKES_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const KASAT_BINMAS_TIKTOK_COMMENT_PERIOD_MAP = {
  "1": {
    period: "daily",
    description: "Rekap absensi komentar harian (hari ini)",
  },
  "2": {
    period: "weekly",
    description: "Rekap absensi komentar mingguan (Senin - Minggu)",
  },
  "3": {
    period: "monthly",
    description: "Rekap absensi komentar bulanan",
  },
};

const KASAT_BINMAS_TIKTOK_COMMENT_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih rekap Absensi Komentar TikTok Kasat Binmas:\n" +
    Object.entries(KASAT_BINMAS_TIKTOK_COMMENT_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const KASAT_BINMAS_TIKTOK_COMMENT_EXCEL_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih rekap Komentar TikTok Kasat Binmas (Excel):\n" +
    Object.entries(KASAT_BINMAS_TIKTOK_COMMENT_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const SATBINMAS_OFFICIAL_RECAP_PERIOD_MAP = {
  "1": {
    period: "daily",
    description: "Rekap harian (hari ini)",
  },
  "2": {
    period: "weekly",
    description: "Rekap mingguan (Senin - Minggu)",
  },
  "3": {
    period: "monthly",
    description: "Rekap bulanan (1 s/d akhir bulan)",
  },
};

const SATBINMAS_OFFICIAL_INSTAGRAM_RECAP_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih rekap Instagram Satbinmas Official:\n" +
    Object.entries(SATBINMAS_OFFICIAL_RECAP_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const SATBINMAS_OFFICIAL_TIKTOK_RECAP_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih rekap TikTok Satbinmas Official:\n" +
    Object.entries(SATBINMAS_OFFICIAL_RECAP_PERIOD_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const REKAP_PERSONIL_CATEGORY_MAP = {
  "1": {
    category: "all",
    description: "Semua (All personnel data)",
  },
  "2": {
    category: "complete",
    description: "Lengkap (Both Instagram and TikTok filled)",
  },
  "3": {
    category: "incomplete",
    description: "Kurang (Missing either Instagram or TikTok)",
  },
  "4": {
    category: "not_yet",
    description: "Belum (Missing both Instagram and TikTok)",
  },
};

const REKAP_PERSONIL_MENU_TEXT = appendSubmenuBackInstruction(
  "Silakan pilih kategori rekap data personil:\n" +
    Object.entries(REKAP_PERSONIL_CATEGORY_MAP)
      .map(([key, option]) => `${DIGIT_EMOJI[key] || key} ${option.description}`)
      .join("\n") +
    "\n\nBalas angka pilihan atau ketik *batal* untuk kembali."
);

const SATBINMAS_OFFICIAL_METADATA_PROMPT = (clientId) =>
  "🔎 *Monitoring Satbinmas Official*\n" +
  "Masukkan username Instagram Satbinmas Official yang ingin dicek. " +
  "Secara default akan memakai Client ID aktif (" +
  `${clientId || DITBINMAS_CLIENT_ID}).\n` +
  "Format balasan: `username` atau `CLIENT_ID username`.\n" +
  "Contoh: `satbinmas_official` atau `MKS01 satbinmas_official`.\n\n" +
  "Balas *batal* untuk kembali ke menu.";

const SATBINMAS_OFFICIAL_TIKTOK_SECUID_PROMPT = () =>
  "🎯 *Sinkronisasi secUid TikTok Satbinmas Official*\n" +
  "Bot akan mengambil seluruh username TikTok Satbinmas Official dari tabel `satbinmas_official_accounts` " +
  "untuk semua client bertipe ORG, lalu menyinkronkan secUid lewat RapidAPI TikTok secara berurutan.\n" +
  "Tidak perlu mengirim username atau Client ID tambahan. Balas *batal* untuk kembali ke menu.";

const SATBINMAS_OFFICIAL_MEDIA_PROMPT =
  "📸 *Ambil Konten Harian Satbinmas Official*\n" +
  "Bot otomatis mengambil seluruh akun Instagram Satbinmas Official aktif " +
  "untuk seluruh client bertipe ORG secara berurutan dengan jeda agar tetap mematuhi TOS RapidAPI.\n" +
  "Tidak perlu mengirim username atau Client ID tambahan. Balas *batal* untuk kembali.";

const SATBINMAS_OFFICIAL_TIKTOK_MEDIA_PROMPT =
  "🎵 *Ambil Konten Harian TikTok Satbinmas Official*\n" +
  "Bot otomatis mengambil seluruh akun TikTok Satbinmas Official aktif " +
  "untuk semua client bertipe ORG secara berurutan dengan jeda aman agar tidak melanggar rate limit RapidAPI.\n" +
  "Tidak perlu mengirim username atau Client ID tambahan. Balas *batal* untuk kembali.";

const pangkatOrder = [
  "KOMISARIS BESAR POLISI",
  "AKBP",
  "KOMPOL",
  "AKP",
  "IPTU",
  "IPDA",
  "AIPTU",
  "AIPDA",
  "BRIPKA",
  "BRIGADIR",
  "BRIPTU",
  "BRIPDA",
];
const rankIdx = (t) => {
  const i = pangkatOrder.indexOf((t || "").toUpperCase());
  return i === -1 ? pangkatOrder.length : i;
};

async function formatRekapUserData(clientId, roleFlag = null) {
  const directorateRoles = ["ditbinmas", "ditlantas", "bidhumas"];
  const client = await findClientById(clientId);
  const normalizedRoleFlag = roleFlag?.toLowerCase();
  const clientType = client?.client_type?.toLowerCase();
  const normalizedClientId = clientId?.toLowerCase();
  const isDirectorateClient =
    clientType === "direktorat" || directorateRoles.includes(normalizedClientId);

  const filterRole = isDirectorateClient
    ? normalizedClientId
    : directorateRoles.includes(normalizedRoleFlag)
    ? normalizedRoleFlag
    : null;
  const users = await getUsersSocialByClient(clientId, filterRole);
  const salam = getGreeting();
  const now = new Date();
  const hari = now.toLocaleDateString("id-ID", { weekday: "long" });
  const tanggal = now.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const jam = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isDirektoratView =
    clientType === "direktorat" ||
    directorateRoles.includes(normalizedClientId) ||
    directorateRoles.includes(roleFlag?.toLowerCase());
  if (isDirektoratView) {
    const groups = {};
    users.forEach((u) => {
      const cid = (u.client_id || "").toLowerCase();
      if (!groups[cid]) groups[cid] = { total: 0, insta: 0, tiktok: 0, complete: 0 };
      groups[cid].total++;
      if (u.insta) groups[cid].insta++;
      if (u.tiktok) groups[cid].tiktok++;
      if (u.insta && u.tiktok) groups[cid].complete++;
    });

    const roleName = (filterRole || clientId).toLowerCase();
    const polresIds = (await getClientsByRole(roleName)) || [];
    const clientIdLower = clientId.toLowerCase();

    // Fetch all ORG clients (active + inactive)
    const allOrgClients = (await findAllClientsByType("org")) || [];
    const allOrgClientIds = allOrgClients.map((c) => c.client_id.toLowerCase());

    const seen = new Set();
    const allIds = [];
    const addId = (id) => {
      const lower = (id || '').toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        allIds.push(lower);
      }
    };

    addId(clientIdLower);
    polresIds.forEach((id) => addId(id));
    allOrgClientIds.forEach((id) => addId(id));
    Object.keys(groups).forEach((id) => addId(id));

    const entries = await Promise.all(
      allIds.map(async (cid) => {
        const stat =
          groups[cid] || { total: 0, insta: 0, tiktok: 0, complete: 0 };
        const c = await findClientById(cid);
        const name = (c?.nama || cid).toUpperCase();
        const type = c?.client_type?.toLowerCase() || null;
        return { cid, name, stat, type };
      })
    );

    const filteredEntries = entries.filter((entry) => {
      if (entry.type === "direktorat") {
        return entry.cid === clientIdLower;
      }
      if (entry.type === "org") {
        return true; // Include all ORG type clients (not limited to those from getClientsByRole)
      }
      return false;
    });

    const withData = filteredEntries.filter(
      (e) => e.cid === clientIdLower || e.stat.total > 0
    );
    const noData = filteredEntries.filter(
      (e) => e.stat.total === 0 && e.cid !== clientIdLower
    );

    const compareEntries = (a, b) => {
      if (a.cid === clientIdLower) return -1;
      if (b.cid === clientIdLower) return 1;

      const aOrg = a.type === "org";
      const bOrg = b.type === "org";
      if (aOrg !== bOrg) return aOrg ? -1 : 1;

      if (a.stat.complete !== b.stat.complete)
        return b.stat.complete - a.stat.complete;
      if (a.stat.total !== b.stat.total) return b.stat.total - a.stat.total;
      return a.name.localeCompare(b.name);
    };

    const compareNoData = (a, b) => {
      if (a.cid === clientIdLower) return -1;
      if (b.cid === clientIdLower) return 1;

      const aOrg = a.type === "org";
      const bOrg = b.type === "org";
      if (aOrg !== bOrg) return aOrg ? -1 : 1;
      return a.name.localeCompare(b.name);
    };

    withData.sort(compareEntries);
    noData.sort(compareNoData);

    const withDataLines = withData.map(
      (e, idx) =>
        `${idx + 1}. ${e.name}\n\n` +
        `Jumlah Total Personil : ${e.stat.total}\n` +
        `Jumlah Total Personil Sudah Mengisi Instagram : ${e.stat.insta}\n` +
        `Jumlah Total Personil Sudah Mengisi Tiktok : ${e.stat.tiktok}\n` +
        `Jumlah Total Personil Belum Mengisi Instagram : ${e.stat.total - e.stat.insta}\n` +
        `Jumlah Total Personil Belum Mengisi Tiktok : ${e.stat.total - e.stat.tiktok}`
    );
    const noDataLines = noData.map((e, idx) => `${idx + 1}. ${e.name}`);

    const totals = filteredEntries.reduce(
      (acc, e) => {
        acc.total += e.stat.total;
        acc.insta += e.stat.insta;
        acc.tiktok += e.stat.tiktok;
        acc.complete += e.stat.complete;
        return acc;
      },
      { total: 0, insta: 0, tiktok: 0, complete: 0 }
    );

    const header =
      `${salam},\n\n` +
      `Mohon ijin Komandan, melaporkan absensi update data personil ${
        (client?.nama || clientId).toUpperCase()
      } pada hari ${hari}, ${tanggal}, pukul ${jam} WIB, sebagai berikut:`;

    const sections = [
      `Jumlah Total Personil : ${totals.total}\n` +
        `Jumlah Total Personil Sudah Mengisi Instagram : ${totals.insta}\n` +
        `Jumlah Total Personil Sudah Mengisi Tiktok : ${totals.tiktok}\n` +
        `Jumlah Total Personil Belum Mengisi Instagram : ${totals.total - totals.insta}\n` +
        `Jumlah Total Personil Belum Mengisi Tiktok : ${totals.total - totals.tiktok}`,
    ];
    if (withDataLines.length)
      sections.push(`Sudah Input Data:\n\n${withDataLines.join("\n\n")}`);
    if (noDataLines.length)
      sections.push(`Client Belum Input Data:\n${noDataLines.join("\n")}`);
    const body = `\n\n${sections.join("\n\n")}`;

    return `${header}${body}`.trim();
  }

  const complete = {};
  const incomplete = {};
  users.forEach((u) => {
    const div = u.divisi || "-";
    if (u.insta && u.tiktok) {
      if (!complete[div]) complete[div] = [];
      complete[div].push(u);
    } else {
      const missing = [];
      if (!u.insta) missing.push("Instagram kosong");
      if (!u.tiktok) missing.push("TikTok kosong");
      if (!incomplete[div]) incomplete[div] = [];
      incomplete[div].push({ ...u, missing: missing.join(", ") });
    }
  });

  if (clientType === "org") {
    const completeLines = sortDivisionKeys(Object.keys(complete)).map((d) => {
      const list = complete[d]
        .sort((a, b) => rankIdx(a.title) - rankIdx(b.title) || formatNama(a).localeCompare(formatNama(b)))
        .map((u) => formatNama(u))
        .join("\n\n");
      return `${d.toUpperCase()} (${complete[d].length})\n\n${list}`;
    });
    const incompleteLines = sortDivisionKeys(Object.keys(incomplete)).map((d) => {
      const list = incomplete[d]
        .sort((a, b) => rankIdx(a.title) - rankIdx(b.title) || formatNama(a).localeCompare(formatNama(b)))
        .map((u) => `${formatNama(u)}, ${u.missing}`)
        .join("\n\n");
      return `${d.toUpperCase()} (${incomplete[d].length})\n\n${list}`;
    });
    const sections = [];
    if (completeLines.length) sections.push(`Sudah Lengkap :\n\n${completeLines.join("\n\n")}`);
    if (incompleteLines.length) sections.push(`Belum Lengkap:\n\n${incompleteLines.join("\n\n")}`);
    const body = sections.join("\n\n");
    return (
      `${salam},\n\n` +
      `Mohon ijin Komandan, melaporkan absensi update data personil ${
        (client?.nama || clientId).toUpperCase()
      } pada hari ${hari}, ${tanggal}, pukul ${jam} WIB, sebagai berikut:\n\n` +
      body
    ).trim();
  }

  const completeLines = sortDivisionKeys(Object.keys(complete)).map((d) => {
    const list = complete[d]
      .sort((a, b) => rankIdx(a.title) - rankIdx(b.title) || formatNama(a).localeCompare(formatNama(b)))
      .map((u) => formatNama(u))
      .join("\n\n");
    return `${d}, Sudah lengkap: (${complete[d].length})\n\n${list}`;
  });
  const incompleteLines = sortDivisionKeys(Object.keys(incomplete)).map((d) => {
    const list = incomplete[d]
      .sort((a, b) => rankIdx(a.title) - rankIdx(b.title) || formatNama(a).localeCompare(formatNama(b)))
      .map((u) => `${formatNama(u)}, ${u.missing}`)
      .join("\n\n");
    return `${d}, Belum lengkap: (${incomplete[d].length})\n\n${list}`;
  });

  const body = [...completeLines, ...incompleteLines].filter(Boolean).join("\n\n");

  return (
    `${salam},\n\n` +
    `Mohon ijin Komandan, melaporkan absensi update data personil ${
      (client?.nama || clientId).toUpperCase()
    } pada hari ${hari}, ${tanggal}, pukul ${jam} WIB, sebagai berikut:\n\n` +
    body
  ).trim();
}

const topRankingDependencies = {
  getRekapLikesByClient,
  getRekapKomentarByClient,
};

const topPersonnelRankingDependencies = topRankingDependencies;
const topPolresRankingDependencies = topRankingDependencies;

async function formatTopPersonnelRanking(clientId, roleFlag = null) {
  const [likesData, commentData] = await Promise.all([
    topPersonnelRankingDependencies.getRekapLikesByClient(
      clientId,
      "semua",
      undefined,
      undefined,
      undefined,
      roleFlag
    ),
    topPersonnelRankingDependencies.getRekapKomentarByClient(
      clientId,
      "semua",
      undefined,
      undefined,
      undefined,
      roleFlag
    ),
  ]);

  const likeRows = Array.isArray(likesData?.rows) ? likesData.rows : [];
  const commentRows = Array.isArray(commentData) ? commentData : [];

  const combined = new Map();
  const ensureEntry = (row) => {
    const fallbackKey = `${(row.client_id || "").toLowerCase()}::${(row.username || "").toLowerCase()}`;
    const key = row.user_id || fallbackKey;
    if (!combined.has(key)) {
      combined.set(key, {
        user_id: row.user_id || "-",
        title: row.title || "-",
        nama: row.nama || "-",
        client_name: row.client_name || row.client_id || "-",
        jumlah_like: 0,
        jumlah_komentar: 0,
      });
    }
    return combined.get(key);
  };

  likeRows.forEach((row) => {
    const entry = ensureEntry(row);
    entry.jumlah_like = (entry.jumlah_like || 0) + parseInt(row.jumlah_like ?? 0, 10);
  });

  commentRows.forEach((row) => {
    const entry = ensureEntry(row);
    entry.jumlah_komentar =
      (entry.jumlah_komentar || 0) + parseInt(row.jumlah_komentar ?? 0, 10);
  });

  const ranked = Array.from(combined.values())
    .map((entry) => ({
      ...entry,
      total: (entry.jumlah_like || 0) + (entry.jumlah_komentar || 0),
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      const nameA = formatNama(a) || `${a.nama}`;
      const nameB = formatNama(b) || `${b.nama}`;
      return nameA.localeCompare(nameB);
    });

  if (!ranked.length) {
    return "Tidak ada data ranking like/komentar personel.";
  }

  const lines = ranked.map((entry, index) => {
    const totalFormatted = Number(entry.total).toLocaleString("id-ID");
    return (
      `${index + 1}. Nama: ${entry.nama}` +
      `\n   Pangkat: ${entry.title}` +
      `\n   NRP: ${entry.user_id}` +
      `\n   Kesatuan: ${entry.client_name}` +
      `\n   Total Like/Komentar: ${totalFormatted}`
    );
  });

  return (
    "📊 *Top Ranking Like & Komentar Personel*\n" +
    "Periode: semua\n\n" +
    lines.join("\n\n")
  );
}

async function formatTopPolresRanking(clientId, roleFlag = null) {
  const [likesData, commentData] = await Promise.all([
    topPolresRankingDependencies.getRekapLikesByClient(
      clientId,
      "semua",
      undefined,
      undefined,
      undefined,
      roleFlag
    ),
    topPolresRankingDependencies.getRekapKomentarByClient(
      clientId,
      "semua",
      undefined,
      undefined,
      undefined,
      roleFlag
    ),
  ]);

  const likeRows = Array.isArray(likesData?.rows) ? likesData.rows : [];
  const commentRows = Array.isArray(commentData) ? commentData : [];

  const combined = new Map();
  const ensureEntry = (row) => {
    const rawKey = String(row.client_id || row.client_name || "-")
      .trim()
      .toLowerCase();
    const key = rawKey || "-";
    if (!combined.has(key)) {
      combined.set(key, {
        client_id: row.client_id || "-",
        client_name: String(row.client_name || row.client_id || "-")
          .trim()
          .toUpperCase(),
        jumlah_like: 0,
        jumlah_komentar: 0,
      });
    }
    const entry = combined.get(key);
    if (row.client_id && entry.client_id === "-") {
      entry.client_id = row.client_id;
    }
    if (row.client_name && entry.client_name === "-") {
      entry.client_name = String(row.client_name).trim().toUpperCase();
    }
    return entry;
  };

  likeRows.forEach((row) => {
    const entry = ensureEntry(row);
    entry.jumlah_like =
      (entry.jumlah_like || 0) + parseInt(row.jumlah_like ?? 0, 10);
  });

  commentRows.forEach((row) => {
    const entry = ensureEntry(row);
    entry.jumlah_komentar =
      (entry.jumlah_komentar || 0) + parseInt(row.jumlah_komentar ?? 0, 10);
  });

  const ranked = Array.from(combined.values())
    .map((entry) => ({
      ...entry,
      total: (entry.jumlah_like || 0) + (entry.jumlah_komentar || 0),
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      const nameA = String(a.client_name || a.client_id || "");
      const nameB = String(b.client_name || b.client_id || "");
      return nameA.localeCompare(nameB);
    });

  if (!ranked.length) {
    return "Tidak ada data ranking like/komentar polres.";
  }

  const lines = ranked.map((entry, index) => {
    const totalFormatted = Number(entry.total).toLocaleString("id-ID");
    const likeFormatted = Number(entry.jumlah_like || 0).toLocaleString("id-ID");
    const commentFormatted = Number(entry.jumlah_komentar || 0).toLocaleString(
      "id-ID"
    );
    return (
      `${index + 1}. Kesatuan: ${entry.client_name}` +
      `\n   Total Like/Komentar: ${totalFormatted}` +
      `\n   Like: ${likeFormatted} | Komentar: ${commentFormatted}`
    );
  });

  return (
    "📊 *Top Ranking Like & Komentar Polres*\n" +
    "Periode: semua\n\n" +
    lines.join("\n\n")
  );
}

async function absensiLikesDitbinmas(clientId) {
  return await absensiLikesDitbinmasReport(clientId);
}
async function absensiLikesDitbinmasSimple(clientId) {
  return await absensiLikesDitbinmasSimpleReport(clientId);
}
async function absensiKomentarTiktok(clientId, roleFlag) {
  return await absensiKomentar(clientId, { roleFlag });
}
async function absensiKomentarDitbinmasSimple(clientId) {
  return await absensiKomentarDitbinmasSimpleReport(clientId);
}
async function absensiKomentarDitbinmas(clientId) {
  return await absensiKomentarDitbinmasReport(clientId);
}

/**
 * Format rekap data personil based on category
 * Categories: all, complete, incomplete, not_yet
 */
async function formatRekapDataPersonil(clientId, category = "all") {
  const targetClientId = String(clientId || DITBINMAS_CLIENT_ID).toUpperCase();
  const [client, allUsers] = await Promise.all([
    findClientById(targetClientId),
    getUsersSocialByClient(targetClientId, targetClientId.toLowerCase()),
  ]);

  const clientName = client?.nama || targetClientId;
  const clientType = client?.client_type?.toLowerCase();

  if (clientType && clientType !== "direktorat") {
    return (
      "❌ Rekap data personil hanya tersedia untuk client bertipe " +
      `Direktorat. (${clientName})`
    );
  }

  // Filter out sat intelkam users from attendance
  const users = filterAttendanceUsers(allUsers, clientType);

  const salam = getGreeting();
  const now = new Date();
  const hari = now.toLocaleDateString("id-ID", { weekday: "long" });
  const tanggal = now.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const jam = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Categorize users
  const complete = {};
  const incomplete = {};
  const notYet = {};
  const all = {};

  users.forEach((u) => {
    const div = u.divisi || "-";
    const hasInsta = !!u.insta;
    const hasTiktok = !!u.tiktok;

    // All category
    if (!all[div]) all[div] = [];
    all[div].push(u);

    // Complete category (both filled)
    if (hasInsta && hasTiktok) {
      if (!complete[div]) complete[div] = [];
      complete[div].push(u);
    }
    // Not yet category (both empty)
    else if (!hasInsta && !hasTiktok) {
      if (!notYet[div]) notYet[div] = [];
      const missing = "Instagram dan TikTok kosong";
      notYet[div].push({ ...u, missing });
    }
    // Incomplete category (one filled, one empty)
    else {
      if (!incomplete[div]) incomplete[div] = [];
      const missing = [];
      if (!hasInsta) missing.push("Instagram kosong");
      if (!hasTiktok) missing.push("TikTok kosong");
      incomplete[div].push({ ...u, missing: missing.join(", ") });
    }
  });

  let categoryData;
  let categoryLabel;
  let showMissing = false;

  switch (category) {
    case "complete":
      categoryData = complete;
      categoryLabel = "LENGKAP (Sudah mengisi Instagram dan TikTok)";
      break;
    case "incomplete":
      categoryData = incomplete;
      categoryLabel = "KURANG (Belum lengkap, ada yang kosong)";
      showMissing = true;
      break;
    case "not_yet":
      categoryData = notYet;
      categoryLabel = "BELUM (Belum mengisi Instagram dan TikTok)";
      showMissing = true;
      break;
    case "all":
    default:
      categoryData = all;
      categoryLabel = "SEMUA";
      break;
  }

  const lines = sortDivisionKeys(Object.keys(categoryData)).map((div) => {
    const userList = categoryData[div]
      .sort(
        (a, b) =>
          rankIdx(a.title) - rankIdx(b.title) ||
          formatNama(a).localeCompare(formatNama(b))
      )
      .map((u) => {
        const name = formatNama(u);
        const socialMedia = [];
        if (u.insta) socialMedia.push(`IG: @${u.insta}`);
        if (u.tiktok) socialMedia.push(`TikTok: @${u.tiktok}`);
        const socialMediaInfo = socialMedia.length > 0 ? ` (${socialMedia.join(", ")})` : "";
        
        if (showMissing && u.missing) {
          return `${name}${socialMediaInfo}, ${u.missing}`;
        }
        return `${name}${socialMediaInfo}`;
      })
      .join("\n");
    return `*${div.toUpperCase()}* (${categoryData[div].length})\n${userList}`;
  });

  if (!lines.length) {
    return `${salam},\n\nTidak ada data personil kategori ${categoryLabel} untuk ${clientName.toUpperCase()}.`;
  }

  // Calculate totals for header
  const totalUsers = users.length;
  const totalComplete = Object.values(complete).reduce((sum, arr) => sum + arr.length, 0);
  const totalIncomplete = Object.values(incomplete).reduce((sum, arr) => sum + arr.length, 0);
  const totalNotYet = Object.values(notYet).reduce((sum, arr) => sum + arr.length, 0);

  const body = lines.join("\n\n");
  const header =
    `${salam},\n\n` +
    `Mohon ijin Komandan, melaporkan personil ${clientName.toUpperCase()} kategori *${categoryLabel}* pada hari ${hari}, ${tanggal}, pukul ${jam} WIB.\n\n` +
    `📊 *Ringkasan:*\n` +
    `• Total User: ${totalUsers}\n` +
    `• Lengkap: ${totalComplete}\n` +
    `• Kurang: ${totalIncomplete}\n` +
    `• Belum: ${totalNotYet}\n\n` +
    `Berikut detailnya:\n\n`;

  return (header + body).trim();
}

async function formatRekapBelumLengkapDirektorat(clientId) {
  const targetClientId = String(clientId || DITBINMAS_CLIENT_ID).toUpperCase();
  const [client, users] = await Promise.all([
    findClientById(targetClientId),
    getUsersSocialByClient(targetClientId, targetClientId.toLowerCase()),
  ]);

  const clientName = client?.nama || targetClientId;
  const clientType = client?.client_type?.toLowerCase();

  if (clientType && clientType !== "direktorat") {
    return (
      "❌ Rekap data belum lengkap hanya tersedia untuk client bertipe " +
      `Direktorat. (${clientName})`
    );
  }

  const targetUsers =
    clientType === "direktorat"
      ? users
      : users.filter((u) => (u.client_id || "").toUpperCase() === targetClientId);

  const salam = getGreeting();
  const now = new Date();
  const hari = now.toLocaleDateString("id-ID", { weekday: "long" });
  const tanggal = now.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const jam = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const incomplete = {};
  targetUsers.forEach((u) => {
    if (u.insta && u.tiktok) return;
    const div = u.divisi || "-";
    const missing = [];
    if (!u.insta) missing.push("Instagram kosong");
    if (!u.tiktok) missing.push("TikTok kosong");
    if (!incomplete[div]) incomplete[div] = [];
    incomplete[div].push({ ...u, missing: missing.join(", ") });
  });
  const lines = sortDivisionKeys(Object.keys(incomplete)).map((d) => {
    const list = incomplete[d]
      .sort(
        (a, b) =>
          rankIdx(a.title) - rankIdx(b.title) ||
          formatNama(a).localeCompare(formatNama(b))
      )
      .map((u) => `${formatNama(u)}, ${u.missing}`)
      .join("\n\n");
    return `*${d.toUpperCase()}* (${incomplete[d].length})\n\n${list}`;
  });
  if (!lines.length) {
    return null;
  }
  const body = lines.join("\n\n");
  return (
    `${salam},\n\n` +
    `Mohon ijin Komandan, melaporkan personil ${clientName.toUpperCase()} yang belum melengkapi data Instagram/TikTok pada hari ${hari}, ${tanggal}, pukul ${jam} WIB, sebagai berikut:\n\n` +
    body
  ).trim();
}

async function formatExecutiveSummary(clientId, roleFlag = null) {
  const users = await getUsersSocialByClient(clientId, roleFlag);
  const groups = {};
  users.forEach((u) => {
    const cid = String(u.client_id || "").trim().toLowerCase();
    if (!cid) return;
    if (!groups[cid]) groups[cid] = { total: 0, insta: 0, tiktok: 0 };
    groups[cid].total++;
    if (u.insta) groups[cid].insta++;
    if (u.tiktok) groups[cid].tiktok++;
  });
  const stats = await Promise.all(
    Object.entries(groups).map(async ([cid, stat]) => {
      const normalizedCid = String(cid || "").trim().toLowerCase();
      const client = await findClientById(normalizedCid);
      const name = (client?.nama || normalizedCid).toUpperCase();
      const igPct = stat.total ? (stat.insta / stat.total) * 100 : 0;
      const ttPct = stat.total ? (stat.tiktok / stat.total) * 100 : 0;
      return { cid: normalizedCid, name, ...stat, igPct, ttPct };
    })
  );
  const totals = stats.reduce(
    (acc, s) => {
      acc.total += s.total;
      acc.insta += s.insta;
      acc.tiktok += s.tiktok;
      return acc;
    },
    { total: 0, insta: 0, tiktok: 0 }
  );
  const toPercent = (num, den) => (den ? ((num / den) * 100).toFixed(1) : "0.0");
  const arrAvg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const arrMedian = (arr) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const igArr = stats.map((s) => s.igPct);
  const ttArr = stats.map((s) => s.ttPct);
  const avgIg = arrAvg(igArr);
  const avgTt = arrAvg(ttArr);
  const medIg = arrMedian(igArr);
  const medTt = arrMedian(ttArr);
  const lowSatkers = stats.filter((s) => s.igPct < 10 && s.ttPct < 10).length;
  const topSatkers = stats
    .filter((s) => s.igPct >= 90 && s.ttPct >= 90)
    .map((s) => s.name);
  const strongSatkers = stats
    .filter((s) => s.igPct >= 80 && s.ttPct >= 80 && !(s.igPct >= 90 && s.ttPct >= 90))
    .map((s) => `${s.name} (${s.igPct.toFixed(1)}% / ${s.ttPct.toFixed(1)}%)`);
  const sortedAvg = [...stats].sort((a, b) => b.igPct + b.ttPct - (a.igPct + a.ttPct));
  const topPerformers = sortedAvg
    .slice(0, 5)
    .map((s, i) => `${i + 1}) ${s.name} ${s.igPct.toFixed(1)} / ${s.ttPct.toFixed(1)}`);
  const bottomPerformers = sortedAvg
    .slice(-5)
    .map((s) => `${s.name} ${s.igPct.toFixed(1)}% / ${s.ttPct.toFixed(1)}%`);
  const anomalies = stats
    .filter((s) => Math.abs(s.igPct - s.ttPct) >= 15)
    .map((s) => {
      const diff = (s.igPct - s.ttPct).toFixed(1);
      if (s.igPct > s.ttPct)
        return `${s.name} IG ${s.igPct.toFixed(1)}% vs TT ${s.ttPct.toFixed(1)}% (+${diff} poin ke IG)`;
      return `${s.name} IG ${s.igPct.toFixed(1)}% vs TT ${s.ttPct.toFixed(1)}% (${diff} ke IG)`;
    });
  const backlogIg = stats
    .map((s) => ({ name: s.name, count: s.total - s.insta }))
    .sort((a, b) => b.count - a.count);
  const backlogTt = stats
    .map((s) => ({ name: s.name, count: s.total - s.tiktok }))
    .sort((a, b) => b.count - a.count);
  const top10Ig = backlogIg.slice(0, 10);
  const top10Tt = backlogTt.slice(0, 10);
  const top10IgCount = top10Ig.reduce((a, b) => a + b.count, 0);
  const top10TtCount = top10Tt.reduce((a, b) => a + b.count, 0);
  const missingIg = totals.total - totals.insta;
  const missingTt = totals.total - totals.tiktok;
  const percentTopIg = missingIg ? ((top10IgCount / missingIg) * 100).toFixed(1) : "0.0";
  const percentTopTt = missingTt ? ((top10TtCount / missingTt) * 100).toFixed(1) : "0.0";
  const projectedIg = ((totals.insta + 0.7 * top10IgCount) / totals.total) * 100;
  const projectedTt = ((totals.tiktok + 0.7 * top10TtCount) / totals.total) * 100;
  const now = new Date();
  const dateStr = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const lines = [
    "Mohon Ijin Komandan,",
    "",
    `*Rekap User Insight ${dateStr} ${timeStr} WIB*`,
    `*Personil Saat ini:* ${totals.total.toLocaleString("id-ID")} personil`,
    "",
    `*Cakupan keseluruhan:* IG ${toPercent(totals.insta, totals.total)}% (${totals.insta}/${totals.total}), TT ${toPercent(totals.tiktok, totals.total)}% (${totals.tiktok}/${totals.total}).`,
    "",
    `*Rata-rata satker:* IG ${avgIg.toFixed(1)}% (median ${medIg.toFixed(1)}%), TT ${avgTt.toFixed(1)}% (median ${medTt.toFixed(1)}%)${
      lowSatkers ? " → *penyebaran masih lebar, banyak satker di bawah 10%.*" : ""
    }`,
  ];
  if (topSatkers.length)
    lines.push("", `*Satker dengan capaian terbaik (≥90% IG & TT):* ${topSatkers.join(", ")}.`);
  if (strongSatkers.length)
    lines.push("", `*Tambahan kuat (≥80% IG & TT):* ${strongSatkers.join(", ")}.`);
  if (topPerformers.length || bottomPerformers.length)
    lines.push("", "*Highlight Pencapaian & Masalah*");
  if (topPerformers.length)
    lines.push("", `*Top performer* (rata-rata IG/TT): ${topPerformers.join(", ")}.`);
  if (bottomPerformers.length)
    lines.push(
      "",
      `*Bottom performer* (rata-rata IG/TT, sangat rendah di kedua platform): ${bottomPerformers.join(" • ")}`
    );
  if (anomalies.length)
    lines.push("", "*Anomali :*", anomalies.map((a) => `*${a}*`).join("\n"));
  lines.push("", "*Konsentrasi Backlog (prioritas penanganan)*", "");
  lines.push(
    `Top-10 penyumbang backlog menyerap >50% backlog masing-masing platform.`
  );
  if (missingIg)
    lines.push(
      "",
      `*IG Belum Diisi (${missingIg}) – 10 terbesar (≈${percentTopIg}%):*`,
      top10Ig.map((s) => `${s.name} (${s.count})`).join(", ")
    );
  if (missingTt)
    lines.push(
      "",
      `*TikTok Belum Diisi (${missingTt}) – 10 terbesar (≈${percentTopTt}%):*`,
      top10Tt.map((s) => `${s.name} (${s.count})`).join(", ")
    );
  lines.push(
    "",
    `*Proyeksi dampak cepat:* Menutup 70% backlog di Top-10 → proyeksi capaian naik ke IG ≈ ${projectedIg.toFixed(
      1
    )}% dan TT ≈ ${projectedTt.toFixed(1)}%.`
  );
  const backlogNames = top10Ig.slice(0, 6).map((s) => s.name);
  const ttBetter = stats
    .filter((s) => s.ttPct - s.igPct >= 10)
    .map((s) => s.name);
  const roleModel = topSatkers;
  if (backlogNames.length || anomalies.length || ttBetter.length || roleModel.length)
    lines.push("", "*Catatan per Satker*");
  if (backlogNames.length)
    lines.push("", `*Backlog terbesar:* ${backlogNames.join(", ")}.`);
  if (ttBetter.length)
    lines.push("", `*TT unggul:* ${ttBetter.join(", ")} (pertahankan).`);
  if (roleModel.length)
    lines.push(
      "",
      `*Role model:* ${roleModel.join(", ")} — didorong menjadi mentor lintas satker.`
    );
  lines.push(
    "",
    "_Catatan kaki:_ IG = Instagram; TT = TikTok; backlog = pekerjaan tertunda / User Belum Update data;"
  );
return lines.join("\n").trim();
}

async function formatRekapAllSosmed(
  igNarrative,
  ttNarrative,
  clientName = "DIREKTORAT BINMAS",
  clientId = DITBINMAS_CLIENT_ID,
  options = {}
) {
  const { igRankingData = null, ttRankingData = null } = options || {};
  const now = new Date();
  const hari = hariIndo[now.getDay()];
  const tanggal = now.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const todayKey = now.toDateString();

  const normalizeText = (text) => (text || "").replace(/\r\n/g, "\n");
  const parseNumber = (value) => {
    if (!value) return null;
    const normalized = value.replace(/\./g, "").replace(/,/g, ".");
    const num = Number.parseFloat(normalized);
    return Number.isNaN(num) ? null : num;
  };
  const cleanContentLine = (line) =>
    line ? line.replace(/^\d+\.\s*/, "").trim() : null;

  const indentParagraphs = (paragraphs) =>
    paragraphs
      .map((paragraph) => (paragraph || "").trim())
      .filter(Boolean)
      .flatMap((paragraph, index, array) => {
        const lines = paragraph
          .split("\n")
          .map((line) => `   ${line.trim()}`)
          .filter((line) => line.trim() !== "");
        if (index < array.length - 1) return [...lines, ""];
        return lines;
      });

  const extractLinksFromText = (text) =>
    normalizeText(text)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /https?:\/\//i.test(line))
      .map((line) => cleanContentLine(line) || line);

  const dedupePreserveOrder = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const extractTiktokTasks = (text) => {
    const normalized = normalizeText(text);
    const sanitized = normalized
      .split("\n")
      .filter((line) => !/performa\s+(tertinggi|terendah)/i.test(line))
      .join("\n");

    const taskSectionMatch = sanitized.match(
      /(?:\*Tugas TikTok\*|Daftar Link Konten TikTok:?)[^\n]*\n([\s\S]*?)(?:\n\s*\n|\n\*|\n#|$)/i
    );

    const taskSection = taskSectionMatch ? taskSectionMatch[1] : sanitized;
    const links = extractLinksFromText(taskSection);

    return dedupePreserveOrder(links);
  };

  const extractRankingSections = (text, metricLabel = "") => {
    const normalized = normalizeText(text);
    const formatLine = (line) => {
      const cleaned = cleanContentLine(line.replace(/^[-•]\s*/, ""));
      if (!cleaned) return null;
      if (/^top 5\b|^bottom 5\b/i.test(cleaned)) return null;
      if (metricLabel && !/likes|komentar/i.test(cleaned))
        return `${cleaned} — ${metricLabel}`;
      return cleaned;
    };

    const readSection = (regex) => {
      const match = normalized.match(regex);
      if (!match) return [];
      return match[1]
        .split("\n")
        .map((line) => line.trim())
        .map(formatLine)
        .filter(Boolean);
    };

    return {
      top: readSection(/Top 5 [^:]*:\s*([\s\S]*?)(?=\n\s*Bottom 5|\n\s*Top 5|$)/i),
      bottom: readSection(/Bottom 5 [^:]*:\s*([\s\S]*?)(?=\n\s*Top 5|\n\s*Bottom 5|$)/i),
    };
  };

  const buildRankingFromData = (entries = [], metricLabel = "") =>
    entries
      .filter((entry) => entry && entry.name)
      .slice(0, 5)
      .map((entry, index) => {
        const score =
          entry.score ?? entry.likes ?? entry.comments ?? entry.value ?? null;
        const metric = metricLabel || entry.metricLabel || "";
        const metricSuffix =
          score == null
            ? metric
              ? ` — ${metric}`
              : ""
            : ` — ${score.toLocaleString("id-ID")}${metric ? ` ${metric}` : ""}`;
        return `${index + 1}. ${entry.name}${metricSuffix}`.trim();
      });

  const buildRankingSectionsFromData = (data = {}, metricLabel = "") => {
    const metric = data?.metricLabel || metricLabel;
    const top = buildRankingFromData(data?.top || [], metric);
    const bottom = buildRankingFromData(data?.bottom || [], metric);
    return { top, bottom };
  };

  const resolveRankingSections = (sections, fallbackData, metricLabel = "") => {
    const hasNarrativeRanking = sections.top.length || sections.bottom.length;
    const fallbackSections = buildRankingSectionsFromData(
      fallbackData,
      metricLabel
    );
    const hasFallbackRanking =
      fallbackSections.top.length || fallbackSections.bottom.length;
    const isTodayRanking =
      fallbackData?.generatedDateKey === todayKey ||
      fallbackData?.generatedDate === tanggal;
    if (hasNarrativeRanking || !isTodayRanking || !hasFallbackRanking)
      return sections;

    return fallbackSections;
  };

  const extractIgData = (text) => {
    const normalized = normalizeText(text);
    const data = {};

    const kontenMatch = normalized.match(/Jumlah konten aktif:\s*([\d.,]+)/i);
    if (kontenMatch) data.contentCount = parseNumber(kontenMatch[1]);

    const likeMatch = normalized.match(
      /Total likes:\s*([\d.,]+)\s+dari\s+([\d.,]+)[^()]*\(([\d.,]+)%/i
    );
    if (likeMatch) {
      data.totalLikes = parseNumber(likeMatch[1]);
      data.totalLikesTarget = parseNumber(likeMatch[2]);
      data.likePercent = parseNumber(likeMatch[3]);
    }

    const targetMatch = normalized.match(
      /Target harian ≥95%:\s*([\d.,]+)\s+likes(?:\s*→\s*kekurangan\s*([\d.,]+))?/i
    );
    if (targetMatch) {
      data.targetLikes = parseNumber(targetMatch[1]);
      data.likeGap = parseNumber(targetMatch[2]);
      data.targetAchieved =
        /target tercapai/i.test(targetMatch[0]) ||
        (data.likeGap != null && data.likeGap <= 0);
    }

    const rataMatch = normalized.match(
      /Rata-rata likes\/konten:\s*([\d.,]+)/i
    );
    if (rataMatch) data.avgLikesPerContent = parseNumber(rataMatch[1]);

    const gapKontenMatch = normalized.match(
      /Rata-rata likes\/konten:[^\n]*;\s*([^\n]+)/i
    );
    if (gapKontenMatch) data.contentGapLine = gapKontenMatch[1].trim();

    const contribMatch = normalized.match(
      /Kontributor likes terbesar:\s*([^\n]+)/i
    );
    if (contribMatch) data.topContributor = contribMatch[1].trim();

    const distribMatch = normalized.match(
      /Distribusi likes per konten:\s*([\s\S]*?)(?:\n#|\nDemikian|$)/i
    );
    if (distribMatch) {
      const distribLines = distribMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      data.topContentLine = distribLines.find((line) => /1\./.test(line)) || "";
      data.otherContentLines = distribLines.slice(1);
    }

    const personilMatch = normalized.match(
      /Personil tercatat:\s*([\d.,]+)\s*→\s*IG\s*([\d.,]+)%\s*\(([\d.,]+)\),\s*TT\s*([\d.,]+)%\s*\(([\d.,]+)\)/i
    );
    if (personilMatch) {
      data.personilTotal = parseNumber(personilMatch[1]);
      data.personilIgPercent = parseNumber(personilMatch[2]);
      data.personilIgCount = parseNumber(personilMatch[3]);
      data.personilTtPercent = parseNumber(personilMatch[4]);
      data.personilTtCount = parseNumber(personilMatch[5]);
    }

    const rataSatkerMatch = normalized.match(
      /Rata-rata satker:\s*IG\s*([\d.,]+)%\s*\(median\s*([\d.,]+)%\),\s*TT\s*([\d.,]+)%\s*\(median\s*([\d.,]+)%\)/i
    );
    if (rataSatkerMatch) {
      data.avgIg = parseNumber(rataSatkerMatch[1]);
      data.medianIg = parseNumber(rataSatkerMatch[2]);
      data.avgTt = parseNumber(rataSatkerMatch[3]);
      data.medianTt = parseNumber(rataSatkerMatch[4]);
    }

    const bestSatkerMatch = normalized.match(
      /Satker dengan capaian ≥90% IG & TT:\s*([^\n.]+)[^\n]*/i
    );
    if (bestSatkerMatch) data.bestSatkers = bestSatkerMatch[1].trim();

    const strongSatkerMatch = normalized.match(
      /Satker di kisaran 80% \(butuh dorongan akhir\):\s*([^\n.]+)[^\n]*/i
    );
    if (strongSatkerMatch) data.strongSatkers = strongSatkerMatch[1].trim();

    const lowSatkerMatch = normalized.match(
      /Satker perlu perhatian \(<10% di kedua kanal\):\s*([^\n.]+)[^\n]*/i
    );
    if (lowSatkerMatch) data.lowSatkers = lowSatkerMatch[1].trim();

    const gapLinesMatch = normalized.match(
      /Gap IG vs TikTok \(≥10 poin[^\n]*\):\s*([\s\S]*?)(?:\n#|\nDemikian|$)/i
    );
    if (gapLinesMatch) {
      data.gapLines = gapLinesMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }

    const igBacklogMatch = normalized.match(
      /IG belum diisi:\s*([\d.,]+)\s+akun[^≈]*≈([\d.,]+)%: ([^\n)]+)/i
    );
    if (igBacklogMatch) {
      data.igBacklog = parseNumber(igBacklogMatch[1]);
      data.igBacklogTopPercent = parseNumber(igBacklogMatch[2]);
      data.igBacklogTopList = igBacklogMatch[3].trim();
    }

    const ttBacklogMatch = normalized.match(
      /TikTok belum diisi:\s*([\d.,]+)\s+akun[^≈]*≈([\d.,]+)%: ([^\n)]+)/i
    );
    if (ttBacklogMatch) {
      data.ttBacklog = parseNumber(ttBacklogMatch[1]);
      data.ttBacklogTopPercent = parseNumber(ttBacklogMatch[2]);
      data.ttBacklogTopList = ttBacklogMatch[3].trim();
    }

    const projectionMatch = normalized.match(
      /Proyeksi jika 70% Top-10 teratasi:\s*IG\s*→\s*~([\d.,]+)%[,\s]+TT\s*→\s*~([\d.,]+)%/i
    );
    if (projectionMatch) {
      data.projectedIg = parseNumber(projectionMatch[1]);
      data.projectedTt = parseNumber(projectionMatch[2]);
    }

    const topPerfMatch = normalized.match(
      /Top performer rata-rata IG\/TT:\s*([^\n.]+)[^\n]*/i
    );
    if (topPerfMatch) data.topPerformers = topPerfMatch[1].trim();

    const bottomPerfMatch = normalized.match(
      /Bottom performer rata-rata IG\/TT:\s*([^\n.]+)[^\n]*/i
    );
    if (bottomPerfMatch) data.bottomPerformers = bottomPerfMatch[1].trim();

    const notesMatch = normalized.match(/# Catatan Tambahan\s*([\s\S]*?)(?:\nDemikian|$)/i);
    if (notesMatch) {
      data.notes = notesMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");
    }

    return data;
  };

  const extractTtData = (text) => {
    const normalized = normalizeText(text);
    const data = {};

    const contentMatch = normalized.match(/Konten dipantau\s*:\s*([\d.,]+)/i);
    if (contentMatch) data.contentCount = parseNumber(contentMatch[1]);

    const interactionMatch = normalized.match(
      /Interaksi aktual\s*:\s*([\d.,]+)\/([\d.,]+)\s*\(([\d.,]+)%/i
    );
    if (interactionMatch) {
      data.totalComments = parseNumber(interactionMatch[1]);
      data.targetComments = parseNumber(interactionMatch[2]);
      data.commentPercent = parseNumber(interactionMatch[3]);
    }

    const hitTargetMatch = normalized.match(
      /Personel mencapai target\s*:\s*([\d.,]+)\/([\d.,]+)\s*\(([\d.,]+)%/i
    );
    if (hitTargetMatch) {
      data.hitTarget = parseNumber(hitTargetMatch[1]);
      data.eligible = parseNumber(hitTargetMatch[2]);
      data.participationPercent = parseNumber(hitTargetMatch[3]);
    }

    const activeMatch = normalized.match(
      /Personel aktif \(≥1 konten\)\s*:\s*([\d.,]+)\/([\d.,]+)\s*\(([\d.,]+)%/i
    );
    if (activeMatch) {
      data.activeCount = parseNumber(activeMatch[1]);
      data.activeEligible = parseNumber(activeMatch[2]);
      data.activationPercent = parseNumber(activeMatch[3]);
    }

    const uniqueMatch = normalized.match(/Partisipan unik\s*:\s*([\d.,]+)/i);
    if (uniqueMatch) data.uniqueParticipants = parseNumber(uniqueMatch[1]);

    const bestContentMatch = normalized.match(
      /Performa tertinggi\s*:\s*([^\n]+)/i
    );
    if (bestContentMatch) data.bestContent = bestContentMatch[1].trim();

    const worstContentMatch = normalized.match(
      /Performa terendah\s*:\s*([^\n]+)/i
    );
    if (worstContentMatch) data.worstContent = worstContentMatch[1].trim();

    const topContribMatch = normalized.match(
      /Penyumbang komentar terbesar\s*:\s*([^\n]+)/i
    );
    if (topContribMatch) data.topContributor = topContribMatch[1].trim();

    const topSatkerMatch = normalized.match(
      /Top satker aktif\s*:\s*([^\n]+)/i
    );
    if (topSatkerMatch) data.topSatkers = topSatkerMatch[1].trim();

    const lowSatkerMatch = normalized.match(
      /Satker perlu perhatian\s*:\s*([^\n]+)/i
    );
    if (lowSatkerMatch) data.lowSatkers = lowSatkerMatch[1].trim();

    const backlogMatch = normalized.match(
      /Personel belum komentar\s*:\s*([\d.,]+)\s*\(prioritas:\s*([^\n]+)\)/i
    );
    if (backlogMatch) {
      data.backlog = parseNumber(backlogMatch[1]);
      data.backlogFocus = backlogMatch[2].trim();
    }

    const missingHandleMatch = normalized.match(
      /Belum input akun TikTok\s*:\s*([\d.,]+)\s*\(sumber utama:\s*([^\n]+)\)/i
    );
    if (missingHandleMatch) {
      data.missingHandle = parseNumber(missingHandleMatch[1]);
      data.missingHandleFocus = missingHandleMatch[2].trim();
    }

    const failureMatch = normalized.match(/⚠️ Data komentar gagal diambil[^\n]*/i);
    if (failureMatch) data.failureNote = failureMatch[0];

    return data;
  };

  const resolvedClientName = (clientName || "DIREKTORAT BINMAS").trim()
    ? (clientName || "DIREKTORAT BINMAS").trim()
    : "DIREKTORAT BINMAS";

  const scopeByClient = (text) => {
    const normalized = normalizeText(text);
    const lines = normalized.split("\n");
    const target = resolvedClientName.toLowerCase();
    const startIdx = lines.findIndex((line) =>
      line.toLowerCase().includes(target)
    );
    if (startIdx === -1) return normalized;
    const clientMarker = /(direktorat|polres|polresta|polrestabes|polda)/i;
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      const isNextClient =
        clientMarker.test(line) && !line.toLowerCase().includes(target);
      if (isNextClient) {
        endIdx = i;
        break;
      }
    }
    return lines.slice(startIdx, endIdx).join("\n").trim();
  };

  const scopedIgNarrative = scopeByClient(igNarrative);
  const scopedTtNarrative = scopeByClient(ttNarrative);

  const ig = extractIgData(scopedIgNarrative);
  const tt = extractTtData(scopedTtNarrative);

  const igRankingSections = resolveRankingSections(
    extractRankingSections(scopedIgNarrative, "likes"),
    igRankingData,
    "likes"
  );
  const ttRankingSections = resolveRankingSections(
    extractRankingSections(scopedTtNarrative, "komentar"),
    ttRankingData,
    "komentar"
  );

  const formatUploadTime = (date) => {
    if (!date) return null;
    try {
      const parsed = new Date(date);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed
        .toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Jakarta",
        })
        .replace(/\./g, ":");
    } catch {
      return null;
    }
  };

  const buildContentLinkList = async () => {
    const linkLines = [];
    let igPosts = [];
    let ttPosts = [];
    let clientType = null;
    let tiktokUsername = null;

    const normalizedClientId = (clientId || resolvedClientName)
      .toString()
      .trim();

    try {
      const client = await findClientById(normalizedClientId);
      clientType = client?.client_type?.toLowerCase() || null;
      tiktokUsername = (client?.client_tiktok || "").replace(/^@/, "");
    } catch {
      clientType = null;
    }

    const shouldUseDailyContent =
      clientType === "direktorat" || isDitbinmas(normalizedClientId);

    if (shouldUseDailyContent) {
      try {
        igPosts = (await getInstaPostsTodayByClient(normalizedClientId)) || [];
      } catch {
        igPosts = [];
      }
      try {
        ttPosts = (await getTiktokPostsTodayByClient(normalizedClientId)) || [];
      } catch {
        ttPosts = [];
      }
    }

    const igLinesFromPosts = igPosts
      .filter((post) => post?.shortcode)
      .map((post) => {
        const uploadTime = formatUploadTime(post?.created_at);
        const uploadLabel = uploadTime ? ` — ${uploadTime} WIB` : "";
        return `https://www.instagram.com/p/${post.shortcode}${uploadLabel}`;
      });

    const ttLinesFromPosts = ttPosts
      .filter((post) => post?.video_id)
      .map((post) => {
        const link = tiktokUsername
          ? `https://www.tiktok.com/@${tiktokUsername}/video/${post.video_id}`
          : `https://www.tiktok.com/video/${post.video_id}`;
        const uploadTime = formatUploadTime(post?.created_at);
        const uploadLabel = uploadTime ? ` — ${uploadTime} WIB` : "";
        return `${link}${uploadLabel}`;
      });

    let igLines = igLinesFromPosts;
    if (!igLines.length) {
      igLines = [ig.topContentLine, ...(ig.otherContentLines || [])]
        .map((line) => cleanContentLine(line))
        .filter(Boolean);
    }

    if (!igLines.length) igLines.push(...extractLinksFromText(scopedIgNarrative));

    if (!igLines.length) {
      const rankedIgLines = dedupePreserveOrder([
        ...igRankingSections.top,
        ...igRankingSections.bottom,
      ]);
      igLines.push(...rankedIgLines);
    }

    let ttLines = ttLinesFromPosts;
    if (!ttLines.length) ttLines = extractTiktokTasks(scopedTtNarrative);

    if (!ttLines.length) {
      const rankedTtLines = dedupePreserveOrder([
        ...ttRankingSections.top,
        ...ttRankingSections.bottom,
      ]);
      ttLines.push(...rankedTtLines);
    }

    if (igLines.length)
      igLines.forEach((line, index) =>
        linkLines.push(`- IG ${index + 1}. ${line}`)
      );
    if (ttLines.length)
      ttLines.forEach((line, index) =>
        linkLines.push(`- TikTok ${index + 1}. ${line}`)
      );

    if (!linkLines.length) {
      linkLines.push("Tidak ada tugas hari ini.");
    }

    const hasDailyContent = igLinesFromPosts.length > 0 || ttLinesFromPosts.length > 0;
    return { linkLines, hasDailyContent };
  };

  const header = `*Laporan Harian Engagement – ${hari}, ${tanggal}*`;
  const linkHeader = "List Link Tugas Instagram dan Tiktok Hari ini :";
  const { linkLines, hasDailyContent } = await buildContentLinkList();

  const igParagraphs = [];
  const ttParagraphs = [];

  const igNarrativeText = normalizeText(scopedIgNarrative).trim();
  const ttNarrativeText = normalizeText(scopedTtNarrative).trim();

  const narrativeHasRanking = (text) => /Top 5|Bottom 5/i.test(text || "");
  const ttNarrativeHasRanking = narrativeHasRanking(ttNarrativeText);
  let resolvedTtRankingSections = ttRankingSections;

  if (
    !(ttRankingSections.top.length || ttRankingSections.bottom.length) &&
    ttNarrativeHasRanking
  ) {
    const fallbackSections = buildRankingSectionsFromData(
      ttRankingData,
      "komentar"
    );
    if (fallbackSections.top.length || fallbackSections.bottom.length)
      resolvedTtRankingSections = fallbackSections;
  }

  const appendRankingBlock = (paragraphs, sections, metricLabel) => {
    if (!(sections.top.length || sections.bottom.length)) return;
    const block = [
      `Top 5 ${metricLabel}:`,
      ...sections.top.map((line) => `- ${line}`),
      "",
      `Bottom 5 ${metricLabel}:`,
      ...sections.bottom.map((line) => `- ${line}`),
    ]
      .filter(Boolean)
      .join("\n");

    if (block.trim()) paragraphs.push(block);
  };

  if (igNarrativeText) {
    igParagraphs.push(igNarrativeText);
    if (!narrativeHasRanking(igNarrativeText))
      appendRankingBlock(igParagraphs, igRankingSections, "Likes");
  } else {
    appendRankingBlock(igParagraphs, igRankingSections, "Likes");
  }

  const ttHasRanking =
    resolvedTtRankingSections.top.length ||
    resolvedTtRankingSections.bottom.length;

  if (ttHasRanking) {
    ttParagraphs.push(`🎵 TikTok (${resolvedClientName.toUpperCase()})`);
    appendRankingBlock(ttParagraphs, resolvedTtRankingSections, "Komentar");
  } else if (ttNarrativeText && !ttNarrativeHasRanking) {
    ttParagraphs.push(ttNarrativeText);
  } else if (ttNarrativeHasRanking) {
    ttParagraphs.push("Tidak ada data peringkat komentar TikTok.");
  }

  if (!hasDailyContent && !igParagraphs.length && !ttParagraphs.length) {
    const noTaskNote = "Tidak ada tugas hari ini.";
    igParagraphs.push(noTaskNote);
    ttParagraphs.push(noTaskNote);
  }

  const buildClosing = () => {
    const igBacklog = ig.igBacklog ?? 0;
    const ttBacklog = ttHasRanking ? tt.backlog ?? 0 : 0;
    const igGood = ig.targetAchieved === true || (ig.likePercent ?? 0) >= 95;
    const ttGood = ttHasRanking ? (tt.commentPercent ?? 0) >= 80 : null;
    const backlogHigh = igBacklog > 30 || (ttHasRanking && ttBacklog > 30);
    const backlogModerate =
      igBacklog > 10 || (ttHasRanking && ttBacklog > 10);
    const likeGapHigh = (ig.likeGap ?? 0) > 0;

    if (igGood && ttHasRanking && ttGood && !backlogModerate)
      return `Capaian IG & TikTok sudah sesuai target; terima kasih atas sinergi hangat seluruh pembina di jajaran ${resolvedClientName}.`;
    if (!ttHasRanking && igGood && !backlogModerate)
      return `Capaian IG sudah sesuai target; terima kasih atas sinergi hangat seluruh pembina di jajaran ${resolvedClientName}.`;
    if (backlogHigh)
      return "Backlog personel masih tinggi; dukungan ekstra dari para pembina untuk satker prioritas akan sangat berarti.";
    if (likeGapHigh || (ttHasRanking && ttGood === false))
      return "Target harian belum sepenuhnya terpenuhi; kolaborasi halus antar satker akan membantu menutup gap likes dan komentar.";
    return `Progres bergerak positif; mari terus kawal pengejaran target harian dengan ritme nyaman ala ${resolvedClientName}.`;
  };

  const sections = [];
  sections.push(
    ["1. 📸 *Instagram*", ...indentParagraphs(igParagraphs)].join("\n")
  );
  sections.push(
    ["2. 🎵 *TikTok*", ...indentParagraphs(ttParagraphs)].join("\n")
  );

  const closingLine = buildClosing();

  return [
    header,
    "",
    `*${resolvedClientName}*`,
    "",
    linkHeader,
    ...linkLines,
    "",
    ...sections,
    "",
    closingLine,
  ]
    .filter((segment) => typeof segment === "string" && segment.trim() !== "")
    .join("\n")
    .trim();
}

async function performAction(
  action,
  clientId,
  waClient,
  chatId,
  roleFlag,
  userClientId,
  context = {},
  fallbackOptions = {}
) {
  let msg = "";
  const { fallbackClients, fallbackContext } = fallbackOptions;
  const fallbackPayload = fallbackClients
    ? { fallbackClients, fallbackContext, reportClient: waClient }
    : {};
  const userClient = userClientId ? await findClientById(userClientId) : null;
  const userType = userClient?.client_type?.toLowerCase();
  const attendanceClientId = String(userClientId || clientId || "").toUpperCase();
  const normalizedRoleFlag = (roleFlag || attendanceClientId).toLowerCase();
  switch (action) {
    case "1": {
      msg = await formatRekapUserData(clientId, roleFlag);
      break;
    }
    case "2": {
      msg = await formatExecutiveSummary(clientId, roleFlag);
      break;
    }
    case "4": {
      try {
        const { filePath } = await saveSatkerUpdateMatrixExcel({
          clientId,
          roleFlag,
          username: context.username,
        });
        const buffer = await readFile(filePath);
        await sendWAFile(
          waClient,
          buffer,
          basename(filePath),
          chatId,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        await unlink(filePath);
        msg = "✅ File Excel dikirim.";
      } catch (error) {
        console.error("Gagal membuat rekap matriks update satker:", error);
        msg =
          error?.message &&
          (error.message.includes("direktorat") ||
            error.message.includes("Client tidak ditemukan"))
            ? error.message
            : "❌ Gagal membuat rekap matriks update satker.";
      }
      break;
    }
      case "5":
        msg = await absensiLikesDitbinmas(attendanceClientId);
        break;
      case "6":
        msg = await absensiLikesDitbinmasSimple(attendanceClientId);
        break;
      case "7": {
        const opts = { mode: "all", roleFlag: normalizedRoleFlag };
        msg = await absensiLikes(attendanceClientId, opts);
        break;
      }
      case "8":
        msg = await absensiKomentarTiktok(attendanceClientId, normalizedRoleFlag);
        break;
      case "9":
        msg = await absensiKomentarDitbinmasSimple(attendanceClientId);
        break;
      case "10":
        msg = await absensiKomentarDitbinmas(attendanceClientId);
        break;
    case "11": {
      msg = await absensiRegistrasiDashboardDirektorat(clientId);
      break;
    }
    case "12": {
      const { fetchAndStoreInstaContent } = await import("../fetchpost/instaFetchPost.js");
      const { handleFetchLikesInstagram } = await import("../fetchengagement/fetchLikesInstagram.js");
      const { rekapLikesIG } = await import("../fetchabsensi/insta/absensiLikesInsta.js");
      const targetId = (clientId || DITBINMAS_CLIENT_ID).toUpperCase();
      const targetClient = await findClientById(targetId);
      const targetLabel = targetClient?.nama
        ? `${formatNama(targetClient.nama)} (${targetId})`
        : targetId;
      await fetchAndStoreInstaContent([
        "shortcode",
        "caption",
        "like_count",
        "timestamp",
      ], waClient, chatId, targetId);
      await handleFetchLikesInstagram(null, null, targetId);
      const rekapMsg = await rekapLikesIG(targetId);
      msg =
        rekapMsg ||
        `Belum ada konten IG pada akun Official ${targetLabel} hari ini.`;
      break;
    }
    case "13": {
      const { handleFetchLikesInstagram } = await import("../fetchengagement/fetchLikesInstagram.js");
      const targetId = (clientId || DITBINMAS_CLIENT_ID).toUpperCase();
      const targetClient = await findClientById(targetId);
      const targetLabel = targetClient?.nama
        ? `${formatNama(targetClient.nama)} (${targetId})`
        : targetId;
      await handleFetchLikesInstagram(waClient, chatId, targetId);
      msg = `✅ Selesai fetch likes Instagram ${targetLabel}.`;
      break;
    }
    case "14": {
      const { fetchAndStoreTiktokContent } = await import("../fetchpost/tiktokFetchPost.js");
      const { handleFetchKomentarTiktokBatch } = await import("../fetchengagement/fetchCommentTiktok.js");
      const targetId = (clientId || DITBINMAS_CLIENT_ID).toUpperCase();
      const targetClient = await findClientById(targetId);
      const targetLabel = targetClient?.nama
        ? `${formatNama(targetClient.nama)} (${targetId})`
        : targetId;
      await fetchAndStoreTiktokContent(targetId, waClient, chatId);
      await handleFetchKomentarTiktokBatch(waClient, chatId, targetId);
      const rekapTiktok = await absensiKomentarDitbinmasReport(
        userType === "org" ? { clientFilter: userClientId } : {}
      );
      msg =
        rekapTiktok ||
        `Tidak ada konten TikTok untuk ${targetLabel} hari ini.`;
      break;
    }
    case "15": {
      const { handleFetchKomentarTiktokBatch } = await import("../fetchengagement/fetchCommentTiktok.js");
      const targetId = (clientId || DITBINMAS_CLIENT_ID).toUpperCase();
      const targetClient = await findClientById(targetId);
      const targetLabel = targetClient?.nama
        ? `${formatNama(targetClient.nama)} (${targetId})`
        : targetId;
      await handleFetchKomentarTiktokBatch(waClient, chatId, targetId);
      msg = `✅ Selesai fetch komentar TikTok ${targetLabel}.`;
      break;
    }
    case "16": {
      const { fetchAndStoreInstaContent } = await import("../fetchpost/instaFetchPost.js");
      const { handleFetchLikesInstagram } = await import("../fetchengagement/fetchLikesInstagram.js");
      const { fetchAndStoreTiktokContent } = await import("../fetchpost/tiktokFetchPost.js");
      const { handleFetchKomentarTiktokBatch } = await import("../fetchengagement/fetchCommentTiktok.js");
      const { generateSosmedTaskMessage } = await import("../fetchabsensi/sosmedTask.js");

      const targetId = (clientId || "").toUpperCase();
      const fetchErrors = [];

      let previousIgShortcodes = [];
      let previousTiktokVideoIds = [];
      try {
        previousIgShortcodes = await getShortcodesTodayByClient(targetId);
      } catch (err) {
        console.error("Error reading previous Instagram shortcodes:", err);
        previousIgShortcodes = [];
      }
      try {
        previousTiktokVideoIds = await getVideoIdsTodayByClient(targetId);
      } catch (err) {
        console.error("Error reading previous TikTok video IDs:", err);
        previousTiktokVideoIds = [];
      }

      try {
        await fetchAndStoreInstaContent(
          ["shortcode", "caption", "like_count", "timestamp"],
          waClient,
          chatId,
          targetId
        );
      } catch (err) {
        console.error("Error fetching Instagram content:", err);
        fetchErrors.push("Instagram content");
      }
      try {
        await handleFetchLikesInstagram(null, null, targetId);
      } catch (err) {
        console.error("Error fetching Instagram likes:", err);
        fetchErrors.push("Instagram likes");
      }
      try {
        await fetchAndStoreTiktokContent(targetId, waClient, chatId);
      } catch (err) {
        console.error("Error fetching TikTok content:", err);
        fetchErrors.push("TikTok content");
      }
      try {
        await handleFetchKomentarTiktokBatch(null, null, targetId);
      } catch (err) {
        console.error("Error fetching TikTok comments:", err);
        fetchErrors.push("TikTok comments");
      }
      const previousState = {
        igShortcodes: Array.isArray(previousIgShortcodes)
          ? previousIgShortcodes
          : [],
        tiktokVideoIds: Array.isArray(previousTiktokVideoIds)
          ? previousTiktokVideoIds
          : [],
      };
      try {
        ({ text: msg } = await generateSosmedTaskMessage(targetId, {
          skipTiktokFetch: true,
          skipLikesFetch: true,
          previousState,
        }));
      } catch (err) {
        console.error("Error generating sosmed task message:", err);
        msg = "Gagal membuat pesan tugas.";
        fetchErrors.push("task message");
      }
      if (fetchErrors.length) {
        msg = `${msg}\n\n⚠️ Sebagian data gagal diambil.`.trim();
      }
      break;
    }
    case "17": {
        const { text, filename, narrative, textBelum, filenameBelum } = await lapharDitbinmas();
        const dirPath = "laphar";
        await mkdir(dirPath, { recursive: true });
        if (narrative) {
          await sendMenuMessage(waClient, chatId, narrative.trim(), fallbackPayload);
        }
        if (text && filename) {
          const buffer = Buffer.from(text, "utf-8");
          const filePath = join(dirPath, filename);
          await writeFile(filePath, buffer);
          await sendWAFile(waClient, buffer, filename, chatId, "text/plain");
        }
        if (textBelum && filenameBelum) {
          const bufferBelum = Buffer.from(textBelum, "utf-8");
          const filePathBelum = join(dirPath, filenameBelum);
          await writeFile(filePathBelum, bufferBelum);
          await sendWAFile(waClient, bufferBelum, filenameBelum, chatId, "text/plain");
        }
        const recapData = await collectLikesRecap(clientId);
        if (recapData.shortcodes.length) {
          const excelPath = await saveLikesRecapExcel(recapData, clientId);
          const bufferExcel = await readFile(excelPath);
          await sendWAFile(waClient, bufferExcel, basename(excelPath), chatId, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          await unlink(excelPath);
        }
        return;
      }
      case "18": {
        const { text, filename, narrative, textBelum, filenameBelum } = await lapharTiktokDitbinmas();
        const dirPath = "laphar";
        await mkdir(dirPath, { recursive: true });
        if (narrative) {
          await sendMenuMessage(waClient, chatId, narrative.trim(), fallbackPayload);
        }
        if (text && filename) {
          const buffer = Buffer.from(text, "utf-8");
          const filePath = join(dirPath, filename);
          await writeFile(filePath, buffer);
          await sendWAFile(waClient, buffer, filename, chatId, "text/plain");
        }
        if (textBelum && filenameBelum) {
          const bufferBelum = Buffer.from(textBelum, "utf-8");
          const filePathBelum = join(dirPath, filenameBelum);
          await writeFile(filePathBelum, bufferBelum);
          await sendWAFile(waClient, bufferBelum, filenameBelum, chatId, "text/plain");
        }
        const recapData = await collectKomentarRecap(clientId);
        if (recapData.videoIds.length) {
          const excelPath = await saveCommentRecapExcel(recapData, clientId);
          const bufferExcel = await readFile(excelPath);
          await sendWAFile(waClient, bufferExcel, basename(excelPath), chatId, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          await unlink(excelPath);
        }
        return;
      }
      case "19": {
        let filePath;
        try {
          const data = await collectLikesRecap(clientId);
          if (typeof data === "string") {
            msg = data;
            break;
          }
          if (!data.shortcodes.length) {
            msg = `Tidak ada konten IG untuk *${clientId}* hari ini.`;
            break;
          }
          try {
            filePath = await saveLikesRecapExcel(data, clientId);
          } catch (error) {
            console.error("Gagal membuat rekap likes Instagram (Excel):", error);
            msg =
              "❌ Gagal membuat rekap likes Instagram (Excel). Workbook kosong atau data tidak valid.";
            break;
          }
          let buffer;
          try {
            buffer = await readFile(filePath);
          } catch (error) {
            console.error("Gagal membaca file rekap likes Instagram (Excel):", error);
            msg = "❌ Gagal membaca file rekap likes Instagram (Excel).";
            break;
          }
          try {
            await sendWAFile(
              waClient,
              buffer,
              basename(filePath),
              chatId,
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            msg = "✅ File Excel dikirim.";
          } catch (error) {
            console.error("Gagal mengirim rekap likes Instagram (Excel):", error);
            msg =
              "❌ Gagal mengirim rekap likes Instagram (Excel). Silakan coba lagi.";
          }
        } finally {
          if (filePath) {
            try {
              await stat(filePath);
              await unlink(filePath);
            } catch (error) {
              if (error?.code !== "ENOENT") {
                console.error("Gagal menghapus file sementara:", error);
              }
            }
          }
        }
        break;
      }
      case "20": {
        let filePath;
        try {
          const recapData = await collectKomentarRecap(clientId);
          if (!recapData?.videoIds?.length) {
            msg = `Tidak ada konten TikTok untuk *${clientId}* hari ini.`;
            break;
          }
          try {
            filePath = await saveCommentRecapExcel(recapData, clientId);
            const buffer = await readFile(filePath);
            await sendWAFile(
              waClient,
              buffer,
              basename(filePath),
              chatId,
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            msg = "✅ File Excel dikirim.";
          } catch (error) {
            console.error("Gagal mengirim rekap komentar TikTok (Excel):", error);
            msg =
              "❌ Gagal mengirim rekap komentar TikTok (Excel). Silakan coba lagi.";
          }
        } catch (error) {
          console.error("Gagal menyiapkan rekap komentar TikTok:", error);
          msg =
            "❌ Gagal mengambil data komentar TikTok untuk rekap. Silakan coba lagi.";
        } finally {
          if (filePath) {
            try {
              await unlink(filePath);
            } catch (err) {
              console.error("Gagal menghapus file sementara:", err);
            }
          }
        }
        break;
      }
      case "21": {
        const dirPath = "laphar";
        const tempFiles = [];
        try {
          await mkdir(dirPath, { recursive: true });
          const [ig, tt] = await Promise.all([
            lapharDitbinmas(clientId),
            lapharTiktokDitbinmas(clientId),
          ]);
          const client = await findClientById(clientId);
          const clientName = client?.nama || clientId;
          const narrative = await formatRekapAllSosmed(
            ig.narrative,
            tt.narrative,
            clientName,
            clientId,
            {
              igRankingData: ig.rankingData,
              ttRankingData: tt.rankingData,
            }
          );
          if (narrative) {
            await sendMenuMessage(waClient, chatId, narrative, fallbackPayload);
          }
          if (ig.text && ig.filename) {
            const buffer = Buffer.from(ig.text, "utf-8");
            const filePath = join(dirPath, ig.filename);
            tempFiles.push(filePath);
            await writeFile(filePath, buffer);
            await sendWAFile(waClient, buffer, ig.filename, chatId, "text/plain");
          }
          const igRecap = await collectLikesRecap(clientId);
          if (typeof igRecap === "string") {
            await sendMenuMessage(waClient, chatId, igRecap, fallbackPayload);
          } else if (igRecap?.shortcodes?.length) {
            const excelPath = await saveLikesRecapExcel(igRecap, clientId);
            tempFiles.push(excelPath);
            const bufferExcel = await readFile(excelPath);
            await sendWAFile(
              waClient,
              bufferExcel,
              basename(excelPath),
              chatId,
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
          }
          if (tt.text && tt.filename) {
            const buffer = Buffer.from(tt.text, "utf-8");
            const filePath = join(dirPath, tt.filename);
            tempFiles.push(filePath);
            await writeFile(filePath, buffer);
            await sendWAFile(waClient, buffer, tt.filename, chatId, "text/plain");
          }
          let ttRecap;
          try {
            ttRecap = await collectKomentarRecap(clientId);
          } catch (error) {
            console.error("Gagal menyiapkan rekap komentar TikTok:", error);
            await sendMenuMessage(
              waClient,
              chatId,
              "❌ Gagal menyiapkan rekap komentar TikTok. Silakan coba lagi.",
              fallbackPayload
            );
            return;
          }
          if (ttRecap?.videoIds?.length) {
            const excelPath = await saveCommentRecapExcel(ttRecap, clientId);
            tempFiles.push(excelPath);
            const bufferExcel = await readFile(excelPath);
            await sendWAFile(
              waClient,
              bufferExcel,
              basename(excelPath),
              chatId,
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
          }
        } catch (error) {
          console.error("Gagal memproses menu 21:", error);
          await sendMenuMessage(
            waClient,
            chatId,
            "❌ Terjadi kendala saat memproses menu 21. Silakan coba lagi nanti. Kembali ke menu utama.",
            fallbackPayload
          );
        } finally {
          await Promise.all(
            tempFiles.map(async (filePath) => {
              try {
                await unlink(filePath);
              } catch (err) {
                console.error("Gagal menghapus file sementara:", err);
              }
            })
          );
        }
        return;
      }
      case "22": {
        let filePath;
        const period = context?.period || "today";
        const periodEntry = Object.values(ENGAGEMENT_RECAP_PERIOD_MAP).find(
          (entry) => entry.period === period
        );
        const periodLabel = periodEntry?.label || period;

        try {
          const { filePath: generatedPath } = await saveEngagementRankingExcel({
            clientId,
            roleFlag,
            period,
          });
          filePath = generatedPath;
          const buffer = await readFile(filePath);
          await sendWAFile(
            waClient,
            buffer,
            basename(filePath),
            chatId,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          );
          msg = `✅ File Excel rekap ranking engagement (${periodLabel}) dikirim.`;
        } catch (error) {
          console.error("Gagal membuat rekap ranking engagement:", error);
          if (
            error?.message &&
            (error.message.includes("direktorat") ||
              error.message.includes("Client tidak ditemukan") ||
              error.message.includes("Tidak ada data"))
          ) {
            msg = error.message;
          } else {
            msg = `❌ Gagal membuat rekap ranking engagement (${periodLabel}).`;
          }
        } finally {
          if (filePath) {
            try {
              await unlink(filePath);
            } catch (err) {
              console.error("Gagal menghapus file sementara:", err);
            }
          }
        }
        break;
      }
      case "23": {
        let filePath;
        try {
          filePath = await saveWeeklyLikesRecapExcel(clientId);
          if (!filePath) {
            msg = "Tidak ada data.";
            break;
          }
          const buffer = await readFile(filePath);
          await sendWAFile(waClient, buffer, basename(filePath), chatId, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          msg = "✅ File Excel dikirim.";
        } catch (error) {
          console.error("Gagal mengirim file Excel:", error);
          msg = "❌ Gagal mengirim file Excel.";
        } finally {
          if (filePath) {
            try {
              await unlink(filePath);
            } catch (err) {
              console.error("Gagal menghapus file sementara:", err);
            }
          }
        }
        break;
      }
      case "24": {
        let filePath;
        try {
          filePath = await saveWeeklyCommentRecapExcel(clientId);
          if (!filePath) {
            msg = "Tidak ada data.";
            break;
          }
          const buffer = await readFile(filePath);
          await sendWAFile(waClient, buffer, basename(filePath), chatId, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          msg = "✅ File Excel dikirim.";
        } catch (error) {
          console.error("Gagal mengirim file Excel:", error);
          msg = "❌ Gagal mengirim file Excel.";
        } finally {
          if (filePath) {
            try {
              await unlink(filePath);
            } catch (err) {
              console.error("Gagal menghapus file sementara:", err);
            }
          }
        }
        break;
      }
      case "25": {
        try {
          msg = await generateWeeklyTiktokHighLowReport(clientId, { roleFlag });
        } catch (error) {
          console.error("Gagal membuat laporan TikTok Top and Bottom:", error);
          msg =
            error?.message &&
            (error.message.includes("data") ||
              error.message.includes("clientId"))
              ? error.message
              : "❌ Gagal membuat laporan TikTok Top and Bottom.";
        }
        break;
      }
      case "26": {
        if (!isDitbinmas(clientId) || !isDitbinmas(roleFlag)) {
          msg =
            "Menu Instagram Top and Bottom hanya tersedia untuk pengguna DITBINMAS.";
          break;
        }
        try {
          msg = await generateWeeklyInstagramHighLowReport(clientId, { roleFlag });
        } catch (error) {
          console.error("Gagal membuat laporan Instagram Top and Bottom:", error);
          msg =
            error?.message &&
            (error.message.includes("data") ||
              error.message.includes("clientId") ||
              error.message.includes("DITBINMAS"))
              ? error.message
              : "❌ Gagal membuat laporan Instagram Top and Bottom.";
        }
        break;
      }
      case "27": {
        let filePath;
        try {
          filePath = await saveMonthlyLikesRecapExcel(clientId);
          if (!filePath) {
            msg = "Tidak ada data.";
            break;
          }
          const buffer = await readFile(filePath);
          await sendWAFile(waClient, buffer, basename(filePath), chatId, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          msg = "✅ File Excel dikirim.";
        } catch (error) {
          console.error("Gagal mengirim file Excel:", error);
          msg = "❌ Gagal mengirim file Excel.";
        } finally {
          if (filePath) {
            try {
              await unlink(filePath);
            } catch (err) {
              console.error("Gagal menghapus file sementara:", err);
            }
          }
        }
        break;
      }
      case "28": {
        const data = await collectLikesRecap(clientId);
        if (typeof data === "string") {
          msg = data;
          break;
        }
        if (!data.shortcodes.length) {
          msg = `Tidak ada konten IG untuk *${clientId}* hari ini.`;
          break;
        }
        const filePath = await saveLikesRecapPerContentExcel(data, clientId);
        const buffer = await readFile(filePath);
        await sendWAFile(
          waClient,
          buffer,
          basename(filePath),
          chatId,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        await unlink(filePath);
        msg = "✅ File Excel dikirim.";
        break;
      }
      case "29": {
        const recapData = await collectKomentarRecap(clientId);
        if (!recapData?.videoIds?.length) {
          msg = `Tidak ada konten TikTok untuk *${clientId}* hari ini.`;
          break;
        }
        const filePath = await saveCommentRecapPerContentExcel(recapData, clientId);
        const buffer = await readFile(filePath);
        await sendWAFile(
          waClient,
          buffer,
          basename(filePath),
          chatId,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        await unlink(filePath);
        msg = "✅ File Excel dikirim.";
        break;
      }
      case "30": {
        try {
          const period = context?.period || "today";
          msg = await generateKasatkerReport({
            clientId,
            roleFlag,
            period,
          });
        } catch (error) {
          console.error("Gagal membuat Laporan Kasatker:", error);
          const suffix = context?.period ? ` (${context.period})` : "";
          msg =
            error?.message &&
            (error.message.includes("direktorat") ||
              error.message.includes("Client tidak ditemukan") ||
              error.message.includes("Tidak ada data"))
              ? error.message
              : `❌ Gagal membuat Laporan Kasatker${suffix}.`;
        }
        break;
      }
      case "31": {
        try {
          msg = await formatTopPersonnelRanking(clientId, roleFlag);
        } catch (error) {
          console.error(
            "Gagal membuat ranking like/komentar personel:",
            error
          );
          msg = "❌ Gagal membuat ranking like/komentar personel.";
        }
        break;
      }
      case "32": {
        try {
          msg = await formatTopPolresRanking(clientId, roleFlag);
        } catch (error) {
          console.error(
            "Gagal membuat ranking like/komentar polres:",
            error
          );
          msg = "❌ Gagal membuat ranking like/komentar polres.";
        }
        break;
      }
      case "34": {
        try {
          const period = context?.period || "daily";
          msg = await generateKasatBinmasLikesRecap({ period });
        } catch (error) {
          console.error(
            "Gagal membuat rekap Absensi Likes Kasat Binmas:",
            error
          );
          const suffix = context?.period ? ` (${context.period})` : "";
          msg =
            error?.message &&
            (error.message.includes("direktorat") ||
              error.message.includes("Client tidak ditemukan") ||
              error.message.includes("Tidak ada data"))
              ? error.message
              : `❌ Gagal membuat rekap Absensi Likes Kasat Binmas${suffix}.`;
        }
        break;
      }
      case "35": {
        try {
          const period = context?.period || "daily";
          const referenceDate = context?.referenceDate;
          const normalizedReferenceDate =
            referenceDate !== undefined && referenceDate !== null
              ? resolveBaseDate(referenceDate)
              : undefined;
          msg = await generateKasatBinmasTiktokCommentRecap({
            period,
            referenceDate: normalizedReferenceDate,
          });
        } catch (error) {
          console.error(
            "Gagal membuat rekap Absensi Komentar TikTok Kasat Binmas:",
            error,
          );
          const suffix = context?.period ? ` (${context.period})` : "";
          msg =
            error?.message &&
            (error.message.includes("direktorat") ||
              error.message.includes("Client tidak ditemukan") ||
              error.message.includes("Tidak ada data"))
              ? error.message
              : `❌ Gagal membuat rekap Absensi Komentar TikTok Kasat Binmas${suffix}.`;
        }
        break;
      }
      case "44": {
        try {
          const period = context?.period || "daily";
          const referenceDate = context?.referenceDate;
          const normalizedReferenceDate =
            referenceDate !== undefined && referenceDate !== null
              ? resolveBaseDate(referenceDate)
              : undefined;
          await sendKasatBinmasLikesRecapExcel({
            period,
            referenceDate: normalizedReferenceDate,
            chatId,
            waClient,
          });
        } catch (error) {
          console.error(
            "[submenu 44] Gagal mengirim rekap Likes Kasat Binmas (Excel) via performAction:",
            error
          );
          msg = "❌ Gagal mengirim rekap Likes Kasat Binmas (Excel).";
        }
        break;
      }
      case "42": {
        try {
          const client = await findClientById(clientId);
          const { filePath } = await generateInstagramAllDataRecap({
            clientId,
            roleFlag,
            clientName: client?.nama || clientId,
          });
          const buffer = await readFile(filePath);
          await sendWAFile(
            waClient,
            buffer,
            basename(filePath),
            chatId,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          );
          await unlink(filePath);
          msg = "✅ File Excel Instagram all data dikirim.";
        } catch (error) {
          console.error("Gagal membuat rekap Instagram all data:", error);
          msg =
            error?.message &&
            (error.message.includes("Tidak ada data") ||
              error.message.includes("Client tidak ditemukan"))
              ? error.message
              : "❌ Gagal membuat rekap Instagram all data.";
        }
        break;
      }
      case "43": {
        try {
          const client = await findClientById(clientId);
          const { filePath } = await generateTiktokAllDataRecap({
            clientId,
            roleFlag,
            clientName: client?.nama || clientId,
          });
          const buffer = await readFile(filePath);
          await sendWAFile(
            waClient,
            buffer,
            basename(filePath),
            chatId,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          );
          await unlink(filePath);
          msg = "✅ File Excel TikTok all data dikirim.";
        } catch (error) {
          console.error("Gagal membuat rekap TikTok all data:", error);
          msg =
            error?.message &&
            (error.message.includes("Tidak ada data") ||
              error.message.includes("Client tidak ditemukan"))
              ? error.message
              : "❌ Gagal membuat rekap TikTok all data.";
        }
        break;
      }
      default:
        msg = "Menu tidak dikenal.";
  }
  const normalizedMsg = typeof msg === "string" ? msg.trim() : "";
  if (!normalizedMsg) {
    return;
  }

  await sendMenuMessage(waClient, chatId, normalizedMsg, fallbackPayload);
  if (action === "12" || action === "14" || action === "16") {
    if (Array.isArray(fallbackClients) && fallbackClients.length) {
      await sendWithClientFallback({
        chatId: dirRequestGroup,
        message: normalizedMsg,
        clients: fallbackClients,
        reportClient: waClient,
        reportContext: fallbackContext,
      });
    } else {
      await safeSendMessage(waClient, dirRequestGroup, normalizedMsg);
    }
  }
}

export async function runDirRequestAction({
  action,
  clientId,
  chatId,
  roleFlag,
  userClientId,
  waClient,
  context,
  fallbackClients,
  fallbackContext,
} = {}) {
  if (!action) {
    throw new Error("Action menu wajib diisi");
  }
  if (!waClient) {
    throw new Error("Instans WA client wajib diisi untuk menjalankan menu");
  }
  if (!chatId) {
    throw new Error("chatId penerima wajib diisi untuk menjalankan menu");
  }

  const normalizedAction = String(action).trim();
  const normalizedClient = (clientId || "").trim();
  const resolvedFallbackContext = fallbackContext || {
    action: normalizedAction,
    clientId: normalizedClient,
    chatId,
  };

  return performAction(
    normalizedAction,
    normalizedClient,
    waClient,
    chatId,
    roleFlag,
    userClientId,
    context,
    {
      fallbackClients,
      fallbackContext: resolvedFallbackContext,
    }
  );
}

export const dirRequestHandlers = {
  async choose_dash_user(session, chatId, _text, waClient) {
    const dashUsers = session.dash_users || [];
    const chosen = dashUsers[0];
    if (!chosen) {
      await waClient.sendMessage(
        chatId,
        "❌ Data dashboard user tidak ditemukan untuk akses dirrequest."
      );
      return;
    }
    session.role = chosen.role;
    session.username = chosen.username || session.username;
    delete session.dash_users;
    session.step = "choose_client";
    await dirRequestHandlers.choose_client(session, chatId, "", waClient);
  },

  async main(session, chatId, _text, waClient) {
    const availableClients = session.dir_clients || [];
    if (!session.selectedClientId && availableClients.length) {
      session.step = "choose_client";
      await dirRequestHandlers.choose_client(session, chatId, "", waClient);
      return;
    }

    const selectedClientId =
      (session.dir_client_id || session.selectedClientId || DITBINMAS_CLIENT_ID).toUpperCase();
    session.client_ids = [selectedClientId];
    session.selectedClientId = selectedClientId;
    session.dir_client_id = selectedClientId;

    const clientChanged = session.clientNameId !== selectedClientId;
    if (!session.clientName || clientChanged) {
      try {
        const client = await findClientById(selectedClientId);
        session.clientName = client?.nama || selectedClientId;
      } catch {
        session.clientName = selectedClientId;
      }
      session.clientNameId = selectedClientId;
    }

    const clientName = session.clientName;
    const menu =
      `Client: *${clientName}*\n` +
      "┏━━━━━━━━━━━━ *MENU DIRREQUEST* ━━━━━━━━━━━━\n" +
        "📊 *Rekap Data*\n" +
        "1️⃣ Rekap Kelengkapan data Personil Satker.\n" +
        "2️⃣ Ringkasan pengisian data personel\n" +
        "3️⃣ Rekap data personil\n" +
        "4️⃣ Rekap Matriks Update Satker\n\n" +
        "📅 *Absensi*\n" +
        "5️⃣ Absensi like Direktorat/Bidang\n" +
        "6️⃣ Absensi like Direktorat/Bidang Simple\n" +
        "7️⃣ Absensi like Instagram\n" +
        "8️⃣ Absensi komentar TikTok\n" +
        "9️⃣ Absensi komentar Direktorat/Bidang Simple\n" +
        "1️⃣0️⃣ Absensi komentar Direktorat/Bidang\n" +
        "1️⃣1️⃣ Absensi user web dashboard Direktorat/Bidang\n\n" +
        "📥 *Pengambilan Data*\n" +
        "1️⃣2️⃣ Ambil konten & like Instagram\n" +
        "1️⃣3️⃣ Ambil like Instagram saja\n" +
        "1️⃣4️⃣ Ambil konten & komentar TikTok\n" +
        "1️⃣5️⃣ Ambil komentar TikTok saja\n" +
        "1️⃣6️⃣ Ambil semua sosmed & buat tugas\n\n" +
        "📝 *Laporan*\n" +
        "1️⃣7️⃣ Laporan harian Instagram Direktorat/Bidang\n" +
        "1️⃣8️⃣ Laporan harian TikTok Direktorat/Bidang\n" +
        "1️⃣9️⃣ Rekap like Instagram (Excel)\n" +
        "2️⃣0️⃣ Rekap komentar TikTok (Excel)\n" +
        "2️⃣1️⃣ Rekap gabungan semua sosmed\n" +
        "2️⃣2️⃣ Rekap ranking engagement jajaran\n\n" +
        "📆 *Laporan Mingguan*\n" +
        "2️⃣3️⃣ Rekap file Instagram mingguan\n" +
        "2️⃣4️⃣ Rekap file Tiktok mingguan\n" +
        "2️⃣5️⃣ TikTok Top and Bottom (Top 5 & Bottom 5)\n" +
        "2️⃣6️⃣ Instagram Top and Bottom (Top 5 & Bottom 5)\n\n" +
        "🗓️ *Laporan Bulanan*\n" +
        "2️⃣7️⃣ Rekap file Instagram bulanan\n" +
        "2️⃣8️⃣ Rekap like Instagram per konten (Excel)\n" +
        "2️⃣9️⃣ Rekap komentar TikTok per konten (Excel)\n\n" +
        "📦 *Rekap All Data*\n" +
        "4️⃣2️⃣ Instagram all data\n" +
        "4️⃣3️⃣ TikTok all data\n\n" +
        "🛡️ *Monitoring Kasatker*\n" +
        "3️⃣0️⃣ Laporan Kasatker\n" +
        "3️⃣1️⃣ Top ranking like/komentar personel\n" +
        "3️⃣2️⃣ Top ranking like/komentar polres tertinggi\n" +
        "3️⃣3️⃣ Absensi Kasatker\n" +
        "3️⃣4️⃣ Absensi likes Instagram Kasat Binmas\n" +
        "3️⃣5️⃣ Absensi komentar TikTok Kasat Binmas\n" +
        "4️⃣4️⃣ Rekap likes Instagram Kasat Binmas (Excel)\n" +
        "4️⃣5️⃣ Rekap komentar TikTok Kasat Binmas (Excel)\n\n" +
        "📡 *Monitoring Satbinmas Official*\n" +
        "3️⃣6️⃣ Ambil metadata harian IG Satbinmas Official\n" +
        "3️⃣7️⃣ Ambil konten harian IG Satbinmas Official (semua akun ORG)\n" +
        "3️⃣8️⃣ Sinkronisasi secUid TikTok Satbinmas Official\n" +
        "3️⃣9️⃣ Ambil konten harian TikTok Satbinmas Official (semua akun ORG)\n" +
        "4️⃣0️⃣ Rekap Instagram Satbinmas Official\n" +
        "4️⃣1️⃣ Rekap TikTok Satbinmas Official\n\n" +
        "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n" +
        "Ketik *angka* menu atau *batal* untuk keluar.";
    await waClient.sendMessage(chatId, menu);
    session.step = "choose_menu";
  },

  async choose_client(session, chatId, text, waClient) {
    // If selected_client_id is already set (operator/super admin direct access)
    // and no dir_clients list is provided, proceed directly to main menu
    if (session.selected_client_id && (!session.dir_clients || session.dir_clients.length === 0)) {
      const clientId = session.selected_client_id.toUpperCase();
      session.selectedClientId = clientId;
      session.dir_client_id = clientId;
      session.client_ids = [clientId];
      try {
        const client = await findClientById(clientId);
        session.clientName = client?.nama || clientId;
      } catch (error) {
        // Log error but continue with client ID as fallback name
        console.error(`Failed to fetch client details for ${clientId}:`, error.message);
        session.clientName = clientId;
      }
      session.clientNameId = clientId;
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const clients = session.dir_clients || [];
    const choiceList = clients
      .map((client, idx) => {
        const numberLabel = DIGIT_EMOJI[String(idx + 1)] || `${idx + 1}`;
        const nameLabel = client.nama ? ` - ${client.nama}` : "";
        return `${numberLabel} ${client.client_id}${nameLabel}`;
      })
      .join("\n");

    const prompt =
      "Pilih *Client ID* Direktorat aktif sebelum membuka menu dirrequest:\n" +
      (choiceList || "(Belum ada data client Direktorat aktif)") +
      "\n\nBalas *angka* atau *Client ID* yang tertera, atau ketik *batal* untuk keluar.";

    const input = (text || "").trim();

    if (!clients.length) {
      session.selectedClientId = DITBINMAS_CLIENT_ID;
      session.dir_client_id = DITBINMAS_CLIENT_ID;
      session.client_ids = [DITBINMAS_CLIENT_ID];
      try {
        const client = await findClientById(DITBINMAS_CLIENT_ID);
        session.clientName = client?.nama || DITBINMAS_CLIENT_ID;
      } catch {
        session.clientName = DITBINMAS_CLIENT_ID;
      }
      session.clientNameId = DITBINMAS_CLIENT_ID;
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    if (!input) {
      await waClient.sendMessage(chatId, prompt);
      return;
    }

    if (input.toLowerCase() === "batal") {
      session.menu = null;
      session.step = null;
      await waClient.sendMessage(chatId, "✅ Menu dirrequest ditutup.");
      return;
    }

    const normalizedInput = input.toUpperCase();
    let selectedClient = null;

    if (/^\d+$/.test(normalizedInput)) {
      const index = Number(normalizedInput) - 1;
      if (clients[index]) {
        selectedClient = clients[index];
      }
    }

    if (!selectedClient) {
      selectedClient = clients.find(
        (client) => client.client_id?.toUpperCase() === normalizedInput
      );
    }

    if (!selectedClient) {
      await waClient.sendMessage(
        chatId,
        "❌ Pilihan client tidak valid. Silakan pilih sesuai daftar."
      );
      await waClient.sendMessage(chatId, prompt);
      return;
    }

    const normalizedClientId = (selectedClient.client_id || "").toUpperCase();
    session.selectedClientId = normalizedClientId;
    session.dir_client_id = normalizedClientId;
    session.client_ids = [normalizedClientId];
    session.clientName = selectedClient.nama || normalizedClientId;
    session.clientNameId = normalizedClientId;
    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_menu(session, chatId, text, waClient) {
    const choice = text.trim();
    if (
        ![
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "10",
          "11",
          "12",
          "13",
          "14",
          "15",
          "16",
          "17",
          "18",
          "19",
          "20",
          "21",
          "22",
          "23",
          "24",
          "25",
          "26",
          "27",
          "28",
          "29",
          "30",
          "31",
          "32",
          "33",
          "34",
          "35",
          "36",
          "37",
          "38",
          "39",
          "40",
          "41",
          "42",
          "43",
          "44",
          "45",
        ].includes(choice)
    ) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Ketik angka menu.");
      return;
    }
    const userClientId = session.selectedClientId;
    if (!userClientId) {
      await waClient.sendMessage(chatId, "Client belum dipilih.");
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }
    const taskClientId = session.dir_client_id || userClientId;

    if (choice === "3") {
      session.step = "choose_rekap_personil_category";
      await waClient.sendMessage(chatId, REKAP_PERSONIL_MENU_TEXT);
      return;
    }

    if (choice === "22") {
      session.step = "choose_engagement_recap_period";
      await waClient.sendMessage(chatId, ENGAGEMENT_RECAP_MENU_TEXT);
      return;
    }

    if (choice === "30") {
      session.step = "choose_kasatker_report_period";
      await waClient.sendMessage(chatId, KASATKER_REPORT_MENU_TEXT);
      return;
    }

    if (choice === "33") {
      session.step = "choose_kasatker_attendance";
      await dirRequestHandlers.choose_kasatker_attendance(session, chatId, "", waClient);
      return;
    }

    if (choice === "34") {
      session.step = "choose_kasat_binmas_likes_period";
      await waClient.sendMessage(chatId, KASAT_BINMAS_LIKES_MENU_TEXT);
      return;
    }

    if (choice === "35") {
      session.step = "choose_kasat_binmas_tiktok_comment_period";
      await waClient.sendMessage(chatId, KASAT_BINMAS_TIKTOK_COMMENT_MENU_TEXT);
      return;
    }

    if (choice === "44") {
      session.step = "choose_kasat_binmas_likes_excel_period";
      await waClient.sendMessage(chatId, KASAT_BINMAS_LIKES_EXCEL_MENU_TEXT);
      return;
    }

    if (choice === "45") {
      session.step = "choose_kasat_binmas_tiktok_comment_excel_period";
      await waClient.sendMessage(chatId, KASAT_BINMAS_TIKTOK_COMMENT_EXCEL_MENU_TEXT);
      return;
    }

    if (choice === "36") {
      session.step = "fetch_satbinmas_official_metadata";
      await dirRequestHandlers.fetch_satbinmas_official_metadata(
        session,
        chatId,
        "",
        waClient
      );
      return;
    }

    if (choice === "37") {
      session.step = "fetch_satbinmas_official_media";
      await dirRequestHandlers.fetch_satbinmas_official_media(
        session,
        chatId,
        "",
        waClient
      );
      return;
    }

    if (choice === "38") {
      session.step = "resolve_satbinmas_official_tiktok_secuid";
      await dirRequestHandlers.resolve_satbinmas_official_tiktok_secuid(
        session,
        chatId,
        "",
        waClient
      );
      return;
    }

    if (choice === "39") {
      session.step = "fetch_satbinmas_official_tiktok_media";
      await dirRequestHandlers.fetch_satbinmas_official_tiktok_media(
        session,
        chatId,
        "",
        waClient
      );
      return;
    }

    if (choice === "40") {
      session.step = "choose_satbinmas_official_instagram_recap_period";
      await waClient.sendMessage(chatId, SATBINMAS_OFFICIAL_INSTAGRAM_RECAP_MENU_TEXT);
      return;
    }

    if (choice === "41") {
      session.step = "choose_satbinmas_official_tiktok_recap_period";
      await waClient.sendMessage(chatId, SATBINMAS_OFFICIAL_TIKTOK_RECAP_MENU_TEXT);
      return;
    }

    await performAction(
      choice,
      taskClientId,
      waClient,
      chatId,
      session.role,
      userClientId,
      { username: session.username || session.user?.username }
    );
    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_engagement_recap_period(session, chatId, text, waClient) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, ENGAGEMENT_RECAP_MENU_TEXT);
      return;
    }

    if (input.toLowerCase() === "batal") {
      await waClient.sendMessage(chatId, "✅ Menu rekap ranking engagement ditutup.");
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = ENGAGEMENT_RECAP_PERIOD_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 6 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, ENGAGEMENT_RECAP_MENU_TEXT);
      return;
    }

    const targetClientId = session.dir_client_id || session.selectedClientId || DITBINMAS_CLIENT_ID;
    const roleFlag = session.role;
    let filePath;
    try {
      const { filePath: generatedPath } = await saveEngagementRankingExcel({
        clientId: targetClientId,
        roleFlag,
        period: option.period,
      });
      filePath = generatedPath;
      const buffer = await readFile(filePath);
      await sendWAFile(
        waClient,
        buffer,
        basename(filePath),
        chatId,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      await waClient.sendMessage(
        chatId,
        `✅ File Excel rekap ranking engagement (${option.label}) dikirim.`
      );
    } catch (error) {
      console.error("Gagal membuat rekap ranking engagement:", error);
      let msg;
      if (
        error?.message &&
        (error.message.includes("direktorat") ||
          error.message.includes("Client tidak ditemukan") ||
          error.message.includes("Tidak ada data"))
      ) {
        msg = error.message;
      } else {
        msg = `❌ Gagal membuat rekap ranking engagement (${option.label}).`;
      }
      await waClient.sendMessage(chatId, msg);
    } finally {
      if (filePath) {
        try {
          await unlink(filePath);
        } catch (err) {
          console.error("Gagal menghapus file sementara:", err);
        }
      }
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_rekap_personil_category(session, chatId, text, waClient) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, REKAP_PERSONIL_MENU_TEXT);
      return;
    }

    if (input.toLowerCase() === "batal") {
      await waClient.sendMessage(chatId, "✅ Menu rekap data personil ditutup.");
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = REKAP_PERSONIL_CATEGORY_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 4 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, REKAP_PERSONIL_MENU_TEXT);
      return;
    }

    const targetClientId = session.dir_client_id || session.selectedClientId || DITBINMAS_CLIENT_ID;
    
    try {
      const msg = await formatRekapDataPersonil(targetClientId, option.category);
      if (msg) {
        await waClient.sendMessage(chatId, msg);
      } else {
        await waClient.sendMessage(
          chatId,
          "❌ Tidak ada data untuk kategori yang dipilih."
        );
      }
    } catch (error) {
      console.error("Gagal membuat rekap data personil:", error);
      let errorMsg;
      if (
        error?.message &&
        (error.message.includes("direktorat") ||
          error.message.includes("Client tidak ditemukan"))
      ) {
        errorMsg = error.message;
      } else {
        errorMsg = `❌ Gagal membuat rekap data personil kategori ${option.description}.`;
      }
      await waClient.sendMessage(chatId, errorMsg);
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async fetch_satbinmas_official_metadata(session, chatId, text, waClient) {
    const defaultClientId =
      session.dir_client_id || session.selectedClientId || DITBINMAS_CLIENT_ID;
    const rawInput = (text || "").trim();

    const formatNumber = (value) => {
      if (value == null) return null;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      return numeric.toLocaleString("id-ID", { maximumFractionDigits: 0 });
    };

    if (!rawInput) {
      await waClient.sendMessage(
        chatId,
        SATBINMAS_OFFICIAL_METADATA_PROMPT(defaultClientId)
      );
      return;
    }

    if (rawInput.toLowerCase() === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Menu Monitoring Satbinmas Official ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const tokens = rawInput.split(/\s+/);
    const guessedClientId =
      tokens.length >= 2 && /^[A-Za-z0-9_-]{2,}$/u.test(tokens[0])
        ? tokens.shift()
        : defaultClientId;
    const usernamePart = tokens.join(" ") || rawInput;
    const normalizedClientId = (guessedClientId || defaultClientId).toUpperCase();
    const username = usernamePart.replace(/^@/, "").trim();

    if (!username) {
      await waClient.sendMessage(
        chatId,
        "❌ Username Instagram Satbinmas Official belum diisi."
      );
      await waClient.sendMessage(
        chatId,
        SATBINMAS_OFFICIAL_METADATA_PROMPT(normalizedClientId)
      );
      return;
    }

    const usernamePattern = /^[A-Za-z0-9._]{2,}$/u;
    if (!usernamePattern.test(username)) {
      await waClient.sendMessage(
        chatId,
        "❌ Format username tidak valid. Gunakan huruf, angka, titik, atau underscore tanpa spasi."
      );
      await waClient.sendMessage(
        chatId,
        SATBINMAS_OFFICIAL_METADATA_PROMPT(normalizedClientId)
      );
      return;
    }

    try {
      const profile = await fetchInstagramInfo(username);
      if (!profile) {
        await waClient.sendMessage(
          chatId,
          `❌ Metadata tidak ditemukan untuk @${username}.`
        );
      } else {
        const profileName =
          profile.full_name || profile.fullName || profile.username || username;
        const followers =
          profile.followers_count ?? profile.follower_count ?? profile.follower;
        const following = profile.following_count;
        const posts = profile.media_count ?? profile.posts_count;
        const bio = profile.biography || profile.bio;
        const lines = [
          "📡 Metadata IG Satbinmas Official",
          `Client ID : ${normalizedClientId}`,
          `Username  : @${username}`,
          `Nama      : ${profileName}`,
          `Followers : ${formatNumber(followers) || "-"}`,
          `Mengikuti : ${formatNumber(following) || "-"}`,
          `Postingan : ${formatNumber(posts) || "-"}`,
          `Verifikasi: ${profile.is_verified ? "Sudah" : "Belum"}`,
          `Privasi   : ${profile.is_private ? "Private" : "Publik"}`,
        ];
        if (bio) lines.push(`Bio: ${bio}`);

        await waClient.sendMessage(chatId, lines.join("\n"));
      }
    } catch (error) {
      console.error("Gagal mengambil metadata IG Satbinmas Official:", error);
      const reason = error?.message?.slice(0, 400) || "Alasan tidak diketahui.";
      await waClient.sendMessage(
        chatId,
        `❌ Gagal mengambil metadata akun Satbinmas Official: ${reason}`
      );
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async resolve_satbinmas_official_tiktok_secuid(
    session,
    chatId,
    text,
    waClient
  ) {
    const defaultClientId =
      session.dir_client_id || session.selectedClientId || DITBINMAS_CLIENT_ID;
    const rawInput = (text || "").trim();

    if (rawInput.toLowerCase() === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Menu sinkronisasi secUid TikTok Satbinmas Official ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    try {
      await waClient.sendMessage(
        chatId,
        SATBINMAS_OFFICIAL_TIKTOK_SECUID_PROMPT(defaultClientId)
      );

      const summary = await syncSatbinmasOfficialTiktokSecUidForOrgClients();

      const successLines = [];
      const failedLines = [];
      const missingClients = [];

      summary.clients.forEach((clientSummary) => {
        const clientLabel = clientSummary.name?.trim() || clientSummary.clientId;

        if (clientSummary.missingAccounts) {
          missingClients.push(clientLabel);
          return;
        }

        clientSummary.accounts.forEach((account) => {
          successLines.push(
            `- @${account.username} (${clientLabel}): ${account.secUid}`
          );
        });

        clientSummary.errors.forEach((err) => {
          failedLines.push(
            `- @${err.username || "(kosong)"} (${clientLabel}): ${
              err.message || "Gagal sinkron secUid."
            }`
          );
        });
      });

      const lines = [
        "📡 secUid TikTok Satbinmas Official",
        `Client ORG diproses : ${summary.totals.clients}`,
        `Akun TikTok diproses: ${summary.totals.accounts}`,
        `Berhasil disimpan   : ${summary.totals.resolved}`,
        `Gagal disimpan      : ${summary.totals.failed}`,
      ];

      lines.push("", "🚫 Client tanpa akun TikTok");
      if (missingClients.length) {
        missingClients.forEach((label) => {
          lines.push(`- ${label}`);
        });
      } else {
        lines.push("- Semua client ORG memiliki akun TikTok terdaftar.");
      }

      lines.push("", "✅ secUid tersinkron");
      if (successLines.length) {
        successLines.forEach((msg) => lines.push(msg));
      } else {
        lines.push("- Tidak ada akun yang berhasil disinkron.");
      }

      if (failedLines.length) {
        lines.push("", "⚠️ Gagal sinkron secUid");
        failedLines.forEach((msg) => lines.push(msg));
      }

      await waClient.sendMessage(chatId, lines.join("\n"));
    } catch (error) {
      console.error(
        "Gagal sinkronisasi secUid TikTok Satbinmas Official:",
        error
      );
      const reason = error?.message?.slice(0, 400) || "Alasan tidak diketahui.";
      await waClient.sendMessage(
        chatId,
        `❌ Gagal sinkron secUid TikTok Satbinmas Official: ${reason}`
      );
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async fetch_satbinmas_official_tiktok_media(session, chatId, text, waClient) {
    const rawInput = (text || "").trim();

    if (rawInput.toLowerCase() === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Menu pengambilan konten TikTok Satbinmas Official ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    try {
      await waClient.sendMessage(
        chatId,
        SATBINMAS_OFFICIAL_TIKTOK_MEDIA_PROMPT
      );

      const recap = await buildSatbinmasOfficialTiktokRecap();
      await waClient.sendMessage(chatId, recap);
    } catch (error) {
      console.error("Gagal mengambil konten TikTok Satbinmas Official:", error);
      const message =
        error?.message?.slice(0, 400) || "Gagal mengambil konten TikTok Satbinmas Official.";
      await waClient.sendMessage(
        chatId,
        `❌ ${message}`
      );
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async fetch_satbinmas_official_media(session, chatId, text, waClient) {
    const rawInput = (text || "").trim();

    if (rawInput.toLowerCase() === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Menu pengambilan konten Satbinmas Official ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    try {
      await waClient.sendMessage(
        chatId,
        SATBINMAS_OFFICIAL_MEDIA_PROMPT
      );

      const recap = await buildSatbinmasOfficialInstagramRecap();
      await waClient.sendMessage(chatId, recap);
    } catch (error) {
      console.error("Gagal mengambil konten Satbinmas Official:", error);
      const message =
        error?.message?.slice(0, 400) || "Gagal mengambil konten Satbinmas Official.";
      await waClient.sendMessage(
        chatId,
        `❌ ${message}`
      );
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_satbinmas_official_instagram_recap_period(
    session,
    chatId,
    text,
    waClient
  ) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, SATBINMAS_OFFICIAL_INSTAGRAM_RECAP_MENU_TEXT);
      return;
    }

    const normalizedInput = input.toLowerCase();
    if (
      normalizedInput === "batal" ||
      normalizedInput === "menu" ||
      normalizedInput === "back" ||
      input === "0"
    ) {
      await waClient.sendMessage(
        chatId,
        "✅ Menu rekap Instagram Satbinmas Official ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = SATBINMAS_OFFICIAL_RECAP_PERIOD_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 3 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, SATBINMAS_OFFICIAL_INSTAGRAM_RECAP_MENU_TEXT);
      return;
    }

    try {
      const recap = await buildSatbinmasOfficialInstagramDbRecap(option.period);
      await waClient.sendMessage(chatId, recap);
    } catch (error) {
      console.error("Gagal mengambil rekap Instagram Satbinmas Official:", error);
      const message =
        error?.message?.slice(0, 400) || "Gagal mengambil rekap Instagram Satbinmas Official.";
      await waClient.sendMessage(chatId, `❌ ${message}`);
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_satbinmas_official_tiktok_recap_period(session, chatId, text, waClient) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, SATBINMAS_OFFICIAL_TIKTOK_RECAP_MENU_TEXT);
      return;
    }

    const normalizedInput = input.toLowerCase();
    if (
      normalizedInput === "batal" ||
      normalizedInput === "menu" ||
      normalizedInput === "back" ||
      input === "0"
    ) {
      await waClient.sendMessage(chatId, "✅ Menu rekap TikTok Satbinmas Official ditutup.");
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = SATBINMAS_OFFICIAL_RECAP_PERIOD_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 3 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, SATBINMAS_OFFICIAL_TIKTOK_RECAP_MENU_TEXT);
      return;
    }

    try {
      const recap = await buildSatbinmasOfficialTiktokDbRecap(option.period);
      await waClient.sendMessage(chatId, recap);
    } catch (error) {
      console.error("Gagal mengambil rekap TikTok Satbinmas Official:", error);
      const message =
        error?.message?.slice(0, 400) || "Gagal mengambil rekap TikTok Satbinmas Official.";
      await waClient.sendMessage(chatId, `❌ ${message}`);
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_kasat_binmas_likes_period(session, chatId, text, waClient) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, KASAT_BINMAS_LIKES_MENU_TEXT);
      return;
    }

    if (input.toLowerCase() === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Menu Absensi Likes Kasat Binmas ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = KASAT_BINMAS_LIKES_PERIOD_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 3 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, KASAT_BINMAS_LIKES_MENU_TEXT);
      return;
    }

    try {
      const narrative = await generateKasatBinmasLikesRecap({
        period: option.period,
      });
      await waClient.sendMessage(chatId, narrative);
    } catch (error) {
      console.error(
        "Gagal membuat rekap Absensi Likes Kasat Binmas:",
        error
      );
      const msg =
        error?.message &&
        (error.message.includes("direktorat") ||
          error.message.includes("Client tidak ditemukan") ||
          error.message.includes("Tidak ada data"))
          ? error.message
          : `❌ Gagal membuat rekap Absensi Likes Kasat Binmas (${option.description}).`;
      await waClient.sendMessage(chatId, msg);
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_kasat_binmas_likes_excel_period(session, chatId, text, waClient) {
    const input = (text || "").trim();
    if (!input) {
      await safeSendMessage(waClient, chatId, KASAT_BINMAS_LIKES_EXCEL_MENU_TEXT);
      return;
    }

    if (input.toLowerCase() === "batal") {
      await safeSendMessage(
        waClient,
        chatId,
        "✅ Menu Rekap Likes Instagram Kasat Binmas (Excel) ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = KASAT_BINMAS_LIKES_PERIOD_MAP[input];
    if (!option) {
      await safeSendMessage(
        waClient,
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 3 atau ketik *batal*."
      );
      await safeSendMessage(waClient, chatId, KASAT_BINMAS_LIKES_EXCEL_MENU_TEXT);
      return;
    }

    const referenceDate =
      session?.dirRequestReferenceDate || session?.executionDate || session?.referenceDate;
    const normalizedReferenceDate =
      referenceDate !== undefined && referenceDate !== null
        ? resolveBaseDate(referenceDate)
        : undefined;

    try {
      const result = await sendKasatBinmasLikesRecapExcel({
        period: option.period,
        referenceDate: normalizedReferenceDate,
        chatId,
        waClient,
      });
      if (!result?.success) {
        console.error(
          "[submenu 44] Rekap Likes Kasat Binmas (Excel) gagal dikirim.",
          result?.error
        );
        session.step = "choose_kasat_binmas_likes_excel_period";
        await safeSendMessage(waClient, chatId, KASAT_BINMAS_LIKES_EXCEL_MENU_TEXT);
        return;
      }
    } catch (error) {
      console.error(
        "[submenu 44] Unexpected error rekap Likes Kasat Binmas (Excel):",
        error
      );
      session.step = "choose_kasat_binmas_likes_excel_period";
      await safeSendMessage(
        waClient,
        chatId,
        "❌ Terjadi gangguan saat menyiapkan rekap Likes Kasat Binmas. Silakan coba lagi."
      );
      await safeSendMessage(waClient, chatId, KASAT_BINMAS_LIKES_EXCEL_MENU_TEXT);
      return;
    } finally {
      session.dirRequestReferenceDate = undefined;
      session.executionDate = undefined;
      session.referenceDate = undefined;
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_kasat_binmas_tiktok_comment_excel_period(
    session,
    chatId,
    text,
    waClient
  ) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, KASAT_BINMAS_TIKTOK_COMMENT_EXCEL_MENU_TEXT);
      return;
    }

    if (input.toLowerCase() === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Menu Rekap Komentar TikTok Kasat Binmas (Excel) ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = KASAT_BINMAS_TIKTOK_COMMENT_PERIOD_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 3 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, KASAT_BINMAS_TIKTOK_COMMENT_EXCEL_MENU_TEXT);
      return;
    }

    const referenceDate =
      session?.dirRequestReferenceDate || session?.executionDate || session?.referenceDate;
    const normalizedReferenceDate =
      referenceDate !== undefined && referenceDate !== null
        ? resolveBaseDate(referenceDate)
        : undefined;

    try {
      await sendKasatBinmasTiktokCommentRecapExcel({
        period: option.period,
        referenceDate: normalizedReferenceDate,
        chatId,
        waClient,
      });
    } catch (error) {
      console.error(
        "Gagal membuat rekap komentar TikTok Kasat Binmas (Excel):",
        error
      );
      const msg =
        error?.message &&
        (error.message.includes("direktorat") ||
          error.message.includes("Client tidak ditemukan") ||
          error.message.includes("Tidak ada data"))
          ? error.message
          : `❌ Gagal mengirim rekap komentar TikTok Kasat Binmas (Excel) (${option.description}).`;
      try {
        await safeSendMessage(waClient, chatId, msg);
      } catch (sendError) {
        console.error(
          "Gagal mengirim pesan error rekap komentar TikTok Kasat Binmas (Excel):",
          sendError
        );
      }
    } finally {
      session.dirRequestReferenceDate = undefined;
      session.executionDate = undefined;
      session.referenceDate = undefined;
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_kasat_binmas_tiktok_comment_period(session, chatId, text, waClient) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, KASAT_BINMAS_TIKTOK_COMMENT_MENU_TEXT);
      return;
    }

    if (input.toLowerCase() === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Menu Absensi Komentar TikTok Kasat Binmas ditutup."
      );
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = KASAT_BINMAS_TIKTOK_COMMENT_PERIOD_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 3 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, KASAT_BINMAS_TIKTOK_COMMENT_MENU_TEXT);
      return;
    }

    const referenceDate =
      session?.dirRequestReferenceDate || session?.executionDate || session?.referenceDate;
    const normalizedReferenceDate =
      referenceDate !== undefined && referenceDate !== null
        ? resolveBaseDate(referenceDate)
        : undefined;

    try {
      const narrative = await generateKasatBinmasTiktokCommentRecap({
        period: option.period,
        referenceDate: normalizedReferenceDate,
      });
      await waClient.sendMessage(chatId, narrative);
    } catch (error) {
      console.error(
        "Gagal membuat rekap Absensi Komentar TikTok Kasat Binmas:",
        error
      );
      const msg =
        error?.message &&
        (error.message.includes("direktorat") ||
          error.message.includes("Client tidak ditemukan") ||
          error.message.includes("Tidak ada data"))
          ? error.message
          : `❌ Gagal membuat rekap Absensi Komentar TikTok Kasat Binmas (${option.description}).`;
      await waClient.sendMessage(chatId, msg);
    } finally {
      session.dirRequestReferenceDate = undefined;
      session.executionDate = undefined;
      session.referenceDate = undefined;
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_kasatker_report_period(session, chatId, text, waClient) {
    const input = (text || "").trim();
    if (!input) {
      await waClient.sendMessage(chatId, KASATKER_REPORT_MENU_TEXT);
      return;
    }

    if (input.toLowerCase() === "batal") {
      await waClient.sendMessage(chatId, "✅ Menu Laporan Kasatker ditutup.");
      session.step = "main";
      await dirRequestHandlers.main(session, chatId, "", waClient);
      return;
    }

    const option = KASATKER_REPORT_PERIOD_MAP[input];
    if (!option) {
      await waClient.sendMessage(
        chatId,
        "Pilihan tidak valid. Balas angka 1 sampai 4 atau ketik *batal*."
      );
      await waClient.sendMessage(chatId, KASATKER_REPORT_MENU_TEXT);
      return;
    }

    const targetClientId =
      session.dir_client_id || session.selectedClientId || DITBINMAS_CLIENT_ID;
    const roleFlag = session.role;

    try {
      const narrative = await generateKasatkerReport({
        clientId: targetClientId,
        roleFlag,
        period: option.period,
      });
      await waClient.sendMessage(chatId, narrative);
    } catch (error) {
      console.error("Gagal membuat Laporan Kasatker:", error);
      let msg;
      if (
        error?.message &&
        (error.message.includes("direktorat") ||
          error.message.includes("Client tidak ditemukan") ||
          error.message.includes("Tidak ada data"))
      ) {
        msg = error.message;
      } else {
        msg = `❌ Gagal membuat Laporan Kasatker (${option.label}).`;
      }
      await waClient.sendMessage(chatId, msg);
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },

  async choose_kasatker_attendance(session, chatId, text, waClient) {
    const targetClientId =
      session.dir_client_id || session.selectedClientId || DITBINMAS_CLIENT_ID;
    const roleFlag = session.role;

    try {
      const narrative = await generateKasatkerAttendanceSummary({
        clientId: targetClientId,
        roleFlag,
      });
      await waClient.sendMessage(chatId, narrative);
    } catch (error) {
      console.error("Gagal membuat Absensi Kasatker:", error);
      const msg =
        error?.message &&
        (error.message.includes("direktorat") ||
          error.message.includes("Client tidak ditemukan") ||
          error.message.includes("Tidak ada data"))
          ? error.message
          : "❌ Gagal membuat Absensi Kasatker.";
      await waClient.sendMessage(chatId, msg);
    }

    session.step = "main";
    await dirRequestHandlers.main(session, chatId, "", waClient);
  },
};

export {
  formatRekapUserData,
  formatTopPersonnelRanking,
  topPersonnelRankingDependencies,
  formatTopPolresRanking,
  topPolresRankingDependencies,
  absensiLikesDitbinmas,
  absensiLikesDitbinmasSimple,
  absensiKomentarDitbinmas,
  absensiKomentarDitbinmasSimple,
  absensiKomentarTiktok,
  formatExecutiveSummary,
  formatRekapBelumLengkapDirektorat,
  formatRekapDataPersonil,
  formatRekapAllSosmed,
};

export default dirRequestHandlers;

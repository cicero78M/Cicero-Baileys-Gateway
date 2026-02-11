import { query } from "../../../db/index.js";
import { hariIndo } from "../../../utils/constants.js";
import { getGreeting } from "../../../utils/utilsHelper.js";

const ROLE_BY_DIREKTORAT_CLIENT = {
  DITBINMAS: "ditbinmas",
  DITLANTAS: "ditlantas",
  BIDHUMAS: "bidhumas",
  DITSAMAPTA: "ditsamapta",
  DITINTELKAM: "ditintelkam",
};

const MENU_11_CLIENT_TYPE_ORG = "org";

function normalizeDirectorateId(clientId) {
  return String(clientId || "").trim().toUpperCase() || "DITBINMAS";
}

function resolveRoleByDirectorate(clientId) {
  const normalizedDirectorateId = normalizeDirectorateId(clientId);
  const mappedRole = ROLE_BY_DIREKTORAT_CLIENT[normalizedDirectorateId];

  if (!mappedRole) {
    throw new Error(
      `Role mapping untuk client Direktorat "${normalizedDirectorateId}" belum terdaftar. ` +
        "Silakan tambahkan mapping Direktorat→role pada ROLE_BY_DIREKTORAT_CLIENT."
    );
  }

  return mappedRole;
}

async function ensureRoleExists(roleName, directorateId) {
  const { rows } = await query(
    `SELECT role_id
     FROM roles
     WHERE LOWER(role_name) = LOWER($1)
     LIMIT 1`,
    [roleName]
  );

  if (!rows.length) {
    throw new Error(
      `Role "${roleName}" untuk client Direktorat "${directorateId}" tidak ditemukan pada tabel roles. ` +
        "Konfigurasi role belum sinkron antara mapping aplikasi dan database."
    );
  }
}

function ensureDirectorateMetadata(directorateMetadata, directorateId) {
  if (!directorateMetadata) {
    throw new Error(
      `Client Direktorat "${directorateId}" tidak ditemukan pada tabel clients.`
    );
  }

  const resolvedClientId = String(directorateMetadata.client_id || "")
    .trim()
    .toUpperCase();
  const resolvedClientType = String(directorateMetadata.client_type || "")
    .trim()
    .toLowerCase();

  if (resolvedClientId !== directorateId) {
    throw new Error(
      `Data client_id tidak sinkron. Direktorat terpilih "${directorateId}" tetapi metadata mengarah ke "${resolvedClientId || '-'}".`
    );
  }

  if (resolvedClientType !== "direktorat") {
    throw new Error(
      `Client "${directorateId}" bukan tipe direktorat (client_type saat ini: "${resolvedClientType || '-'}").`
    );
  }
}

/**
 * Rekap registrasi user dashboard + absensi web untuk menu 1️⃣1️⃣ (dirrequest).
 *
 * Mapping resmi Direktorat→role:
 * - DITBINMAS → ditbinmas
 * - DITLANTAS → ditlantas
 * - BIDHUMAS → bidhumas
 * - DITSAMAPTA → ditsamapta
 * - DITINTELKAM → ditintelkam
 */
export async function absensiRegistrasiDashboardDirektorat(clientId = "DITBINMAS") {
  const directorateId = normalizeDirectorateId(clientId);
  const roleName = resolveRoleByDirectorate(directorateId);
  const roleLabel = "Direktorat";

  await ensureRoleExists(roleName, directorateId);

  const now = new Date();
  const hari = hariIndo[now.getDay()];
  const tanggal = now.toLocaleDateString("id-ID");
  const jam = now.toLocaleTimeString("id-ID", { hour12: false });
  const salam = getGreeting();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const { rows: directorateRows } = await query(
    `SELECT client_id, nama, client_type, regional_id, client_level
     FROM clients
     WHERE UPPER(client_id) = $1
     LIMIT 1`,
    [directorateId]
  );
  const directorateMetadata = directorateRows[0] || null;
  ensureDirectorateMetadata(directorateMetadata, directorateId);

  const { rows: orgClients } = await query(
    `SELECT client_id, nama, client_type
     FROM clients
     WHERE LOWER(TRIM(client_type)) = $1
     ORDER BY nama`,
    [MENU_11_CLIENT_TYPE_ORG]
  );

  const orgScopeClients = [];
  const seenClients = new Set();

  const selectedDirektorat = {
    client_id: directorateId,
    nama: directorateMetadata.nama || directorateId,
    client_type: directorateMetadata.client_type,
  };

  orgClients.forEach((client) => {
    const normalizedClientId = String(client.client_id || "").trim().toUpperCase();
    if (!normalizedClientId || seenClients.has(normalizedClientId)) return;
    orgScopeClients.push(client);
    seenClients.add(normalizedClientId);
  });

  const scopeClientIds = [
    directorateId,
    ...orgScopeClients.map((client) => client.client_id.toUpperCase()),
  ];

  const { rows: directorateDashboardRows } = await query(
    `SELECT COUNT(DISTINCT du.dashboard_user_id) AS dashboard_user
     FROM dashboard_user du
     JOIN roles r ON du.role_id = r.role_id
     JOIN dashboard_user_clients duc ON du.dashboard_user_id = duc.dashboard_user_id
     WHERE LOWER(r.role_name) = LOWER($1)
       AND du.status = true
       AND UPPER(duc.client_id) = $2`,
    [roleName, directorateId]
  );

  const { rows: directorateLoginRows } = await query(
    `SELECT COUNT(DISTINCT du.dashboard_user_id) AS operator
     FROM dashboard_user du
     JOIN roles r ON du.role_id = r.role_id
     JOIN dashboard_user_clients duc ON du.dashboard_user_id = duc.dashboard_user_id
     JOIN login_log ll ON ll.actor_id = du.dashboard_user_id::TEXT
     WHERE LOWER(r.role_name) = LOWER($1)
       AND du.status = true
       AND UPPER(duc.client_id) = $2
       AND ll.login_source = 'web'
       AND ll.logged_at >= $3`,
    [roleName, directorateId, startOfToday]
  );

  const dashboardCountMap = new Map();
  const loginCountMap = new Map();

  if (scopeClientIds.length) {
    const { rows: dashboardUserRows } = await query(
      `SELECT UPPER(duc.client_id) AS client_id, COUNT(DISTINCT du.dashboard_user_id) AS dashboard_user
       FROM dashboard_user du
       JOIN roles r ON du.role_id = r.role_id
       JOIN dashboard_user_clients duc ON du.dashboard_user_id = duc.dashboard_user_id
       WHERE LOWER(r.role_name) = LOWER($1)
         AND du.status = true
         AND UPPER(duc.client_id) = ANY($2)
       GROUP BY UPPER(duc.client_id)`,
      [roleName, scopeClientIds]
    );

    const { rows: loginRows } = await query(
      `SELECT UPPER(duc.client_id) AS client_id, COUNT(DISTINCT du.dashboard_user_id) AS operator
       FROM dashboard_user du
       JOIN roles r ON du.role_id = r.role_id
       JOIN dashboard_user_clients duc ON du.dashboard_user_id = duc.dashboard_user_id
       JOIN login_log ll ON ll.actor_id = du.dashboard_user_id::TEXT
       WHERE LOWER(r.role_name) = LOWER($1)
         AND du.status = true
         AND UPPER(duc.client_id) = ANY($2)
         AND ll.login_source = 'web'
         AND ll.logged_at >= $3
       GROUP BY UPPER(duc.client_id)`,
      [roleName, scopeClientIds, startOfToday]
    );

    dashboardUserRows.forEach((row) => {
      dashboardCountMap.set(String(row.client_id || "").toUpperCase(), Number(row.dashboard_user));
    });
    loginRows.forEach((row) => {
      loginCountMap.set(String(row.client_id || "").toUpperCase(), Number(row.operator));
    });
  }

  const directorateName = selectedDirektorat.nama || directorateId;
  const directorateDashboardCount = Number(directorateDashboardRows[0]?.dashboard_user || 0);
  const directorateAttendanceCount = Number(directorateLoginRows[0]?.operator || 0);

  const hasDashboardUser = [];
  const noDashboardUser = [];
  orgScopeClients.forEach((client) => {
      const id = client.client_id.toUpperCase();
      const dashboardCount = dashboardCountMap.get(id) || 0;
      const attendanceCount = loginCountMap.get(id) || 0;

      if (dashboardCount > 0) {
        hasDashboardUser.push(
          `${client.nama.toUpperCase()} : ${dashboardCount} user dashboard (${attendanceCount} absensi web)`
        );
      } else {
        noDashboardUser.push(client.nama.toUpperCase());
      }
    });

  let msg = `${salam}\n\n`;
  msg += `Mohon Ijin Komandan,\n\n`;
  msg += `📋 Rekap Registrasi User dashboard Cicero ${directorateName.toUpperCase()} :\n`;
  msg += `${hari}, ${tanggal}\n`;
  msg += `Jam: ${jam}\n\n`;
  msg += `Role filter: ${roleName.toUpperCase()}\n\n`;
  msg += `Validasi Direktorat: client_id=${directorateId}, client_type=${String(
    selectedDirektorat.client_type || ""
  ).toLowerCase()}, role=${roleName.toUpperCase()}\n\n`;
  msg += `Absensi Registrasi User Direktorat dan Client ORG :\n\n`;
  msg += `${directorateName.toUpperCase()} : ${directorateDashboardCount} ${roleLabel} (${directorateAttendanceCount} absensi web)\n\n`;

  msg += `Sudah memiliki user dashboard : ${hasDashboardUser.length} client ORG\n`;
  msg += hasDashboardUser.length
    ? hasDashboardUser.map((name) => `- ${name}`).join("\n")
    : "-";
  msg += `\nBelum memiliki user dashboard : ${noDashboardUser.length} client ORG\n`;
  msg += noDashboardUser.length
    ? noDashboardUser.map((name) => `- ${name}`).join("\n")
    : "-";

  return msg.trim();
}

export { absensiRegistrasiDashboardDirektorat as absensiRegistrasiDashboardDitbinmas };

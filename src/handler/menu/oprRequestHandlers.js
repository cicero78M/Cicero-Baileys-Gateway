// src/handler/menu/oprRequestHandlers.js
import { isAdminWhatsApp, formatToWhatsAppId } from "../../utils/waHelper.js";
import { saveContactIfNew } from "../../service/googleContactsService.js";
import { hariIndo } from "../../utils/constants.js";
import {
  getGreeting,
  sortDivisionKeys,
  sortTitleKeys,
} from "../../utils/utilsHelper.js";
import { appendSubmenuBackInstruction } from "./menuPromptHelpers.js";

function ignore(..._args) {}

const OPERATOR_ROLE = "operator";

function normalizeAccessNumbers(rawNumber) {
  const digitsOnly = String(rawNumber || "").replace(/\D/g, "");
  if (!digitsOnly) return [];

  let waId = digitsOnly;
  if (waId.startsWith("0")) {
    waId = "62" + waId.slice(1);
  } else if (!waId.startsWith("62")) {
    waId = "62" + waId;
  }

  const variants = new Set([waId]);
  const localDigits = waId.slice(2).replace(/^0+/, "");
  if (localDigits) {
    variants.add("0" + localDigits);
  }

  return Array.from(variants);
}

function buildSuperAdminPatterns(numbers) {
  return numbers.map((number) => `(^|\\D)${number}(\\D|$)`);
}

async function resolveClientProfile(session, chatId, pool) {
  if (session.selected_client_id) {
    const { rows } = await pool.query(
      "SELECT * FROM clients WHERE LOWER(client_id) = LOWER($1) LIMIT 1",
      [session.selected_client_id]
    );
    return rows[0] || null;
  }

  const candidates = normalizeAccessNumbers(chatId);
  if (candidates.length) {
    const { rows } = await pool.query(
      `SELECT *
       FROM clients
       WHERE client_operator = ANY($1::text[])
          OR (
            client_super IS NOT NULL
            AND client_super <> ''
            AND client_super ~ ANY($2::text[])
          )
       LIMIT 1`,
      [candidates, buildSuperAdminPatterns(candidates)]
    );
    if (rows[0]) {
      session.selected_client_id = rows[0].client_id;
      return rows[0];
    }
  }

  return null;
}

async function ensureUserMenuAccess(session, chatId, waClient, pool) {
  const client = await resolveClientProfile(session, chatId, pool);
  if (!client) {
    await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
    return null;
  }
  if (!client.client_status) {
    await waClient.sendMessage(
      chatId,
      "❌ Menu kelola user hanya tersedia untuk client dengan status aktif."
    );
    return null;
  }
  if ((client.client_type || "").toLowerCase() !== "org") {
    await waClient.sendMessage(
      chatId,
      "❌ Menu kelola user hanya tersedia untuk client dengan tipe *org*."
    );
    return null;
  }
  return client;
}

async function ensureAmplifyMenuAccess(session, chatId, waClient, pool) {
  const client = await resolveClientProfile(session, chatId, pool);
  if (!client) {
    await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
    return null;
  }
  if (!client.client_status) {
    await waClient.sendMessage(
      chatId,
      "❌ Menu kelola amplifikasi hanya tersedia untuk client dengan status aktif."
    );
    return null;
  }
  if (!client.client_amplify_status) {
    await waClient.sendMessage(
      chatId,
      "❌ Menu kelola amplifikasi hanya tersedia untuk client dengan amplifikasi aktif."
    );
    return null;
  }
  return client;
}

async function ensureEngagementMenuAccess(
  session,
  chatId,
  waClient,
  pool,
  { platform } = {}
) {
  const client = await resolveClientProfile(session, chatId, pool);
  if (!client) {
    await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
    return null;
  }
  if (!client.client_status) {
    await waClient.sendMessage(
      chatId,
      "❌ Menu manajemen engagement hanya tersedia untuk client dengan status aktif."
    );
    return null;
  }
  const instagramActive = Boolean(client.client_insta_status);
  const tiktokActive = Boolean(client.client_tiktok_status);

  if (platform === "instagram" && !instagramActive) {
    await waClient.sendMessage(
      chatId,
      "❌ Absensi Likes Instagram hanya tersedia untuk client dengan Instagram aktif."
    );
    return null;
  }
  if (platform === "tiktok" && !tiktokActive) {
    await waClient.sendMessage(
      chatId,
      "❌ Absensi Komentar TikTok hanya tersedia untuk client dengan TikTok aktif."
    );
    return null;
  }
  if (!platform && !instagramActive && !tiktokActive) {
    await waClient.sendMessage(
      chatId,
      "❌ Menu manajemen engagement hanya tersedia untuk client dengan Instagram atau TikTok aktif."
    );
    return null;
  }
  return {
    client,
    instagramActive,
    tiktokActive,
  };
}

async function resolveClientId(session, chatId, pool) {
  if (session.selected_client_id) {
    return session.selected_client_id;
  }

  const candidates = normalizeAccessNumbers(chatId);
  if (!candidates.length) {
    return null;
  }

  try {
    const { rows } = await pool.query(
      `SELECT client_id
       FROM clients
       WHERE client_operator = ANY($1::text[])
          OR (
            client_super IS NOT NULL
            AND client_super <> ''
            AND client_super ~ ANY($2::text[])
          )
       LIMIT 1`,
      [candidates, buildSuperAdminPatterns(candidates)]
    );
    const clientId = rows[0]?.client_id;
    if (clientId) {
      session.selected_client_id = clientId;
      return clientId;
    }
  } catch (err) {
    console.error(err);
  }

  return null;
}

function formatUpdateFieldList() {
  return appendSubmenuBackInstruction(`
✏️ *Pilih field yang ingin diupdate:*
1. Nama
2. Pangkat
3. Satfung
4. Jabatan
5. WhatsApp
6. Instagram
7. TikTok
8. Hapus WhatsApp

Balas angka field di atas atau *batal* untuk keluar.`.trim());
}

function formatClientSelectionMessage(clients) {
  const items = clients
    .map((client, index) => {
      const label = client.nama ? `${client.client_id} - ${client.nama}` : client.client_id;
      return `${index + 1}. ${label}`;
    })
    .join("\n");
  return appendSubmenuBackInstruction(
    `*Pilih client (tipe Org) untuk Menu Operator:*\n${items}\n\nBalas *nomor* atau *client_id* untuk melanjutkan, atau *batal* untuk keluar.`
  );
}

async function getOperatorUserIds(userModel, clientId) {
  const operators = await userModel.getUsersByClient(clientId, OPERATOR_ROLE);
  return new Set(operators.map((operator) => operator.user_id));
}

function hasOperatorRole(roles) {
  return roles.some((role) => role?.toLowerCase() === OPERATOR_ROLE);
}

export const oprRequestHandlers = {
  main: async (session, chatId, text, waClient, pool, userModel) => {
    // Fetch client data to determine which menus to show
    const client = await resolveClientProfile(session, chatId, pool);
    
    // Build menu items based on client status
    const menuItems = [];
    const menuMapping = {};
    let menuNumber = 1;
    
    // Manajemen User - always shown for ORG clients
    menuItems.push(`${menuNumber}️⃣ Manajemen User`);
    menuMapping[menuNumber] = 'user';
    menuNumber++;
    
    // Manajemen Amplifikasi (Diseminasi) - only if client_status AND client_amplify_status
    if (client && client.client_status && client.client_amplify_status) {
      menuItems.push(`${menuNumber}️⃣ Manajemen Amplifikasi`);
      menuMapping[menuNumber] = 'amplifikasi';
      menuNumber++;
    }
    
    // Manajemen Engagement - only if client_status AND (instagram OR tiktok)
    if (client && client.client_status && (client.client_insta_status || client.client_tiktok_status)) {
      menuItems.push(`${menuNumber}️⃣ Manajemen Engagement`);
      menuMapping[menuNumber] = 'engagement';
      menuNumber++;
    }
    
    // Store menu mapping in session for chooseMenuGroup handler
    session.menuMapping = menuMapping;
    
    const msg =
      `┏━━━ *MENU OPERATOR CICERO* ━━━┓
👮‍♂️  Akses khusus operator client.

${menuItems.join('\n')}

Ketik *angka menu* di atas, atau *batal* untuk keluar.
┗━━━━━━━━━━━━━━━━━━━━━━━━━┛`;
    session.step = "chooseMenuGroup";
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg));
  },

  choose_client: async (session, chatId, text, waClient, pool, userModel) => {
    const clients = Array.isArray(session.opr_clients) ? session.opr_clients : [];
    const trimmedText = (text || "").trim();

    if (!clients.length) {
      delete session.opr_clients;
      session.step = "main";
      await waClient.sendMessage(
        chatId,
        "❌ Tidak ada client Org yang dapat dipilih untuk menu operator."
      );
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }

    if (!trimmedText || /^(menu|kembali|back|0)$/i.test(trimmedText)) {
      await waClient.sendMessage(chatId, formatClientSelectionMessage(clients));
      return;
    }

    if (/^(batal|cancel|exit)$/i.test(trimmedText)) {
      session.menu = null;
      session.step = null;
      delete session.opr_clients;
      delete session.selected_client_id;
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }

    let selectedClient = null;
    if (/^\d+$/.test(trimmedText)) {
      const index = Number.parseInt(trimmedText, 10);
      if (index >= 1 && index <= clients.length) {
        selectedClient = clients[index - 1];
      }
    }

    if (!selectedClient) {
      selectedClient = clients.find(
        (client) =>
          String(client.client_id || "").toLowerCase() === trimmedText.toLowerCase()
      );
    }

    if (!selectedClient) {
      await waClient.sendMessage(
        chatId,
        "❌ Pilihan client tidak valid. Balas nomor atau client_id yang tersedia."
      );
      return;
    }

    session.selected_client_id = selectedClient.client_id;
    delete session.opr_clients;
    session.step = "main";
    await waClient.sendMessage(
      chatId,
      `✅ Client ${selectedClient.client_id} dipilih.`
    );
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  chooseMenuGroup: async (session, chatId, text, waClient, pool, userModel) => {
    const clean = () => {
      delete session.addUser;
      delete session.availableSatfung;
      delete session.updateStatusNRP;
      delete session.absensi_update_client_id;
      delete session.absensi_engagement_client_id;
      delete session.absensi_engagement_type;
    };
    
    // Get menu mapping from session (set in main function)
    const menuMapping = session.menuMapping || {};
    const trimmedText = text.trim();
    
    // Check for cancel command
    if (/^(batal|cancel|exit)$/i.test(trimmedText)) {
      session.menu = null;
      session.step = null;
      clean();
      delete session.menuMapping;
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    
    // Check if input is a valid menu number
    const menuNumber = parseInt(trimmedText, 10);
    if (!isNaN(menuNumber) && menuMapping[menuNumber]) {
      const selectedMenu = menuMapping[menuNumber];
      
      if (selectedMenu === 'user') {
        clean();
        const client = await ensureUserMenuAccess(session, chatId, waClient, pool);
        if (!client) {
          if (isAdminWhatsApp(chatId)) {
            delete session.selected_client_id;
          }
          session.step = "main";
          return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
        }
        session.step = "kelolaUser_menu";
        await waClient.sendMessage(
          chatId,
          appendSubmenuBackInstruction(
            `*Menu Manajemen User*\n1️⃣ Tambah user baru\n2️⃣ Perbarui data user\n3️⃣ Ubah status user (aktif/nonaktif)\n4️⃣ Cek data user (NRP/NIP)\n5️⃣ Absensi registrasi user\n6️⃣ Absensi update data username\n\nKetik *angka menu* di atas, *menu* untuk kembali, atau *batal* untuk keluar.`
          )
        );
        return;
      }
      
      if (selectedMenu === 'amplifikasi') {
        clean();
        const client = await ensureAmplifyMenuAccess(session, chatId, waClient, pool);
        if (!client) {
          if (isAdminWhatsApp(chatId)) {
            delete session.selected_client_id;
          }
          session.step = "main";
          return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
        }
        session.step = "kelolaAmplifikasi_menu";
        await waClient.sendMessage(
          chatId,
          appendSubmenuBackInstruction(
            `*Menu Manajemen Amplifikasi*\n1️⃣ Tugas Amplifikasi\n2️⃣ Laporan Amplifikasi\n\nKetik *angka menu* di atas, *menu* untuk kembali, atau *batal* untuk keluar.`
          )
        );
        return;
      }
      
      if (selectedMenu === 'engagement') {
        clean();
        const engagementAccess = await ensureEngagementMenuAccess(
          session,
          chatId,
          waClient,
          pool
        );
        if (!engagementAccess) {
          if (isAdminWhatsApp(chatId)) {
            delete session.selected_client_id;
          }
          session.step = "main";
          return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
        }
        const { instagramActive, tiktokActive } = engagementAccess;
        const instaLabel = instagramActive
          ? "1️⃣ Absensi Likes Instagram"
          : "1️⃣ Absensi Likes Instagram (nonaktif)";
        const tiktokLabel = tiktokActive
          ? "2️⃣ Absensi Komentar TikTok"
          : "2️⃣ Absensi Komentar TikTok (nonaktif)";
        session.step = "kelolaEngagement_menu";
        await waClient.sendMessage(
          chatId,
          appendSubmenuBackInstruction(
            `*Menu Manajemen Engagement*\n${instaLabel}\n${tiktokLabel}\n\nKetik *angka menu* di atas, *menu* untuk kembali, atau *batal* untuk keluar.`
          )
        );
        return;
      }
    }
    
    // Invalid menu selection
    const menuNumbers = Object.keys(menuMapping).map(Number);
    const maxMenuNumber = menuNumbers.length > 0 ? Math.max(...menuNumbers) : 1;
    await waClient.sendMessage(
      chatId,
      `Menu tidak dikenal. Balas angka 1-${maxMenuNumber} atau ketik *batal* untuk keluar.`
    );
  },

  kelolaUser_menu: async (session, chatId, text, waClient, pool, userModel) => {
    const clean = () => {
      delete session.addUser;
      delete session.availableSatfung;
      delete session.updateStatusNRP;
      delete session.absensi_update_client_id;
    };
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      clean();
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    if (/^1$/i.test(text.trim())) {
      clean();
      session.step = "addUser_nrp";
      await waClient.sendMessage(
        chatId,
        "➕ *Tambah User Baru*\nMasukkan NRP/NIP (belum terdaftar):"
      );
      return;
    }
    if (/^2$/i.test(text.trim())) {
      clean();
      session.step = "updateData_nrp";
      await waClient.sendMessage(
        chatId,
        "✏️ *Update Data User*\nMasukkan NRP/NIP user yang ingin diupdate:"
      );
      return;
    }
    if (/^3$/i.test(text.trim())) {
      clean();
      session.step = "updateStatus_nrp";
      await waClient.sendMessage(
        chatId,
        "🟢🔴 *Ubah Status User*\nMasukkan NRP/NIP user yang ingin diubah statusnya:"
      );
      return;
    }
    if (/^4$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "cekUser_chooseClient";
        return oprRequestHandlers.cekUser_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool,
          userModel
        );
      }
      session.step = "cekUser_nrp";
      await waClient.sendMessage(
        chatId,
        "🔍 *Cek Data User*\nMasukkan NRP/NIP user yang ingin dicek:"
      );
      return;
    }
    if (/^5$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "absensiReg_chooseClient";
        return oprRequestHandlers.absensiReg_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      session.step = "absensiReg_submenu";
      session.absensi_reg_client_id = null;
      return oprRequestHandlers.absensiReg_submenu(session, chatId, text, waClient, pool, userModel);
    }
    if (/^6$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "absensiUpdateData_chooseClient";
        return oprRequestHandlers.absensiUpdateData_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      session.step = "absensiUpdateData_report";
      session.absensi_update_client_id = null;
      return oprRequestHandlers.absensiUpdateData_report(
        session,
        chatId,
        text,
        waClient,
        pool,
        userModel
      );
    }
    await waClient.sendMessage(
      chatId,
      "Menu tidak dikenal. Balas angka 1-6, *menu* untuk kembali, atau ketik *batal* untuk keluar."
    );
  },

  kelolaEngagement_menu: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      delete session.absensi_engagement_client_id;
      delete session.absensi_engagement_type;
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    if (/^1$/i.test(text.trim())) {
      const access = await ensureEngagementMenuAccess(
        session,
        chatId,
        waClient,
        pool,
        { platform: "instagram" }
      );
      if (!access) {
        if (isAdminWhatsApp(chatId)) {
          delete session.selected_client_id;
        }
        session.step = "main";
        return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
      }
      session.step = "absensiEngagement_submenu";
      session.absensi_engagement_type = "likes";
      return oprRequestHandlers.absensiEngagement_submenu(
        session,
        chatId,
        text,
        waClient,
        pool,
        userModel
      );
    }
    if (/^2$/i.test(text.trim())) {
      const access = await ensureEngagementMenuAccess(
        session,
        chatId,
        waClient,
        pool,
        { platform: "tiktok" }
      );
      if (!access) {
        if (isAdminWhatsApp(chatId)) {
          delete session.selected_client_id;
        }
        session.step = "main";
        return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
      }
      session.step = "absensiEngagement_submenu";
      session.absensi_engagement_type = "komentar";
      return oprRequestHandlers.absensiEngagement_submenu(
        session,
        chatId,
        text,
        waClient,
        pool,
        userModel
      );
    }
    await waClient.sendMessage(
      chatId,
      "Menu tidak dikenal. Balas angka 1-2, *menu* untuk kembali, atau ketik *batal* untuk keluar."
    );
  },

  kelolaAmplifikasi_menu: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    if (/^1$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_tugas";
      await waClient.sendMessage(
        chatId,
        appendSubmenuBackInstruction(
          `*Menu Tugas Amplifikasi*\n1️⃣ Update tugas rutin\n2️⃣ Input tugas khusus\n\nKetik *angka menu* di atas, *menu* untuk kembali, atau *batal* untuk keluar.`
        )
      );
      return;
    }
    if (/^2$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_laporan";
      await waClient.sendMessage(
        chatId,
        appendSubmenuBackInstruction(
          `*Menu Laporan Amplifikasi*\n1️⃣ Laporan tugas rutin\n2️⃣ Laporan tugas khusus\n\nKetik *angka menu* di atas, *menu* untuk kembali, atau *batal* untuk keluar.`
        )
      );
      return;
    }
    await waClient.sendMessage(
      chatId,
      "Menu tidak dikenal. Balas angka 1-2, *menu* untuk kembali, atau ketik *batal* untuk keluar."
    );
  },

  kelolaAmplifikasi_tugas: async (session, chatId, text, waClient, pool, userModel) => {
    const clean = () => {
      delete session.addUser;
      delete session.availableSatfung;
      delete session.updateStatusNRP;
    };
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_menu";
      return oprRequestHandlers.kelolaAmplifikasi_menu(
        session,
        chatId,
        "",
        waClient,
        pool,
        userModel
      );
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      clean();
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    if (/^1$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "updateTugas_chooseClient";
        return oprRequestHandlers.updateTugas_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool,
          userModel
        );
      }
      session.step = "updateTugas";
      return oprRequestHandlers.updateTugas(session, chatId, text, waClient, pool, userModel);
    }
    if (/^2$/i.test(text.trim())) {
      clean();
      session.step = "tugasKhusus_link";
      await waClient.sendMessage(chatId, "Kirim link Instagram tugas khusus:");
      return;
    }
    await waClient.sendMessage(
      chatId,
      "Menu tidak dikenal. Balas angka 1-2, *menu* untuk kembali, atau ketik *batal* untuk keluar."
    );
  },

  kelolaAmplifikasi_laporan: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_menu";
      return oprRequestHandlers.kelolaAmplifikasi_menu(
        session,
        chatId,
        "",
        waClient,
        pool,
        userModel
      );
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    if (/^1$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_laporan_rutin";
      await waClient.sendMessage(
        chatId,
        appendSubmenuBackInstruction(
          `*Laporan Tugas Rutin*\n1️⃣ Rekap link harian\n2️⃣ Rekap link harian kemarin\n3️⃣ Rekap link per post\n4️⃣ Absensi amplifikasi user\n\nKetik *angka menu* di atas, *menu* untuk kembali, atau *batal* untuk keluar.`
        )
      );
      return;
    }
    if (/^2$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_laporan_khusus";
      await waClient.sendMessage(
        chatId,
        appendSubmenuBackInstruction(
          `*Laporan Tugas Khusus*\n1️⃣ Rekap link tugas khusus\n2️⃣ Rekap per post khusus\n3️⃣ Absensi amplifikasi khusus\n\nKetik *angka menu* di atas, *menu* untuk kembali, atau *batal* untuk keluar.`
        )
      );
      return;
    }
    await waClient.sendMessage(
      chatId,
      "Menu tidak dikenal. Balas angka 1-2, *menu* untuk kembali, atau ketik *batal* untuk keluar."
    );
  },

  kelolaAmplifikasi_laporan_rutin: async (session, chatId, text, waClient, pool, userModel) => {
    const clean = () => {
      delete session.addUser;
      delete session.availableSatfung;
      delete session.updateStatusNRP;
    };
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_laporan";
      return oprRequestHandlers.kelolaAmplifikasi_laporan(
        session,
        chatId,
        "",
        waClient,
        pool,
        userModel
      );
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      clean();
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    if (/^1$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLink_chooseClient";
        return oprRequestHandlers.rekapLink_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool,
          userModel
        );
      }
      session.step = "rekapLink";
      return oprRequestHandlers.rekapLink(session, chatId, text, waClient, pool, userModel);
    }
    if (/^2$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLinkKemarin_chooseClient";
        return oprRequestHandlers.rekapLinkKemarin_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool,
          userModel
        );
      }
      session.step = "rekapLinkKemarin";
      return oprRequestHandlers.rekapLinkKemarin(session, chatId, text, waClient, pool, userModel);
    }
    if (/^3$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLinkPerPost_chooseClient";
        return oprRequestHandlers.rekapLinkPerPost_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      session.step = "rekapLinkPerPost";
      return oprRequestHandlers.rekapLinkPerPost(session, chatId, text, waClient, pool, userModel);
    }
    if (/^4$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "absensiLink_chooseClient";
        return oprRequestHandlers.absensiLink_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      session.step = "absensiLink_submenu";
      session.absensi_client_id = null;
      return oprRequestHandlers.absensiLink_submenu(session, chatId, text, waClient, pool, userModel);
    }
    await waClient.sendMessage(
      chatId,
      "Menu tidak dikenal. Balas angka 1-4, *menu* untuk kembali, atau ketik *batal* untuk keluar."
    );
  },

  kelolaAmplifikasi_laporan_khusus: async (session, chatId, text, waClient, pool, userModel) => {
    const clean = () => {
      delete session.addUser;
      delete session.availableSatfung;
      delete session.updateStatusNRP;
    };
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "kelolaAmplifikasi_laporan";
      return oprRequestHandlers.kelolaAmplifikasi_laporan(
        session,
        chatId,
        "",
        waClient,
        pool,
        userModel
      );
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      clean();
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    if (/^1$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLinkKhusus_chooseClient";
        return oprRequestHandlers.rekapLinkKhusus_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      session.step = "rekapLinkKhusus";
      return oprRequestHandlers.rekapLinkKhusus(
        session,
        chatId,
        text,
        waClient,
        pool,
        userModel
      );
    }
    if (/^2$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLinkKhususPerPost_chooseClient";
        return oprRequestHandlers.rekapLinkKhususPerPost_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      session.step = "rekapLinkKhususPerPost";
      return oprRequestHandlers.rekapLinkKhususPerPost(
        session,
        chatId,
        text,
        waClient,
        pool,
        userModel
      );
    }
    if (/^3$/i.test(text.trim())) {
      clean();
      if (isAdminWhatsApp(chatId)) {
        session.step = "absensiLinkKhusus_chooseClient";
        return oprRequestHandlers.absensiLinkKhusus_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      session.step = "absensiLinkKhusus_submenu";
      session.absensi_client_id = null;
      return oprRequestHandlers.absensiLinkKhusus_submenu(
        session,
        chatId,
        text,
        waClient,
        pool,
        userModel
      );
    }
    await waClient.sendMessage(
      chatId,
      "Menu tidak dikenal. Balas angka 1-3, *menu* untuk kembali, atau ketik *batal* untuk keluar."
    );
  },

  // ==== TAMBAH USER ====
  addUser_nrp: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "🚫 Keluar dari proses tambah user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const nrp = text.trim().replace(/[^0-9a-zA-Z]/g, "");
    if (!nrp) {
      await waClient.sendMessage(chatId, "❌ NRP yang Anda masukkan tidak valid. Silakan masukkan ulang atau ketik *batal*.");
      return;
    }
    const existing = await userModel.findUserById(nrp);
    if (existing) {
      let msg = `⚠️ NRP/NIP *${nrp}* sudah terdaftar:\n`;
      msg += `  • Nama: *${existing.nama || "-"}*\n  • Pangkat: *${existing.title || "-"}*\n  • Satfung: *${existing.divisi || "-"}*\n  • Jabatan: *${existing.jabatan || "-"}*\n  • Status: ${existing.status ? "🟢 AKTIF" : "🔴 NONAKTIF"}\n`;
      await waClient.sendMessage(chatId, msg + "\nTidak bisa menambahkan user baru dengan NRP/NIP ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.addUser = { user_id: nrp, operator: true };
    session.step = "addUser_nama";
    await waClient.sendMessage(chatId, "Masukkan *Nama Lengkap* (huruf kapital):");
  },

  addUser_nama: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "🚫 Keluar dari proses tambah user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const nama = text.trim().toUpperCase();
    if (!nama) {
      await waClient.sendMessage(chatId, "❗ Nama tidak boleh kosong. Masukkan ulang:");
      return;
    }
    session.addUser.nama = nama;
    session.step = "addUser_pangkat";
    await waClient.sendMessage(chatId, "Masukkan *Pangkat* (huruf kapital, misal: BRIPKA):");
  },

  addUser_pangkat: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "🚫 Keluar dari proses tambah user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const pangkat = text.trim().toUpperCase();
    if (!pangkat) {
      await waClient.sendMessage(chatId, "❗ Pangkat tidak boleh kosong. Masukkan ulang:");
      return;
    }
    session.addUser.title = pangkat;
    session.step = "addUser_satfung";
    // List satfung khusus client ini
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.selected_client_id = clientId;
    session.addUser.client_id = clientId;
    const satfung = userModel.mergeStaticDivisions(
      await userModel.getAvailableSatfung(clientId)
    );
    const sorted = sortDivisionKeys(satfung);
    let msg = "*Pilih Satfung* (ketik nomor atau nama sesuai daftar):\n";
    msg += sorted.map((s, i) => ` ${i + 1}. ${s}`).join("\n");
    session.availableSatfung = sorted;
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg));
  },

  addUser_satfung: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "🚫 Keluar dari proses tambah user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const satfungList = userModel.mergeStaticDivisions(
      session.availableSatfung || []
    );
    let satfung = text.trim().toUpperCase();
    const upperList = satfungList.map((s) => s.toUpperCase());
    if (/^\d+$/.test(satfung)) {
      const idx = parseInt(satfung, 10) - 1;
      if (idx >= 0 && idx < satfungList.length) {
        satfung = satfungList[idx];
      } else {
        let msg = "❌ Satfung tidak valid! Pilih sesuai daftar:\n";
        msg += satfungList.map((s, i) => ` ${i + 1}. ${s}`).join("\n");
        await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg));
        return;
      }
    } else if (!upperList.includes(satfung)) {
      let msg = "❌ Satfung tidak valid! Pilih sesuai daftar:\n";
      msg += satfungList.map((s, i) => ` ${i + 1}. ${s}`).join("\n");
      await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg));
      return;
    }
    session.addUser.divisi = satfung;
    session.step = "addUser_jabatan";
    await waClient.sendMessage(chatId, "Masukkan *Jabatan* (huruf kapital, contoh: BAURMIN):");
  },

  addUser_jabatan: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "🚫 Keluar dari proses tambah user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const jabatan = text.trim().toUpperCase();
    if (!jabatan) {
      await waClient.sendMessage(chatId, "❗ Jabatan tidak boleh kosong. Masukkan ulang:");
      return;
    }
    session.addUser.jabatan = jabatan;
    session.addUser.status = true;
    session.addUser.exception = false;

    // Simpan ke DB
    try {
      await userModel.createUser(session.addUser);
      await waClient.sendMessage(
        chatId,
        `✅ *User baru berhasil ditambahkan:*\n━━━━━━━━━━━━━━━━━━━━━━
*NRP*: ${session.addUser.user_id}
*Nama*: ${session.addUser.nama}
*Pangkat*: ${session.addUser.title}
*Satfung*: ${session.addUser.divisi}
*Jabatan*: ${session.addUser.jabatan}
Status: 🟢 AKTIF, Exception: False
━━━━━━━━━━━━━━━━━━━━━━`
      );
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Gagal menambahkan user: ${err.message}`);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  // ==== UPDATE STATUS USER ====
  updateStatus_nrp: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "Keluar dari proses ubah status user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const nrp = text.trim().replace(/[^0-9a-zA-Z]/g, "");
    const clientId = await resolveClientId(session, chatId, pool);
    const user = clientId
      ? await userModel.findUserByIdAndClient(nrp, clientId)
      : await userModel.findUserById(nrp);
    if (!user) {
      await waClient.sendMessage(chatId, `❌ User dengan NRP/NIP *${nrp}* tidak ditemukan. Hubungi Opr Humas Polres Anda.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const roles = await userModel.getUserRoles(user.user_id);
    if (!hasOperatorRole(roles)) {
      await waClient.sendMessage(
        chatId,
        `❌ User dengan NRP/NIP *${nrp}* tidak memiliki role operator.`
      );
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    let statusStr = user.status ? "🟢 *AKTIF*" : "🔴 *NONAKTIF*";
    const roleStr = roles.length ? roles.join(", ") : "-";
    let msg = `
━━━━━━━━━━━━━━━━━━━━━━
👤 *Data User* ━━━━━━━━━━

*NRP/NIP*   : ${user.user_id}
*Nama*      : ${user.nama || "-"}
*Pangkat*   : ${user.title || "-"}
*Satfung*   : ${user.divisi || "-"}
*Jabatan*   : ${user.jabatan || "-"}
*Status*    : ${statusStr}
*Role Aktif*: ${roleStr}
━━━━━━━━━━━━━━━━━━━━━━

Status baru yang akan di-set:
1. 🟢 *AKTIF*
2. 🔴 *NONAKTIF*

Balas *angka* (1/2) sesuai status baru, atau *batal* untuk keluar.
`.trim();

    session.updateStatusNRP = nrp;
    session.updateStatusRoles = roles;
    delete session.updateStatusRoleChoice;
    session.step = "updateStatus_value";
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg));
  },

  rekapLink: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLink_chooseClient";
        return oprRequestHandlers.rekapLink_chooseClient(session, chatId, text, waClient, pool);
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const { getReportsTodayByClient } = await import("../../model/linkReportModel.js");
    const { getShortcodesTodayByClient } = await import("../../model/instaPostModel.js");
    const reports = await getReportsTodayByClient(clientId);
    const operatorIds = await getOperatorUserIds(userModel, clientId);
    if (!operatorIds.size) {
      await waClient.sendMessage(chatId, `Tidak ada user operator aktif untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const filteredReports = reports.filter((report) => operatorIds.has(report.user_id));
    if (!filteredReports || filteredReports.length === 0) {
      await waClient.sendMessage(chatId, `Tidak ada laporan link hari ini untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const shortcodes = await getShortcodesTodayByClient(clientId);
    const list = {
      facebook: [],
      instagram: [],
      twitter: [],
      tiktok: [],
      youtube: []
    };
    const users = new Set();
    filteredReports.forEach((r) => {
      users.add(r.user_id);
      if (r.facebook_link) list.facebook.push(r.facebook_link);
      if (r.instagram_link) list.instagram.push(r.instagram_link);
      if (r.twitter_link) list.twitter.push(r.twitter_link);
      if (r.tiktok_link) list.tiktok.push(r.tiktok_link);
      if (r.youtube_link) list.youtube.push(r.youtube_link);
    });
    const totalLinks =
      list.facebook.length +
      list.instagram.length +
      list.twitter.length +
      list.tiktok.length +
      list.youtube.length;

    const now = new Date();
    const hari = hariIndo[now.getDay()];
    const tanggal = now.toLocaleDateString("id-ID");
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });
    const salam = getGreeting();

    const { rows: nameRows } = await pool.query(
      "SELECT nama FROM clients WHERE client_id=$1 LIMIT 1",
      [clientId]
    );
    const clientName = nameRows[0]?.nama || clientId;

    const kontenLinks = shortcodes.map(
      sc => `https://www.instagram.com/p/${sc}`
    );

    let msg = `${salam}\n\n`;
    msg += `Mohon Ijin Melaporkan Pelaksanaan Tugas Amplifikasi *${clientName}* pada hari :\n`;
    msg += `Hari : ${hari}\n`;
    msg += `Tanggal : ${tanggal}\n`;
    msg += `Pukul : ${jam}\n\n`;

    msg += `Jumlah Konten Resmi Hari ini : ${shortcodes.length}\n`;
    if (kontenLinks.length > 0) {
      msg += `${kontenLinks.join("\n")}\n\n`;
    } else {
      msg += "-\n\n";
    }

    msg += `Jumlah Personil yang melaksnakan : ${users.size}\n`;
    msg += `Jumlah Total Link dari 5 Platform Sosial Media : ${totalLinks}\n\n`;

    msg += `Link Sebagai Berikut :\n`;
    msg += `Facebook (${list.facebook.length}):\n${list.facebook.join("\n") || "-"}`;
    msg += `\n\nInstagram (${list.instagram.length}):\n${list.instagram.join("\n") || "-"}`;
    msg += `\n\nTwitter (${list.twitter.length}):\n${list.twitter.join("\n") || "-"}`;
    msg += `\n\nTikTok (${list.tiktok.length}):\n${list.tiktok.join("\n") || "-"}`;
    msg += `\n\nYoutube (${list.youtube.length}):\n${list.youtube.join("\n") || "-"}`;
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkKemarin: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLinkKemarin_chooseClient";
        return oprRequestHandlers.rekapLinkKemarin_chooseClient(session, chatId, text, waClient, pool, userModel);
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const { getReportsYesterdayByClient } = await import("../../model/linkReportModel.js");
    const { getShortcodesYesterdayByClient } = await import("../../model/instaPostModel.js");
    const reports = await getReportsYesterdayByClient(clientId);
    const operatorIds = await getOperatorUserIds(userModel, clientId);
    if (!operatorIds.size) {
      await waClient.sendMessage(chatId, `Tidak ada user operator aktif untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const filteredReports = reports.filter((report) => operatorIds.has(report.user_id));
    if (!filteredReports || filteredReports.length === 0) {
      await waClient.sendMessage(chatId, `Tidak ada laporan link kemarin untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const shortcodes = await getShortcodesYesterdayByClient(clientId);
    const list = {
      facebook: [],
      instagram: [],
      twitter: [],
      tiktok: [],
      youtube: []
    };
    const users = new Set();
    filteredReports.forEach((r) => {
      users.add(r.user_id);
      if (r.facebook_link) list.facebook.push(r.facebook_link);
      if (r.instagram_link) list.instagram.push(r.instagram_link);
      if (r.twitter_link) list.twitter.push(r.twitter_link);
      if (r.tiktok_link) list.tiktok.push(r.tiktok_link);
      if (r.youtube_link) list.youtube.push(r.youtube_link);
    });
    const totalLinks =
      list.facebook.length +
      list.instagram.length +
      list.twitter.length +
      list.tiktok.length +
      list.youtube.length;

    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const hari = hariIndo[yesterday.getDay()];
    const tanggal = yesterday.toLocaleDateString("id-ID");
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });
    const salam = getGreeting();

    const { rows: nameRows } = await pool.query(
      "SELECT nama FROM clients WHERE client_id=$1 LIMIT 1",
      [clientId]
    );
    const clientName = nameRows[0]?.nama || clientId;

    const kontenLinks = shortcodes.map(
      sc => `https://www.instagram.com/p/${sc}`
    );

    let msg = `${salam}\n\n`;
    msg += `Mohon Ijin Melaporkan Pelaksanaan Tugas Amplifikasi *${clientName}* pada hari :\n`;
    msg += `Hari : ${hari}\n`;
    msg += `Tanggal : ${tanggal}\n`;
    msg += `Pukul : ${jam}\n\n`;

    msg += `Jumlah Konten Resmi Kemarin : ${shortcodes.length}\n`;
    if (kontenLinks.length > 0) {
      msg += `${kontenLinks.join("\n")}\n\n`;
    } else {
      msg += "-\n\n";
    }

    msg += `Jumlah Personil yang melaksnakan : ${users.size}\n`;
    msg += `Jumlah Total Link dari 5 Platform Sosial Media : ${totalLinks}\n\n`;

    msg += `Link Sebagai Berikut :\n`;
    msg += `Facebook (${list.facebook.length}):\n${list.facebook.join("\n") || "-"}`;
    msg += `\n\nInstagram (${list.instagram.length}):\n${list.instagram.join("\n") || "-"}`;
    msg += `\n\nTwitter (${list.twitter.length}):\n${list.twitter.join("\n") || "-"}`;
    msg += `\n\nTikTok (${list.tiktok.length}):\n${list.tiktok.join("\n") || "-"}`;
    msg += `\n\nYoutube (${list.youtube.length}):\n${list.youtube.join("\n") || "-"}`;
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkKhusus: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const { getReportsTodayByClient } = await import("../../model/linkReportKhususModel.js");
    const { getShortcodesTodayByClient } = await import("../../model/instaPostKhususModel.js");
    const reports = await getReportsTodayByClient(clientId, OPERATOR_ROLE);
    const operatorIds = await getOperatorUserIds(userModel, clientId);
    if (!operatorIds.size) {
      await waClient.sendMessage(chatId, `Tidak ada user operator aktif untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    if (!reports || reports.length === 0) {
      await waClient.sendMessage(chatId, `Tidak ada laporan link khusus hari ini untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const shortcodes = await getShortcodesTodayByClient(clientId);
    const list = { facebook: [], instagram: [], twitter: [], tiktok: [], youtube: [] };
    const users = new Set();
    reports.forEach((r) => {
      users.add(r.user_id);
      if (r.facebook_link) list.facebook.push(r.facebook_link);
      if (r.instagram_link) list.instagram.push(r.instagram_link);
      if (r.twitter_link) list.twitter.push(r.twitter_link);
      if (r.tiktok_link) list.tiktok.push(r.tiktok_link);
      if (r.youtube_link) list.youtube.push(r.youtube_link);
    });
    const totalLinks =
      list.facebook.length + list.instagram.length + list.twitter.length + list.tiktok.length + list.youtube.length;

    const now = new Date();
    const hari = hariIndo[now.getDay()];
    const tanggal = now.toLocaleDateString("id-ID");
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });
    const salam = getGreeting();
    const { rows: nameRows } = await pool.query(
      "SELECT nama FROM clients WHERE client_id=$1 LIMIT 1",
      [clientId]
    );
    const clientName = nameRows[0]?.nama || clientId;
    const kontenLinks = shortcodes.map((sc) => `https://www.instagram.com/p/${sc}`);
    let msg = `${salam}\n\n`;
    msg += `Mohon Ijin Melaporkan Pelaksanaan Tugas Amplifikasi Khusus *${clientName}* pada hari :\n`;
    msg += `Hari : ${hari}\n`;
    msg += `Tanggal : ${tanggal}\n`;
    msg += `Pukul : ${jam}\n\n`;
    msg += `Jumlah Konten Tugas Khusus : ${shortcodes.length}\n`;
    msg += kontenLinks.length ? `${kontenLinks.join("\n")}\n\n` : "-\n\n";
    msg += `Jumlah Personil yang melaksnakan : ${users.size}\n`;
    msg += `Jumlah Total Link dari 5 Platform Sosial Media : ${totalLinks}\n\n`;
    msg += `Link Sebagai Berikut :\n`;
    msg += `Facebook (${list.facebook.length}):\n${list.facebook.join("\n") || "-"}`;
    msg += `\n\nInstagram (${list.instagram.length}):\n${list.instagram.join("\n") || "-"}`;
    msg += `\n\nTwitter (${list.twitter.length}):\n${list.twitter.join("\n") || "-"}`;
    msg += `\n\nTikTok (${list.tiktok.length}):\n${list.tiktok.join("\n") || "-"}`;
    msg += `\n\nYoutube (${list.youtube.length}):\n${list.youtube.join("\n") || "-"}`;
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkPerPost: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLinkPerPost_chooseClient";
        return oprRequestHandlers.rekapLinkPerPost_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const { getShortcodesTodayByClient } = await import("../../model/instaPostModel.js");
    const shortcodes = await getShortcodesTodayByClient(clientId);
    if (!shortcodes.length) {
      await waClient.sendMessage(chatId, `Tidak ada tugas link post hari ini untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.rekapShortcodes = shortcodes;
    session.selected_client_id = clientId;
    let msg = `*Rekap Post List*\nBalas angka untuk pilih post:\n`;
    shortcodes.forEach((sc, i) => {
      msg += `${i + 1}. https://www.instagram.com/p/${sc}\n`;
    });
    session.step = "rekapLinkPerPost_action";
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
  },

  rekapLinkPerPost_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const shortcodes = session.rekapShortcodes || [];
    if (isNaN(idx) || !shortcodes[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    const sc = shortcodes[idx];
    const clientId = session.selected_client_id;
    const { getReportsTodayByShortcode } = await import("../../model/linkReportModel.js");
    const reports = await getReportsTodayByShortcode(clientId, sc);
    const operatorIds = await getOperatorUserIds(userModel, clientId);
    if (!operatorIds.size) {
      await waClient.sendMessage(chatId, `Tidak ada user operator aktif untuk client *${clientId}*.`);
      session.step = "main";
      delete session.rekapShortcodes;
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const filteredReports = reports.filter((report) => operatorIds.has(report.user_id));
    if (!filteredReports || filteredReports.length === 0) {
      await waClient.sendMessage(chatId, `Belum ada laporan link untuk post tersebut.`);
      session.step = "main";
      delete session.rekapShortcodes;
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const list = {
      facebook: [],
      instagram: [],
      twitter: [],
      tiktok: [],
      youtube: []
    };
    const users = new Set();
    filteredReports.forEach(r => {
      users.add(r.user_id);
      if (r.facebook_link) list.facebook.push(r.facebook_link);
      if (r.instagram_link) list.instagram.push(r.instagram_link);
      if (r.twitter_link) list.twitter.push(r.twitter_link);
      if (r.tiktok_link) list.tiktok.push(r.tiktok_link);
      if (r.youtube_link) list.youtube.push(r.youtube_link);
    });
    const totalLinks =
      list.facebook.length +
      list.instagram.length +
      list.twitter.length +
      list.tiktok.length +
      list.youtube.length;

    const now = new Date();
    const hari = hariIndo[now.getDay()];
    const tanggal = now.toLocaleDateString("id-ID");
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });
    const salam = getGreeting();

    const { rows: nameRows } = await pool.query(
      "SELECT nama FROM clients WHERE client_id=$1 LIMIT 1",
      [clientId]
    );
    const clientName = nameRows[0]?.nama || clientId;

    let msg = `${salam}\n\n`;
    msg += `Mohon Ijin Melaporkan Pelaksanaan Tugas Amplifikasi *${clientName}* pada hari :\n`;
    msg += `Hari : ${hari}\n`;
    msg += `Tanggal : ${tanggal}\n`;
    msg += `Pukul : ${jam}\n\n`;
    msg += `Link Post: https://www.instagram.com/p/${sc}\n\n`;
    msg += `Jumlah Personil yang melaksnakan : ${users.size}\n`;
    msg += `Jumlah Total Link dari 5 Platform Sosial Media : ${totalLinks}\n\n`;

    msg += `Link Sebagai Berikut :\n`;
    msg += `Facebook (${list.facebook.length}):\n${list.facebook.join("\n") || "-"}`;
    msg += `\n\nInstagram (${list.instagram.length}):\n${list.instagram.join("\n") || "-"}`;
    msg += `\n\nTwitter (${list.twitter.length}):\n${list.twitter.join("\n") || "-"}`;
    msg += `\n\nTikTok (${list.tiktok.length}):\n${list.tiktok.join("\n") || "-"}`;
    msg += `\n\nYoutube (${list.youtube.length}):\n${list.youtube.join("\n") || "-"}`;
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    delete session.rekapShortcodes;
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkKhususPerPost: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "rekapLinkKhususPerPost_chooseClient";
        return oprRequestHandlers.rekapLinkKhususPerPost_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const { getShortcodesTodayByClient } = await import("../../model/instaPostKhususModel.js");
    const shortcodes = await getShortcodesTodayByClient(clientId);
    if (!shortcodes.length) {
      await waClient.sendMessage(chatId, `Tidak ada tugas link post khusus hari ini untuk client *${clientId}*.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.rekapShortcodes = shortcodes;
    session.selected_client_id = clientId;
    let msg = `*Rekap Post Khusus*\nBalas angka untuk pilih post:\n`;
    shortcodes.forEach((sc, i) => {
      msg += `${i + 1}. https://www.instagram.com/p/${sc}\n`;
    });
    session.step = "rekapLinkKhususPerPost_action";
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
  },

  rekapLinkKhususPerPost_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const shortcodes = session.rekapShortcodes || [];
    if (isNaN(idx) || !shortcodes[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    const sc = shortcodes[idx];
    const clientId = session.selected_client_id;
    const { getReportsTodayByShortcode } = await import("../../model/linkReportKhususModel.js");
    const reports = await getReportsTodayByShortcode(clientId, sc, OPERATOR_ROLE);
    const operatorIds = await getOperatorUserIds(userModel, clientId);
    if (!operatorIds.size) {
      await waClient.sendMessage(chatId, `Tidak ada user operator aktif untuk client *${clientId}*.`);
      session.step = "main";
      delete session.rekapShortcodes;
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    if (!reports || reports.length === 0) {
      await waClient.sendMessage(chatId, `Belum ada laporan link untuk post tersebut.`);
      session.step = "main";
      delete session.rekapShortcodes;
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const list = { facebook: [], instagram: [], twitter: [], tiktok: [], youtube: [] };
    const users = new Set();
    reports.forEach(r => {
      users.add(r.user_id);
      if (r.facebook_link) list.facebook.push(r.facebook_link);
      if (r.instagram_link) list.instagram.push(r.instagram_link);
      if (r.twitter_link) list.twitter.push(r.twitter_link);
      if (r.tiktok_link) list.tiktok.push(r.tiktok_link);
      if (r.youtube_link) list.youtube.push(r.youtube_link);
    });
    const totalLinks =
      list.facebook.length +
      list.instagram.length +
      list.twitter.length +
      list.tiktok.length +
      list.youtube.length;

    const now = new Date();
    const hari = hariIndo[now.getDay()];
    const tanggal = now.toLocaleDateString("id-ID");
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });
    const salam = getGreeting();

    const { rows: nameRows } = await pool.query(
      "SELECT nama FROM clients WHERE client_id=$1 LIMIT 1",
      [clientId]
    );
    const clientName = nameRows[0]?.nama || clientId;

    let msg = `${salam}\n\n`;
    msg += `Mohon Ijin Melaporkan Pelaksanaan Tugas Amplifikasi *${clientName}* pada hari :\n`;
    msg += `Hari : ${hari}\n`;
    msg += `Tanggal : ${tanggal}\n`;
    msg += `Pukul : ${jam}\n\n`;
    msg += `Link Post: https://www.instagram.com/p/${sc}\n\n`;
    msg += `Jumlah Personil yang melaksnakan : ${users.size}\n`;
    msg += `Jumlah Total Link dari 5 Platform Sosial Media : ${totalLinks}\n\n`;

    msg += `Link Sebagai Berikut :\n`;
    msg += `Facebook (${list.facebook.length}):\n${list.facebook.join("\n") || "-"}`;
    msg += `\n\nInstagram (${list.instagram.length}):\n${list.instagram.join("\n") || "-"}`;
    msg += `\n\nTwitter (${list.twitter.length}):\n${list.twitter.join("\n") || "-"}`;
    msg += `\n\nTikTok (${list.tiktok.length}):\n${list.tiktok.join("\n") || "-"}`;
    msg += `\n\nYoutube (${list.youtube.length}):\n${list.youtube.join("\n") || "-"}`;
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    delete session.rekapShortcodes;
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  updateTugas: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "updateTugas_chooseClient";
        return oprRequestHandlers.updateTugas_chooseClient(session, chatId, text, waClient, pool);
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const { fetchAndStoreInstaContent } = await import("../fetchpost/instaFetchPost.js");
    try {
      await fetchAndStoreInstaContent(null, waClient, chatId, clientId);
      await waClient.sendMessage(chatId, `✅ Update tugas selesai untuk client *${clientId}*.`);
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Gagal update tugas IG: ${err.message}`);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  updateStatus_value: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "❎ Keluar dari proses update status user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    let status = null;
    if (text.trim() === "1") status = true;
    if (text.trim() === "2") status = false;
    if (status === null) {
      await waClient.sendMessage(chatId, "❗ Pilihan tidak valid. Balas 1 untuk *AKTIF* atau 2 untuk *NONAKTIF*.");
      return;
    }
    try {
      if (status === true) {
        await userModel.updateUserField(session.updateStatusNRP, "status", status);
        const user = await userModel.findUserById(session.updateStatusNRP);
        let statusStr = "🟢 *AKTIF*";
        let msg = `✅ *Status user berhasil diubah!*
━━━━━━━━━━━━━━━━━━━━━━
*NRP/NIP*   : ${user.user_id}
*Nama*      : ${user.nama || "-"}
*Status*    : ${statusStr}
━━━━━━━━━━━━━━━━━━━━━━`;
        await waClient.sendMessage(chatId, msg);
      } else {
        const roles = session.updateStatusRoles || (await userModel.getUserRoles(session.updateStatusNRP));
        if (roles.length > 1 && !session.updateStatusRoleChoice) {
          const choices = roles.map((role, index) => `${index + 1}. ${role}`).join("\n");
          session.step = "updateStatus_chooseRole";
          await waClient.sendMessage(
            chatId,
            appendSubmenuBackInstruction(
              `User memiliki lebih dari satu role. Pilih role yang akan dihapus:\n${choices}\n\nBalas angka atau ketik *batal* untuk keluar.`
            )
          );
          return;
        }
        const roleToRemove = session.updateStatusRoleChoice || roles[0] || null;
        const updatedUser = await userModel.deactivateRoleOrUser(session.updateStatusNRP, roleToRemove);
        const statusStr = updatedUser.status ? "🟢 *AKTIF*" : "🔴 *NONAKTIF*";
        const remainingRoles = await userModel.getUserRoles(session.updateStatusNRP);
        const activeRoles = remainingRoles.length ? remainingRoles.join(", ") : "-";
        const msg = `✅ *Status user berhasil diubah!*
━━━━━━━━━━━━━━━━━━━━━━
*NRP/NIP*   : ${updatedUser.user_id}
*Nama*      : ${updatedUser.nama || "-"}
*Role Diubah*: ${roleToRemove || "-"}
*Role Tersisa*: ${activeRoles}
*Status*    : ${statusStr}
━━━━━━━━━━━━━━━━━━━━━━`;
        await waClient.sendMessage(chatId, msg);
      }
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Gagal update status: ${err.message}`);
    }
    delete session.updateStatusRoleChoice;
    delete session.updateStatusRoles;
    delete session.updateStatusNRP;
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  updateStatus_chooseRole: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "Keluar dari proses ubah status user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const roles = session.updateStatusRoles || [];
    const index = parseInt(text.trim(), 10) - 1;
    if (Number.isNaN(index) || !roles[index]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Mohon balas dengan angka sesuai daftar role.");
      return;
    }
    const selectedRole = roles[index];
    try {
      const updatedUser = await userModel.deactivateRoleOrUser(session.updateStatusNRP, selectedRole);
      const remainingRoles = await userModel.getUserRoles(session.updateStatusNRP);
      const statusStr = updatedUser.status ? "🟢 *AKTIF*" : "🔴 *NONAKTIF*";
      const activeRoles = remainingRoles.length ? remainingRoles.join(", ") : "-";
      const msg = `✅ *Status user berhasil diubah!*
━━━━━━━━━━━━━━━━━━━━━━
*NRP/NIP*   : ${updatedUser.user_id}
*Nama*      : ${updatedUser.nama || "-"}
*Role Diubah*: ${selectedRole}
*Role Tersisa*: ${activeRoles}
*Status*    : ${statusStr}
━━━━━━━━━━━━━━━━━━━━━━`;
      await waClient.sendMessage(chatId, msg);
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Gagal update status: ${err.message}`);
    }
    delete session.updateStatusRoleChoice;
    delete session.updateStatusRoles;
    delete session.updateStatusNRP;
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  // ==== UPDATE DATA USER ====
  updateData_nrp: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "❎ Keluar dari proses update data.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const nrp = text.trim().replace(/[^0-9a-zA-Z]/g, "");
    const clientId = await resolveClientId(session, chatId, pool);
    const user = clientId
      ? await userModel.findUserByIdAndClient(nrp, clientId)
      : await userModel.findUserById(nrp);
    if (!user) {
      await waClient.sendMessage(chatId, `❌ User dengan NRP/NIP *${nrp}* tidak ditemukan.`);
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const roles = await userModel.getUserRoles(user.user_id);
    if (!hasOperatorRole(roles)) {
      await waClient.sendMessage(
        chatId,
        `❌ User dengan NRP/NIP *${nrp}* tidak memiliki role operator.`
      );
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.updateUserId = nrp;
    session.step = "updateData_chooseField";
    await waClient.sendMessage(chatId, formatUpdateFieldList());
  },

  updateData_chooseField: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const allowedFields = [
      { key: "nama", label: "Nama" },
      { key: "pangkat", label: "Pangkat" },
      { key: "satfung", label: "Satfung" },
      { key: "jabatan", label: "Jabatan" },
      { key: "whatsapp", label: "WhatsApp" },
      { key: "insta", label: "Instagram" },
      { key: "tiktok", label: "TikTok" },
      { key: "hapus_whatsapp", label: "Hapus WhatsApp" },
    ];

    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "❎ Keluar dari proses update data.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }

    if (!/^[1-8]$/.test(text.trim())) {
      await waClient.sendMessage(chatId, formatUpdateFieldList());
      return;
    }

    const idx = parseInt(text.trim()) - 1;
    const field = allowedFields[idx].key;
    session.updateField = field;

    if (field === "hapus_whatsapp") {
      session.step = "updateData_confirmDeleteWa";
      await waClient.sendMessage(
        chatId,
        "⚠️ Apakah Anda yakin ingin *menghapus nomor WhatsApp* user ini? Balas *ya* untuk menghapus, *tidak* untuk membatalkan."
      );
      return;
    }

    if (field === "pangkat") {
      const titles = await userModel.getAvailableTitles();
      if (titles && titles.length) {
        const sorted = sortTitleKeys(titles, titles);
        let msgList = sorted.map((t, i) => `${i + 1}. ${t}`).join("\n");
        session.availableTitles = sorted;
        await waClient.sendMessage(chatId, "Daftar pangkat yang dapat dipilih:\n" + msgList);
      }
    }
    if (field === "satfung") {
      let clientId = null;
      try {
        const user = await userModel.findUserById(session.updateUserId);
        clientId = user?.client_id || null;
      } catch (e) { console.error(e); }
      const satfung = userModel.mergeStaticDivisions(
        await userModel.getAvailableSatfung(clientId)
      );
      if (satfung && satfung.length) {
        const sorted = sortDivisionKeys(satfung);
        let msgList = sorted.map((s, i) => `${i + 1}. ${s}`).join("\n");
        session.availableSatfung = sorted;
        await waClient.sendMessage(chatId, "Daftar satfung yang dapat dipilih:\n" + msgList);
      }
    }

    session.step = "updateData_value";
    let extra = "";
    if (field === "pangkat") extra = " (pilih dari daftar pangkat)";
    else if (field === "satfung") extra = " (pilih dari daftar satfung)";
    else if (field === "insta") extra = " (masukkan link profil Instagram)";
    else if (field === "tiktok") extra = " (masukkan link profil TikTok)";
    await waClient.sendMessage(
      chatId,
      `Ketik nilai baru untuk field *${allowedFields[idx].label}*${extra}:`
    );
  },

  updateData_confirmDeleteWa: async (session, chatId, text, waClient, pool, userModel) => {
    const ans = text.trim().toLowerCase();
    if (ans === "ya") {
      await userModel.updateUserField(session.updateUserId, "whatsapp", "");
      await waClient.sendMessage(
        chatId,
        `✅ Nomor WhatsApp untuk NRP ${session.updateUserId} berhasil dihapus.`
      );
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    if (ans === "tidak") {
      session.step = "main";
      await waClient.sendMessage(chatId, "Dibatalkan. Nomor tidak dihapus.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    await waClient.sendMessage(chatId, "Balas *ya* untuk menghapus, *tidak* untuk membatalkan.");
  },

  updateData_value: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "❎ Keluar dari proses update data.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const user_id = session.updateUserId;
    let field = session.updateField;
    let value = text.trim();

    if (field === "pangkat") field = "title";
    if (field === "satfung") field = "divisi";

    if (field === "title") {
      const titles = session.availableTitles || (await userModel.getAvailableTitles());
      const normalizedTitles = titles.map((t) => t.toUpperCase());
      if (/^\d+$/.test(value)) {
        const idx = parseInt(value) - 1;
        if (idx >= 0 && idx < titles.length) {
          value = titles[idx];
        } else {
          const msgList = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
          await waClient.sendMessage(chatId, `❌ Pangkat tidak valid! Pilih sesuai daftar:\n${msgList}`);
          return;
        }
      } else if (!normalizedTitles.includes(value.toUpperCase())) {
        const msgList = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
        await waClient.sendMessage(chatId, `❌ Pangkat tidak valid! Pilih sesuai daftar:\n${msgList}`);
        return;
      }
    }
    if (field === "divisi") {
      let clientId = null;
      try {
        const user = await userModel.findUserById(session.updateUserId);
        clientId = user?.client_id || null;
      } catch (e) { console.error(e); }
      const satfungList = userModel.mergeStaticDivisions(
        session.availableSatfung || (await userModel.getAvailableSatfung(clientId))
      );
      const normalizedSatfung = satfungList.map((s) => s.toUpperCase());
      if (/^\d+$/.test(value)) {
        const idx = parseInt(value, 10) - 1;
        if (idx >= 0 && idx < satfungList.length) {
          value = satfungList[idx];
        } else {
          const msgList = satfungList.map((s, i) => `${i + 1}. ${s}`).join("\n");
          await waClient.sendMessage(chatId, `❌ Satfung tidak valid! Pilih sesuai daftar:\n${msgList}`);
          return;
        }
      } else if (!normalizedSatfung.includes(value.toUpperCase())) {
        const msgList = satfungList.map((s, i) => `${i + 1}. ${s}`).join("\n");
        await waClient.sendMessage(chatId, `❌ Satfung tidak valid! Pilih sesuai daftar:\n${msgList}`);
        return;
      }
    }
    if (field === "insta") {
      const igMatch = value.match(/^https?:\/\/(www\.)?instagram\.com\/([A-Za-z0-9._]+)/i);
      if (!igMatch) {
        await waClient.sendMessage(
          chatId,
          "❌ Format salah! Masukkan *link profil Instagram* (contoh: https://www.instagram.com/username)"
        );
        return;
      }
      value = igMatch[2];
    }
    if (field === "tiktok") {
      const ttMatch = value.match(/^https?:\/\/(www\.)?tiktok\.com\/@([A-Za-z0-9._]+)/i);
      if (!ttMatch) {
        await waClient.sendMessage(
          chatId,
          "❌ Format salah! Masukkan *link profil TikTok* (contoh: https://www.tiktok.com/@username)"
        );
        return;
      }
      value = "@" + ttMatch[2];
    }
    if (field === "whatsapp") {
      value = value.replace(/[^0-9]/g, "");
      const operatorWa = chatId.replace(/[^0-9]/g, "");
      if (value === operatorWa) {
        await waClient.sendMessage(
          chatId,
          "❌ Nomor WhatsApp operator tidak boleh disimpan pada data user. Masukkan nomor lain."
        );
        return;
      }
    }
    if (["nama", "title", "divisi", "jabatan"].includes(field)) value = value.toUpperCase();

    try {
      await userModel.updateUserField(user_id, field, value);
      if (field === "whatsapp" && value) {
        await saveContactIfNew(formatToWhatsAppId(value));
      }
      await waClient.sendMessage(
        chatId,
        `✅ Data *${field === "title" ? "pangkat" : field === "divisi" ? "satfung" : field}* untuk NRP ${user_id} berhasil diupdate menjadi *${value}*.`
      );
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Gagal update data: ${err.message}`);
    }
    delete session.availableTitles;
    delete session.availableSatfung;
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  // ===== ADMIN CHOOSE CLIENTS =====
  chooseClient_first: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, ignore);
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "chooseClient_first_action";
  },

  chooseClient_first_action: async (session, chatId, text, waClient, pool, userModel) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  rekapLink_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "rekapLink_chooseClient_action";
  },

  rekapLink_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "rekapLink";
    return oprRequestHandlers.rekapLink(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkKemarin_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "rekapLinkKemarin_chooseClient_action";
  },

  rekapLinkKemarin_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "rekapLinkKemarin";
    return oprRequestHandlers.rekapLinkKemarin(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkPerPost_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "rekapLinkPerPost_chooseClient_action";
  },

  rekapLinkPerPost_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "rekapLinkPerPost";
    return oprRequestHandlers.rekapLinkPerPost(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkKhusus_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "rekapLinkKhusus_chooseClient_action";
  },

  rekapLinkKhusus_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "rekapLinkKhusus";
    return oprRequestHandlers.rekapLinkKhusus(session, chatId, "", waClient, pool, userModel);
  },

  rekapLinkKhususPerPost_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "rekapLinkKhususPerPost_chooseClient_action";
  },

  rekapLinkKhususPerPost_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "rekapLinkKhususPerPost";
    return oprRequestHandlers.rekapLinkKhususPerPost(session, chatId, "", waClient, pool, userModel);
  },

  updateTugas_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "updateTugas_chooseClient_action";
  },

  updateTugas_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "updateTugas";
    return oprRequestHandlers.updateTugas(session, chatId, "", waClient, pool, userModel);
  },

  absensiLink_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "absensiLink_chooseClient_action";
  },

  absensiLink_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.absensi_client_id = clients[idx].client_id;
    session.step = "absensiLink_submenu";
    return oprRequestHandlers.absensiLink_submenu(session, chatId, "", waClient, pool, userModel);
  },

  absensiLinkKhusus_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "absensiLinkKhusus_chooseClient_action";
  },

  absensiLinkKhusus_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.absensi_client_id = clients[idx].client_id;
    session.step = "absensiLinkKhusus_submenu";
    return oprRequestHandlers.absensiLinkKhusus_submenu(session, chatId, "", waClient, pool, userModel);
  },

  absensiLink_submenu: async (session, chatId, text, waClient, pool, userModel) => {
    let clientId = session.absensi_client_id || (await resolveClientId(session, chatId, pool));
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "absensiLink_chooseClient";
        return oprRequestHandlers.absensiLink_chooseClient(session, chatId, text, waClient, pool);
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.absensi_client_id = clientId;
    let msg = appendSubmenuBackInstruction(
      `Pilih tipe laporan absensi link:\n1. Semua\n2. Sudah\n3. Belum\nBalas angka di atas.`
    );
    await waClient.sendMessage(chatId, msg);
    session.step = "absensiLink_menu";
  },

  absensiLink_menu: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const pilihan = parseInt(text.trim());
    const clientId = session.absensi_client_id;
    if (!clientId) {
      await waClient.sendMessage(chatId, "Client belum dipilih.");
      session.step = "main";
      return;
    }
    try {
      const { absensiLink } = await import("../fetchabsensi/link/absensiLinkAmplifikasi.js");
      let mode = null;
      if (pilihan === 1) mode = "all";
      else if (pilihan === 2) mode = "sudah";
      else if (pilihan === 3) mode = "belum";
      else {
        await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas 1-3.");
        return;
      }
      const msg = await absensiLink(clientId, { mode, roleFlag: OPERATOR_ROLE });
      await waClient.sendMessage(chatId, msg || "Data tidak ditemukan.");
    } catch (e) {
      await waClient.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  absensiLinkKhusus_submenu: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = session.absensi_client_id || (await resolveClientId(session, chatId, pool));
    if (!clientId) {
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.absensi_client_id = clientId;
    let msg = appendSubmenuBackInstruction(
      `Pilih tipe laporan absensi link khusus:\n1. Semua\n2. Sudah\n3. Belum\nBalas angka di atas.`
    );
    await waClient.sendMessage(chatId, msg);
    session.step = "absensiLinkKhusus_menu";
  },

  absensiLinkKhusus_menu: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const pilihan = parseInt(text.trim());
    const clientId = session.absensi_client_id;
    if (!clientId) {
      await waClient.sendMessage(chatId, "Client belum dipilih.");
      session.step = "main";
      return;
    }
    try {
      const { absensiLinkKhusus } = await import("../fetchabsensi/link/absensiLinkKhusus.js");
      let mode = null;
      if (pilihan === 1) mode = "all";
      else if (pilihan === 2) mode = "sudah";
      else if (pilihan === 3) mode = "belum";
      else {
        await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas 1-3.");
        return;
      }
      const msg = await absensiLinkKhusus(clientId, { mode, roleFlag: OPERATOR_ROLE });
      await waClient.sendMessage(chatId, msg || "Data tidak ditemukan.");
    } catch (e) {
      await waClient.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  absensiReg_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "absensiReg_chooseClient_action";
  },

  absensiReg_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.absensi_reg_client_id = clients[idx].client_id;
    session.step = "absensiReg_submenu";
    return oprRequestHandlers.absensiReg_submenu(session, chatId, "", waClient, pool, userModel);
  },

  absensiReg_submenu: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId = session.absensi_reg_client_id || (await resolveClientId(session, chatId, pool));
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "absensiReg_chooseClient";
        return oprRequestHandlers.absensiReg_chooseClient(session, chatId, text, waClient, pool);
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.absensi_reg_client_id = clientId;
    let msg = appendSubmenuBackInstruction(
      `Pilih tipe laporan absensi registrasi:\n1. Semua\n2. Sudah\n3. Belum\nBalas angka di atas.`
    );
    await waClient.sendMessage(chatId, msg);
    session.step = "absensiReg_menu";
  },

  absensiUpdateData_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "absensiUpdateData_chooseClient_action";
  },

  absensiUpdateData_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.absensi_update_client_id = clients[idx].client_id;
    session.step = "absensiUpdateData_report";
    return oprRequestHandlers.absensiUpdateData_report(
      session,
      chatId,
      "",
      waClient,
      pool,
      userModel
    );
  },

  absensiUpdateData_report: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId =
      session.absensi_update_client_id || (await resolveClientId(session, chatId, pool));
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "absensiUpdateData_chooseClient";
        return oprRequestHandlers.absensiUpdateData_chooseClient(
          session,
          chatId,
          text,
          waClient,
          pool
        );
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.absensi_update_client_id = clientId;
    try {
      const { absensiUpdateDataUsername } = await import(
        "../fetchabsensi/wa/absensiUpdateDataUsername.js"
      );
      const msg = await absensiUpdateDataUsername(clientId, OPERATOR_ROLE);
      await waClient.sendMessage(chatId, msg || "Data tidak ditemukan.");
    } catch (e) {
      await waClient.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  absensiEngagement_submenu: async (session, chatId, text, waClient, pool, userModel) => {
    const clientId =
      session.absensi_engagement_client_id || (await resolveClientId(session, chatId, pool));
    if (!clientId) {
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    session.absensi_engagement_client_id = clientId;
    await waClient.sendMessage(
      chatId,
      appendSubmenuBackInstruction(
        "Pilih tipe absensi engagement:\n1. Semua\n2. Sudah\n3. Belum\nBalas angka di atas."
      )
    );
    session.step = "absensiEngagement_menu";
  },

  absensiEngagement_menu: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(menu|kembali|back|0)$/i.test(text.trim())) {
      session.step = "kelolaEngagement_menu";
      return oprRequestHandlers.kelolaEngagement_menu(
        session,
        chatId,
        "",
        waClient,
        pool,
        userModel
      );
    }
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.menu = null;
      session.step = null;
      delete session.absensi_engagement_client_id;
      delete session.absensi_engagement_type;
      await waClient.sendMessage(chatId, "❎ Keluar dari menu operator.");
      return;
    }
    const pilihan = Number.parseInt(text.trim(), 10);
    const clientId = session.absensi_engagement_client_id;
    if (!clientId) {
      await waClient.sendMessage(chatId, "Client belum dipilih.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    let mode = null;
    if (pilihan === 1) mode = "all";
    else if (pilihan === 2) mode = "sudah";
    else if (pilihan === 3) mode = "belum";
    else {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas 1-3.");
      return;
    }
    let msg;
    let hasError = false;
    if (session.absensi_engagement_type === "likes") {
      const { absensiLikes } = await import(
        "../fetchabsensi/insta/absensiLikesInsta.js"
      );
      try {
        msg = await absensiLikes(clientId, { mode, roleFlag: OPERATOR_ROLE });
      } catch (error) {
        hasError = true;
        await waClient.sendMessage(chatId, `❌ Error: ${error.message}`);
      }
    } else if (session.absensi_engagement_type === "komentar") {
      const { absensiKomentar } = await import(
        "../fetchabsensi/tiktok/absensiKomentarTiktok.js"
      );
      try {
        msg = await absensiKomentar(clientId, { mode, roleFlag: OPERATOR_ROLE });
      } catch (error) {
        hasError = true;
        await waClient.sendMessage(chatId, `❌ Error: ${error.message}`);
      }
    } else {
      await waClient.sendMessage(chatId, "Jenis absensi engagement belum dipilih.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    if (!hasError) {
      await waClient.sendMessage(
        chatId,
        appendSubmenuBackInstruction(msg || "Data tidak ditemukan.")
      );
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  absensiReg_menu: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const pilihan = parseInt(text.trim());
    const clientId = session.absensi_reg_client_id;
    if (!clientId) {
      await waClient.sendMessage(chatId, "Client belum dipilih.");
      session.step = "main";
      return;
    }
    try {
      const { absensiRegistrasiWa } = await import("../fetchabsensi/wa/absensiRegistrasiWa.js");
      let mode = null;
      if (pilihan === 1) mode = "all";
      else if (pilihan === 2) mode = "sudah";
      else if (pilihan === 3) mode = "belum";
      else {
        await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas 1-3.");
        return;
      }
      const msg = await absensiRegistrasiWa(clientId, { mode, roleFlag: OPERATOR_ROLE });
      await waClient.sendMessage(chatId, msg || "Data tidak ditemukan.");
    } catch (e) {
      await waClient.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  tugasKhusus_link: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "❎ Batal tugas khusus.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    try {
      const { fetchSinglePostKhusus } = await import("../fetchpost/instaFetchPost.js");
      const post = await fetchSinglePostKhusus(text.trim(), clientId);
      const link = `https://www.instagram.com/p/${post.shortcode}`;
      await waClient.sendMessage(
        chatId,
        `✅ Fetch post tugas khusus selesai:\n${link}`
      );
    } catch (e) {
      await waClient.sendMessage(chatId, `❌ Gagal fetch: ${e.message}`);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  cekUser_chooseClient: async (session, chatId, text, waClient, pool) => {
    const rows = await pool.query(
      "SELECT client_id, nama FROM clients ORDER BY client_id"
    );
    const clients = rows.rows;
    if (!clients.length) {
      await waClient.sendMessage(chatId, "Tidak ada client terdaftar.");
      session.step = "main";
      return;
    }
    session.clientList = clients;
    let msg = `*Daftar Client*\nBalas angka untuk pilih client:\n`;
    clients.forEach((c, i) => {
      msg += `${i + 1}. *${c.client_id}* - ${c.nama}\n`;
    });
    await waClient.sendMessage(chatId, appendSubmenuBackInstruction(msg.trim()));
    session.step = "cekUser_chooseClient_action";
  },

  cekUser_chooseClient_action: async (
    session,
    chatId,
    text,
    waClient,
    pool,
    userModel
  ) => {
    const idx = parseInt(text.trim()) - 1;
    const clients = session.clientList || [];
    if (isNaN(idx) || !clients[idx]) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas angka sesuai daftar.");
      return;
    }
    session.selected_client_id = clients[idx].client_id;
    session.step = "cekUser_nrp";
    await waClient.sendMessage(
      chatId,
      "🔍 *Cek Data User*\nMasukkan NRP/NIP user yang ingin dicek:"
    );
  },

  // ==== CEK DATA USER ====
  cekUser_nrp: async (session, chatId, text, waClient, pool, userModel) => {
    if (/^(batal|cancel|exit)$/i.test(text.trim())) {
      session.step = "main";
      await waClient.sendMessage(chatId, "Keluar dari proses cek user.");
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }
    const nrp = text.trim().replace(/[^0-9a-zA-Z]/g, "");
    const clientId = await resolveClientId(session, chatId, pool);
    if (!clientId) {
      if (isAdminWhatsApp(chatId)) {
        session.step = "cekUser_chooseClient";
        return oprRequestHandlers.cekUser_chooseClient(session, chatId, text, waClient, pool);
      }
      await waClient.sendMessage(chatId, "❌ Client tidak ditemukan untuk nomor ini.");
      session.step = "main";
      return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
    }

    const user = await userModel.findUserByIdAndClient(nrp, clientId);
    if (!user) {
      await waClient.sendMessage(chatId, `❌ User dengan NRP/NIP *${nrp}* tidak ditemukan. Hubungi Opr Humas Polres Anda.`);
    } else {
      const roles = await userModel.getUserRoles(user.user_id);
      if (!hasOperatorRole(roles)) {
        await waClient.sendMessage(
          chatId,
          `❌ User dengan NRP/NIP *${nrp}* tidak memiliki role operator.`
        );
        session.step = "main";
        return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
      }
      let statusStr = user.status ? "🟢 *AKTIF*" : "🔴 *NONAKTIF*";
      let msg = `
━━━━━━━━━━━━━━━━━━━━━━
👤 *Data User* ━━━━━━━━━━

*NRP/NIP*   : ${user.user_id}
*Nama*      : ${user.nama || "-"}
*Pangkat*   : ${user.title || "-"}
*Satfung*   : ${user.divisi || "-"}
*Jabatan*   : ${user.jabatan || "-"}
*Status*    : ${statusStr}
━━━━━━━━━━━━━━━━━━━━━━
`.trim();
      await waClient.sendMessage(chatId, msg);
    }
    session.step = "main";
    return oprRequestHandlers.main(session, chatId, "", waClient, pool, userModel);
  },

  // ==== ACCOUNT LINKING FLOW ====
  link_choose_role: async (session, chatId, text, waClient, pool, userModel) => {
    const trimmedText = (text || "").trim();
    
    if (/^(batal|cancel|exit)$/i.test(trimmedText)) {
      session.menu = null;
      session.step = null;
      delete session.opr_clients;
      delete session.linking_wa_id;
      delete session.linking_role;
      await waClient.sendMessage(chatId, "❎ Penautan akun dibatalkan.");
      return;
    }
    
    let role = null;
    if (trimmedText === "1") {
      role = "operator";
    } else if (trimmedText === "2") {
      role = "super_admin";
    }
    
    if (!role) {
      await waClient.sendMessage(
        chatId,
        "❌ Pilihan tidak valid. Balas *1* untuk Operator atau *2* untuk Super Admin, atau *batal* untuk keluar."
      );
      return;
    }
    
    session.linking_role = role;
    session.step = "link_choose_client";
    
    // Show available clients
    const clients = Array.isArray(session.opr_clients) ? session.opr_clients : [];
    if (!clients.length) {
      await waClient.sendMessage(
        chatId,
        "❌ Tidak ada client bertipe ORG yang aktif untuk penautan."
      );
      delete session.opr_clients;
      delete session.linking_wa_id;
      delete session.linking_role;
      session.menu = null;
      session.step = null;
      return;
    }
    
    const roleLabel = role === "operator" ? "Operator" : "Super Admin";
    const items = clients
      .map((client, index) => {
        const label = client.nama ? `${client.client_id} - ${client.nama}` : client.client_id;
        return `${index + 1}. ${label}`;
      })
      .join("\n");
    
    const msg = `🔗 *Pilih Client untuk Penautan ${roleLabel}*

${items}

Balas *nomor* atau *client_id* untuk melanjutkan, atau *batal* untuk keluar.`;
    
    await waClient.sendMessage(chatId, msg);
  },

  link_choose_client: async (session, chatId, text, waClient, pool, userModel) => {
    const clients = Array.isArray(session.opr_clients) ? session.opr_clients : [];
    const trimmedText = (text || "").trim();
    
    if (/^(batal|cancel|exit)$/i.test(trimmedText)) {
      session.menu = null;
      session.step = null;
      delete session.opr_clients;
      delete session.linking_wa_id;
      delete session.linking_role;
      await waClient.sendMessage(chatId, "❎ Penautan akun dibatalkan.");
      return;
    }
    
    if (!clients.length) {
      await waClient.sendMessage(
        chatId,
        "❌ Tidak ada client yang dapat dipilih untuk penautan."
      );
      delete session.opr_clients;
      delete session.linking_wa_id;
      delete session.linking_role;
      session.menu = null;
      session.step = null;
      return;
    }
    
    let selectedClient = null;
    if (/^\d+$/.test(trimmedText)) {
      const index = Number.parseInt(trimmedText, 10);
      if (index >= 1 && index <= clients.length) {
        selectedClient = clients[index - 1];
      }
    }
    
    if (!selectedClient) {
      selectedClient = clients.find(
        (client) =>
          String(client.client_id || "").toLowerCase() === trimmedText.toLowerCase()
      );
    }
    
    if (!selectedClient) {
      await waClient.sendMessage(
        chatId,
        "❌ Pilihan client tidak valid. Balas nomor atau client_id yang tersedia."
      );
      return;
    }
    
    // Perform the linking
    const clientId = selectedClient.client_id;
    const waId = session.linking_wa_id;
    const role = session.linking_role;
    
    if (!waId || !role) {
      await waClient.sendMessage(
        chatId,
        "❌ Terjadi kesalahan dalam proses penautan. Silakan coba lagi dengan mengetik *oprrequest*."
      );
      delete session.opr_clients;
      delete session.linking_wa_id;
      delete session.linking_role;
      session.menu = null;
      session.step = null;
      return;
    }
    
    try {
      // Get current client data
      const { findById, update } = await import("../../model/clientModel.js");
      const client = await findById(clientId);
      
      if (!client) {
        await waClient.sendMessage(
          chatId,
          "❌ Client tidak ditemukan. Silakan coba lagi."
        );
        return;
      }
      
      // Update client based on role
      let updateData = {};
      let roleLabel = "";
      
      if (role === "operator") {
        updateData.client_operator = waId;
        roleLabel = "Operator";
      } else if (role === "super_admin") {
        // For super admin, append to existing list if there's already a value
        const existingSuper = client.client_super || "";
        const superList = existingSuper
          .split(/[,\s]+/)
          .filter(Boolean)
          .map(s => s.trim());
        
        if (!superList.includes(waId)) {
          superList.push(waId);
        }
        
        updateData.client_super = superList.join(", ");
        roleLabel = "Super Admin";
      }
      
      // Update the client
      const updated = await update(clientId, updateData);
      
      if (updated) {
        await waClient.sendMessage(
          chatId,
          `✅ *Penautan Berhasil!*

Nomor Anda telah ditautkan sebagai *${roleLabel}* untuk client *${clientId}*.

Anda sekarang dapat mengakses menu operator. Ketik *oprrequest* untuk memulai.`
        );
      } else {
        await waClient.sendMessage(
          chatId,
          "❌ Gagal melakukan penautan. Silakan coba lagi."
        );
      }
    } catch (error) {
      console.error("[link_choose_client] Error during linking:", error);
      await waClient.sendMessage(
        chatId,
        "❌ Terjadi kesalahan saat melakukan penautan. Silakan coba lagi nanti."
      );
    }
    
    // Clean up session
    delete session.opr_clients;
    delete session.linking_wa_id;
    delete session.linking_role;
    session.menu = null;
    session.step = null;
  },
};

export default oprRequestHandlers;

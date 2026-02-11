import { clearSession } from "../../utils/sessionsHelper.js";
import { appendSubmenuBackInstruction } from "./menuPromptHelpers.js";

const MAIN_MENU_MESSAGE = `┏━━━ *MENU WABOT DITBINMAS* ━━━
1️⃣ User Summary
2️⃣ Insta Summary
3️⃣ TikTok Summary
0️⃣ Keluar dari menu
┗━━━━━━━━━━━━━━━━━━━━━━━━━━
Ketik *angka menu* atau *batal* untuk keluar.`;

const SUB_MENU_OPTIONS = {
  userSummary: {
    title: "User Summary",
    responses: {
      1: "📈 *User Summary - Excel Data*\nLaporan Excel siap dibagikan kepada pimpinan.",
      2: "📊 *User Summary - Chart*\nGrafik rekap akan dikirim sesuai permintaan.",
      3: "📝 *User Summary - Narasi*\nNarasi ringkas disiapkan untuk laporan cepat.",
    },
  },
  instaSummary: {
    title: "Insta Summary",
    responses: {
      1: "📈 *Insta Summary - Excel Data*\nFile Excel performa Instagram akan tersedia.",
      2: "📊 *Insta Summary - Chart*\nVisualisasi capaian Instagram segera dikirim.",
      3: "📝 *Insta Summary - Narasi*\nNarasi performa Instagram disiapkan otomatis.",
    },
  },
  tiktokSummary: {
    title: "TikTok Summary",
    responses: {
      1: "📈 *TikTok Summary - Excel Data*\nData Excel TikTok akan dibagikan.",
      2: "📊 *TikTok Summary - Chart*\nGrafik perkembangan TikTok siap dikirim.",
      3: "📝 *TikTok Summary - Narasi*\nNarasi performa TikTok akan dirangkum.",
    },
  },
};

function buildSubMenuMessage(title) {
  return appendSubmenuBackInstruction(
    `*${title}*\n` +
      "1️⃣ Excel Data\n" +
      "2️⃣ Chart\n" +
      "3️⃣ Narasi\n" +
      "0️⃣ Kembali ke menu utama\n\n" +
      "Ketik angka menu atau *batal* untuk keluar."
  );
}

function handleSubMenuFactory(key) {
  const config = SUB_MENU_OPTIONS[key];
  return async function subMenuHandler(session, chatId, text, waClient) {
    const choice = (text || "").trim();
    if (!choice) {
      session.step = `${key}_menu`;
      session.time = Date.now();
      await waClient.sendMessage(chatId, buildSubMenuMessage(config.title));
      return;
    }

    if (choice === "0" || choice.toLowerCase() === "back") {
      session.step = "main";
      session.time = Date.now();
      await wabotDitbinmasHandlers.main(session, chatId, "", waClient);
      return;
    }

    if (!["1", "2", "3"].includes(choice)) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Ketik angka menu yang tersedia.");
      await subMenuHandler(session, chatId, "", waClient);
      return;
    }

    const response = config.responses[choice];
    await waClient.sendMessage(chatId, response);
    session.time = Date.now();
    await subMenuHandler(session, chatId, "", waClient);
  };
}

export const wabotDitbinmasHandlers = {
  async main(session, chatId, text, waClient) {
    const choice = (text || "").trim();
    if (!choice) {
      session.step = "main";
      session.time = Date.now();
      await waClient.sendMessage(chatId, MAIN_MENU_MESSAGE);
      return;
    }

    if (choice === "0" || choice.toLowerCase() === "back") {
      clearSession(chatId);
      await waClient.sendMessage(chatId, "✅ Menu Wabot Ditbinmas ditutup.");
      return;
    }

    if (!["1", "2", "3"].includes(choice)) {
      await waClient.sendMessage(chatId, "Pilihan tidak valid. Balas dengan angka menu yang tersedia.");
      await wabotDitbinmasHandlers.main(session, chatId, "", waClient);
      return;
    }

    const mapStep = {
      1: "userSummary_menu",
      2: "instaSummary_menu",
      3: "tiktokSummary_menu",
    };

    session.step = mapStep[choice];
    session.time = Date.now();
    await wabotDitbinmasHandlers[session.step](session, chatId, "", waClient);
  },
  userSummary_menu: handleSubMenuFactory("userSummary"),
  instaSummary_menu: handleSubMenuFactory("instaSummary"),
  tiktokSummary_menu: handleSubMenuFactory("tiktokSummary"),
};

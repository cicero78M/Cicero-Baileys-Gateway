// src/handler/userMenuHandlers.js

import {
  sortTitleKeys,
  sortDivisionKeys,
  getGreeting,
} from "../../utils/utilsHelper.js";
import { saveContactIfNew } from "../../service/googleContactsService.js";
import { formatToWhatsAppId, normalizeWhatsappNumber } from "../../utils/waHelper.js";
import {
  formatUserReport,
  formatFieldList,
  getFieldInfo,
  formatFieldUpdatePrompt,
  formatUpdateSuccess,
  formatOptionsList,
  getFieldDisplayName,
} from "./userMenuHelpers.js";
import {
  validateNRP,
  validateTextField,
  validateInstagram,
  validateTikTok,
  validateListSelection,
} from "./userMenuValidation.js";


export const SESSION_CLOSED_MESSAGE =
  "Terima kasih. Sesi ditutup. Ketik *userrequest* untuk memulai lagi.";

export const closeSession = async (
  session,
  chatId,
  waClient,
  message = SESSION_CLOSED_MESSAGE
) => {
  session.exit = true;
  await waClient.sendMessage(chatId, message);
};



// ===== Handler utama usermenu =====
export const userMenuHandlers = {
  main: async (session, chatId, _text, waClient, _pool, userModel) => {
    const pengirim = normalizeWhatsappNumber(chatId);
    console.log(`[userrequest] Looking up user: chatId=${chatId}, normalized=${pengirim}`);
    const userByWA = await userModel.findUserByWhatsApp(pengirim);

    if (userByWA) {
      console.log(`[userrequest] User found: user_id=${userByWA.user_id}, nama=${userByWA.nama}`);

      session.isDitbinmas = !!userByWA.ditbinmas;
      session.identityConfirmed = true;
      session.user_id = userByWA.user_id;
      const salam = getGreeting();
      
      // For registered users, directly show data and ask about updates
      const msgText = [
        `${salam}, Bapak/Ibu *${userByWA.nama || ""}*`,
        "",
        formatUserReport(userByWA),
        "",
        "Apakah Anda ingin melakukan perubahan data?",
        "Balas *ya* untuk update data, *tidak* untuk keluar, atau *batal* untuk menutup sesi.",
      ].join("\n");
      session.step = "tanyaUpdateMyData";
      await waClient.sendMessage(chatId, msgText.trim());
      return;
    }

    // No WhatsApp number registered, ask for NRP/NIP
    console.log(`[userrequest] User NOT found for normalized number: ${pengirim}`);
    session.step = "inputUserId";
    const msgText = [
      "🔐 *Registrasi Akun*",
      "",
      "Nomor WhatsApp Anda belum terdaftar dalam sistem.",
      "Untuk menampilkan data Anda, silakan ketik NRP/NIP Anda (hanya angka).",
      "",
      "Contoh: 87020990",
      "",
      "Ketik *batal* untuk keluar.",
    ].join("\n");
    await waClient.sendMessage(chatId, msgText);
  },

  // --- Konfirmasi identitas (lihat data)
  confirmUserByWaIdentity: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    if (answer === "ya") {
      session.identityConfirmed = true;
      session.step = "tanyaUpdateMyData";
      await waClient.sendMessage(
        chatId,
        [
          "✅ Identitas berhasil dikonfirmasi.",
          "",
          "Apakah Anda ingin melakukan perubahan data?",
          "Balas *ya* untuk update data atau *tidak* untuk keluar.",
        ].join("\n")
      );
    } else if (answer === "tidak" || answer === "batal") {
      await closeSession(session, chatId, waClient);
    } else {
      await waClient.sendMessage(
        chatId,
        "❌ Jawaban tidak dikenali.\n\nBalas *ya* jika data benar milik Anda, *tidak* jika bukan, atau *batal* untuk menutup sesi."
      );
    }
  },

  // --- Konfirmasi identitas untuk update data
  confirmUserByWaUpdate: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    if (answer === "ya") {
      session.identityConfirmed = true;
      session.updateUserId = session.user_id;
      session.step = "updateAskField";
      await waClient.sendMessage(chatId, formatFieldList(session.isDitbinmas));
      return;
    } else if (answer === "tidak" || answer === "batal") {
      await closeSession(session, chatId, waClient);
      return;
    }
    await waClient.sendMessage(
      chatId,
      "❌ Jawaban tidak dikenali.\n\nBalas *ya* untuk melanjutkan atau *batal* untuk menutup sesi."
    );
  },

  // --- Input User ID manual
  inputUserId: async (session, chatId, text, waClient, pool, userModel) => {
    const lower = text.trim().toLowerCase();
    if (lower === "batal") {
      session.exit = true;
      await waClient.sendMessage(chatId, "✅ Menu ditutup. Terima kasih.");
      return;
    }
    if (lower === "userrequest") {
      await userMenuHandlers.main(session, chatId, "", waClient, pool, userModel);
      return;
    }
    
    // Validate NRP/NIP using centralized validator
    const validation = validateNRP(text);
    if (!validation.valid) {
      await waClient.sendMessage(chatId, validation.error);
      return;
    }
    
    const digits = validation.digits;
    
    try {
      const user = await userModel.findUserById(digits);
      if (!user) {
        await waClient.sendMessage(
          chatId,
          [
            `❌ NRP/NIP *${digits}* tidak ditemukan.`,
            'Jika yakin benar, hubungi Opr Humas Polres Anda.',
            '',
            'Silakan masukkan NRP/NIP lain atau ketik *batal* untuk keluar.',
          ].join('\n')
        );
      } else {
        // Check if the account already has a different WhatsApp number linked
        const currentWA = normalizeWhatsappNumber(chatId);
        if (user.whatsapp && user.whatsapp !== '' && user.whatsapp !== currentWA) {
          await waClient.sendMessage(
            chatId,
            [
              `❌ NRP/NIP *${digits}* sudah terhubung dengan nomor WhatsApp lain.`,
              '',
              'Satu akun hanya dapat diakses dari satu nomor WhatsApp yang terdaftar.',
              'Jika Anda adalah pemilik akun dan nomor telah berubah, hubungi Operator Humas Polres Anda.',
              '',
              'Silakan masukkan NRP/NIP lain atau ketik *batal* untuk keluar.',
            ].join('\n')
          );
          return;
        }
        
        session.step = "confirmBindUser";
        session.bindUserId = digits;
        await waClient.sendMessage(
          chatId,
          [
            `✅ NRP/NIP *${digits}* ditemukan.`,
            '',
            'Nomor WhatsApp ini belum terdaftar. Apakah Anda ingin menghubungkannya dengan akun tersebut?',
            '',
            'Balas *ya* untuk menghubungkan atau *tidak* untuk membatalkan.',
          ].join('\n')
        );
        return;
      }
    } catch (err) {
      console.error('[userMenuHandlers] Error finding user:', err);
      await waClient.sendMessage(
        chatId,
        [
          '❌ Terjadi kesalahan saat mengambil data. Silakan coba lagi.',
          '',
          'Silakan masukkan NRP/NIP lain atau ketik *batal* untuk keluar.',
        ].join('\n')
      );
    }
  },

  confirmBindUser: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    const waNum = normalizeWhatsappNumber(chatId);
    console.log(`[userrequest] Binding: chatId=${chatId}, normalized=${waNum}`);
    if (answer === "ya") {
      try {
        const user_id = session.bindUserId;
        console.log(`[userrequest] Storing WhatsApp ${waNum} for user ${user_id}`);
        await userModel.updateUserField(user_id, "whatsapp", waNum);
        
        try {
          await saveContactIfNew(formatToWhatsAppId(waNum));
        } catch (err) {
          console.error('[confirmBindUser] Error saving contact:', err);
          // Non-critical, continue
        }
        
        const user = await userModel.findUserById(user_id);
        console.log(`[userrequest] Binding successful. User record now has whatsapp=${user.whatsapp}`);
        session.isDitbinmas = !!user.ditbinmas;
        await waClient.sendMessage(
          chatId,
          [
            `✅ *Berhasil Terhubung*`,
            "",
            `Nomor WhatsApp telah dihubungkan ke NRP/NIP *${user_id}*.`,
            "",
            "Berikut data Anda:",
            "",
            formatUserReport(user),
          ].join("\n")
        );
        session.identityConfirmed = true;
        session.user_id = user_id;
        session.step = "tanyaUpdateMyData";
        await waClient.sendMessage(
          chatId,
          [
            "Apakah Anda ingin melakukan perubahan data?",
            "Balas *ya* untuk update data atau *tidak* untuk keluar.",
          ].join("\n")
        );
      } catch (err) {
        console.error('[confirmBindUser] Error binding user:', err);
        const errorMessage = err.message.includes('sudah terdaftar')
          ? `❌ ${err.message}. Satu nomor WhatsApp hanya dapat digunakan untuk satu akun.`
          : "❌ Terjadi kesalahan saat menghubungkan nomor. Silakan coba lagi dengan ketik *userrequest*.";
        await waClient.sendMessage(chatId, errorMessage);
        session.exit = true;
      }
      return;
    }
    if (answer === "tidak" || answer === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Proses dibatalkan. Nomor WhatsApp tidak dihubungkan.\n\nKetik *userrequest* untuk mencoba lagi atau hubungi operator jika membutuhkan bantuan."
      );
      session.exit = true;
      return;
    }
    await waClient.sendMessage(
      chatId,
      "❌ Jawaban tidak dikenali.\n\nBalas *ya* untuk menghubungkan nomor atau *tidak* untuk membatalkan."
    );
  },

  confirmBindUpdate: async (session, chatId, text, waClient, pool, userModel) => {
    const ans = text.trim().toLowerCase();
    const waNum = normalizeWhatsappNumber(chatId);
    if (ans === "ya") {
      try {
        const nrp = session.updateUserId;
        await userModel.updateUserField(nrp, "whatsapp", waNum);
        
        try {
          await saveContactIfNew(formatToWhatsAppId(waNum));
        } catch (err) {
          console.error('[confirmBindUpdate] Error saving contact:', err);
          // Non-critical, continue
        }
        
        await waClient.sendMessage(chatId, `✅ Nomor berhasil dihubungkan ke NRP/NIP *${nrp}*.`);
        session.identityConfirmed = true;
        session.user_id = nrp;
        session.step = "updateAskField";
        await waClient.sendMessage(chatId, formatFieldList(session.isDitbinmas));
      } catch (err) {
        console.error('[confirmBindUpdate] Error updating WhatsApp field:', err);
        const errorMessage = err.message.includes('sudah terdaftar')
          ? `❌ ${err.message}. Satu nomor WhatsApp hanya dapat digunakan untuk satu akun.`
          : "❌ Terjadi kesalahan saat menghubungkan nomor. Silakan coba lagi dengan ketik *userrequest*.";
        await waClient.sendMessage(chatId, errorMessage);
        session.exit = true;
      }
      return;
    }
    if (ans === "tidak" || ans === "batal") {
      await waClient.sendMessage(
        chatId,
        "✅ Proses dibatalkan. Nomor WhatsApp tidak dihubungkan.\n\nKetik *userrequest* untuk kembali ke menu atau hubungi operator jika membutuhkan bantuan."
      );
      session.exit = true;
      return;
    }
    await waClient.sendMessage(
      chatId,
      "❌ Jawaban tidak dikenali.\n\nBalas *ya* untuk menghubungkan nomor atau *tidak* untuk membatalkan."
    );
  },

  // --- Pilih field update
  updateAskField: async (session, chatId, text, waClient, pool, userModel) => {
    const allowedFields = [
      { key: "nama", label: "Nama" },
      { key: "pangkat", label: "Pangkat" },
      { key: "satfung", label: "Satfung" },
      { key: "jabatan", label: "Jabatan" },
      { key: "insta", label: "Instagram" },
      { key: "tiktok", label: "TikTok" },
    ];
    if (session.isDitbinmas) {
      allowedFields.push({ key: "desa", label: "Desa Binaan" });
    }

    const lower = text.trim().toLowerCase();
    const maxOption = allowedFields.length;
    if (lower === "batal") {
      session.exit = true;
      await waClient.sendMessage(chatId, "✅ Menu ditutup. Terima kasih.");
      return;
    }
    if (!new RegExp(`^[1-${maxOption}]$`).test(lower)) {
      await waClient.sendMessage(
        chatId,
        "❌ Pilihan tidak valid. Balas dengan angka sesuai daftar (contoh: 1) atau ketik *batal* untuk keluar."
      );
      await waClient.sendMessage(chatId, formatFieldList(session.isDitbinmas));
      return;
    }

    const idx = parseInt(lower) - 1;
    const field = allowedFields[idx].key;
    session.updateField = field;
    
    // Get current user data to show current value
    let currentUser = null;
    try {
      currentUser = await userModel.findUserById(session.updateUserId);
    } catch (e) {
      console.error('[updateAskField] Error fetching user:', e);
    }

    // Tampilkan list pangkat/satfung jika perlu
    if (field === "pangkat") {
      const titles = await userModel.getAvailableTitles();
      if (titles && titles.length) {
        const sorted = sortTitleKeys(titles, titles);
        // Simpan list pangkat di session agar bisa dipakai saat validasi
        session.availableTitles = sorted;
        const listMsg = formatOptionsList(sorted, "Daftar pangkat yang dapat dipilih");
        await waClient.sendMessage(chatId, listMsg);
      }
    }
    if (field === "satfung") {
      let clientId = null;
      try {
        const user = await userModel.findUserById(session.updateUserId);
        clientId = user?.client_id || null;
      } catch (e) { console.error('[updateAskField] Error fetching clientId:', e); }
      const satfung = userModel.mergeStaticDivisions(
        await userModel.getAvailableSatfung(clientId)
      );
      if (satfung && satfung.length) {
        const sorted = sortDivisionKeys(satfung);
        session.availableSatfung = sorted;
        const listMsg = formatOptionsList(sorted, "Daftar satfung yang dapat dipilih");
        await waClient.sendMessage(chatId, listMsg);
      }
    }
    
    session.step = "updateAskValue";
    
    // Show prompt with current value
    const fieldInfo = getFieldInfo(field, currentUser);
    const prompt = formatFieldUpdatePrompt(field, allowedFields[idx].label, fieldInfo.value);
    await waClient.sendMessage(chatId, prompt);
  },

  updateAskValue: async (session, chatId, text, waClient, pool, userModel) => {
    const lower = text.trim().toLowerCase();
    if (lower === "batal") {
      session.exit = true;
      await waClient.sendMessage(chatId, "✅ Perubahan dibatalkan. Ketik *userrequest* untuk memulai lagi.");
      return;
    }
    const user_id = session.updateUserId;
    let field = session.updateField;
    let value = text.trim();

    // Normalisasi field DB
    const dbField = field === "pangkat" ? "title" : field === "satfung" ? "divisi" : field;

    // Validasi khusus per field dengan centralized validators
    try {
      if (dbField === "title") {
        const titles = session.availableTitles || (await userModel.getAvailableTitles());
        const validation = validateListSelection(value, titles);
        if (!validation.valid) {
          await waClient.sendMessage(chatId, validation.error);
          return;
        }
        value = validation.selected;
      } else if (dbField === "divisi") {
        let clientId = null;
        try {
          const user = await userModel.findUserById(session.updateUserId);
          clientId = user?.client_id || null;
        } catch (e) { 
          console.error('[updateAskValue] Error fetching clientId:', e); 
        }
        const satfungList = userModel.mergeStaticDivisions(
          session.availableSatfung || (await userModel.getAvailableSatfung(clientId))
        );
        const validation = validateListSelection(value, satfungList);
        if (!validation.valid) {
          await waClient.sendMessage(chatId, validation.error);
          return;
        }
        value = validation.selected;
      } else if (dbField === "insta") {
        const validation = validateInstagram(value);
        if (!validation.valid) {
          await waClient.sendMessage(chatId, validation.error);
          return;
        }
        value = validation.username;
        
        // Check for duplicate Instagram
        const existing = await userModel.findUserByInsta(value);
        if (existing && existing.user_id !== user_id) {
          await waClient.sendMessage(
            chatId,
            "❌ Akun Instagram tersebut sudah terdaftar pada pengguna lain. Silakan gunakan akun lain atau ketik *batal* untuk membatalkan."
          );
          return;
        }
      } else if (dbField === "tiktok") {
        const validation = validateTikTok(value);
        if (!validation.valid) {
          await waClient.sendMessage(chatId, validation.error);
          return;
        }
        value = validation.username;
        
        // Check for duplicate TikTok
        const existing = await userModel.findUserByTiktok(value);
        if (existing && existing.user_id !== user_id) {
          await waClient.sendMessage(
            chatId,
            "❌ Akun TikTok tersebut sudah terdaftar pada pengguna lain. Silakan gunakan akun lain atau ketik *batal* untuk membatalkan."
          );
          return;
        }
      } else if (dbField === "whatsapp") {
        value = normalizeWhatsappNumber(value);
      } else if (["nama", "jabatan", "desa"].includes(dbField)) {
        const validation = validateTextField(dbField, value);
        if (!validation.valid) {
          await waClient.sendMessage(chatId, validation.error);
          return;
        }
        value = validation.value;
      }

      // Update database with proper error handling
      await userModel.updateUserField(user_id, dbField, value);
      
      // Save contact if WhatsApp field was updated
      if (dbField === "whatsapp" && value) {
        try {
          await saveContactIfNew(formatToWhatsAppId(value));
        } catch (err) {
          console.error('[updateAskValue] Error saving contact:', err);
          // Non-critical error, continue
        }
      }
      
      // Format display value
      const displayValue = (dbField === "insta" || dbField === "tiktok") ? `@${value}` : value;
      const fieldDisplayName = getFieldDisplayName(dbField);
      
      const successMsg = formatUpdateSuccess(fieldDisplayName, displayValue, user_id);
      await waClient.sendMessage(chatId, successMsg);
      
      // Clean up session data
      delete session.availableTitles;
      delete session.availableSatfung;
      
      // Return to main menu
      await userMenuHandlers.main(session, chatId, "", waClient, pool, userModel);
      
    } catch (err) {
      console.error('[updateAskValue] Error updating field:', err);
      await waClient.sendMessage(
        chatId,
        "❌ Terjadi kesalahan saat memperbarui data. Silakan coba lagi atau ketik *batal* untuk keluar."
      );
    }
  },

  tanyaUpdateMyData: async (session, chatId, text, waClient, pool, userModel) => {
    const answer = text.trim().toLowerCase();
    if (answer === "ya") {
      session.step = "confirmUserByWaUpdate";
      await userMenuHandlers.confirmUserByWaUpdate(
        session,
        chatId,
        "ya",
        waClient,
        pool,
        userModel
      );
      return;
    } else if (answer === "tidak" || answer === "batal") {
      await closeSession(session, chatId, waClient);
      return;
    }
    await waClient.sendMessage(
      chatId,
      "❌ Jawaban tidak dikenali.\n\nBalas *ya* jika ingin update data, *tidak* untuk kembali, atau *batal* untuk menutup sesi."
    );
  },
};

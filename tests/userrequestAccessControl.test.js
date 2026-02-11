// Test userrequest access control when WhatsApp numbers are linked
import { jest } from "@jest/globals";

process.env.JWT_SECRET = "testsecret";
import { userMenuHandlers } from "../src/handler/menu/userMenuHandlers.js";

describe("userrequest access control with WhatsApp linking", () => {
  const chatId1 = "628111222333@s.whatsapp.net"; // Normalized: 628111222333
  const chatId2 = "628999888777@s.whatsapp.net"; // Normalized: 628999888777
  let waClient;

  beforeEach(() => {
    waClient = {
      sendMessage: jest.fn().mockResolvedValue(),
    };
  });

  test("user with linked WhatsApp can access their own data", async () => {
    const session = {};
    const userModel = {
      findUserByWhatsApp: jest.fn().mockResolvedValue({
        user_id: "87020990",
        nama: "BRIPKA SENO",
        whatsapp: "628111222333",
      }),
    };

    await userMenuHandlers.main(session, chatId1, "", waClient, null, userModel);

    expect(userModel.findUserByWhatsApp).toHaveBeenCalledWith("628111222333");
    expect(session.user_id).toBe("87020990");
    expect(session.identityConfirmed).toBe(true);
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("BRIPKA SENO")
    );
  });

  test("unregistered WhatsApp number prompts for NRP/NIP registration", async () => {
    const session = {};
    const userModel = {
      findUserByWhatsApp: jest.fn().mockResolvedValue(null),
    };

    await userMenuHandlers.main(session, chatId1, "", waClient, null, userModel);

    expect(userModel.findUserByWhatsApp).toHaveBeenCalledWith("628111222333");
    expect(session.step).toBe("inputUserId");
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("Nomor WhatsApp Anda belum terdaftar dalam sistem")
    );
  });

  test("inputUserId blocks access to account with different WhatsApp linked", async () => {
    const session = { step: "inputUserId" };
    const userModel = {
      findUserById: jest.fn().mockResolvedValue({
        user_id: "87020990",
        nama: "BRIPKA SENO",
        whatsapp: "628111222333", // Different from chatId2
      }),
    };

    await userMenuHandlers.inputUserId(
      session,
      chatId2, // Trying to access from different number
      "87020990",
      waClient,
      null,
      userModel
    );

    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId2,
      expect.stringContaining("sudah terhubung dengan nomor WhatsApp lain")
    );
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId2,
      expect.stringContaining("Satu akun hanya dapat diakses dari satu nomor WhatsApp")
    );
    expect(session.step).toBe("inputUserId"); // Should stay at same step
  });

  test("inputUserId allows binding to account without WhatsApp linked", async () => {
    const session = { step: "inputUserId" };
    const userModel = {
      findUserById: jest.fn().mockResolvedValue({
        user_id: "87020990",
        nama: "BRIPKA SENO",
        whatsapp: null, // No WhatsApp linked
      }),
    };

    await userMenuHandlers.inputUserId(
      session,
      chatId1,
      "87020990",
      waClient,
      null,
      userModel
    );

    expect(session.step).toBe("confirmBindUser");
    expect(session.bindUserId).toBe("87020990");
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("Apakah Anda ingin menghubungkannya dengan akun tersebut?")
    );
  });

  test("inputUserId allows binding to account with empty WhatsApp string", async () => {
    const session = { step: "inputUserId" };
    const userModel = {
      findUserById: jest.fn().mockResolvedValue({
        user_id: "87020990",
        nama: "BRIPKA SENO",
        whatsapp: "", // Empty string
      }),
    };

    await userMenuHandlers.inputUserId(
      session,
      chatId1,
      "87020990",
      waClient,
      null,
      userModel
    );

    expect(session.step).toBe("confirmBindUser");
    expect(session.bindUserId).toBe("87020990");
  });

  test("inputUserId allows access from same WhatsApp number already linked", async () => {
    const session = { step: "inputUserId" };
    const userModel = {
      findUserById: jest.fn().mockResolvedValue({
        user_id: "87020990",
        nama: "BRIPKA SENO",
        whatsapp: "628111222333", // Same as chatId1
      }),
    };

    await userMenuHandlers.inputUserId(
      session,
      chatId1,
      "87020990",
      waClient,
      null,
      userModel
    );

    expect(session.step).toBe("confirmBindUser");
    expect(session.bindUserId).toBe("87020990");
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("Apakah Anda ingin menghubungkannya dengan akun tersebut?")
    );
  });

  test("confirmBindUser shows proper error when WhatsApp is already in use", async () => {
    const session = { bindUserId: "12345678", step: "confirmBindUser" };
    const userModel = {
      updateUserField: jest.fn().mockRejectedValue(
        new Error("Nomor WhatsApp ini sudah terdaftar pada akun lain")
      ),
    };

    await userMenuHandlers.confirmBindUser(
      session,
      chatId1,
      "ya",
      waClient,
      null,
      userModel
    );

    expect(session.exit).toBe(true);
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("sudah terdaftar pada akun lain")
    );
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("Satu nomor WhatsApp hanya dapat digunakan untuk satu akun")
    );
  });

  test("confirmBindUpdate shows proper error when WhatsApp is already in use", async () => {
    const session = { updateUserId: "87020990", step: "confirmBindUpdate" };
    const userModel = {
      updateUserField: jest.fn().mockRejectedValue(
        new Error("Nomor WhatsApp ini sudah terdaftar pada akun lain")
      ),
    };

    await userMenuHandlers.confirmBindUpdate(
      session,
      chatId1,
      "ya",
      waClient,
      null,
      userModel
    );

    expect(session.exit).toBe(true);
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("sudah terdaftar pada akun lain")
    );
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId1,
      expect.stringContaining("Satu nomor WhatsApp hanya dapat digunakan untuk satu akun")
    );
  });
});

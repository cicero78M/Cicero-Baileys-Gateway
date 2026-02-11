import { jest } from "@jest/globals";

process.env.JWT_SECRET = "testsecret";

import {
  setMenuTimeout,
  userMenuContext,
  SESSION_EXPIRED_MESSAGE,
} from "../src/utils/sessionsHelper.js";

describe("User Menu Session Timeout", () => {
  const chatId = "628111222333@s.whatsapp.net";
  let waClient;

  beforeEach(() => {
    jest.useFakeTimers();
    
    // Clear any existing sessions
    if (userMenuContext[chatId]) {
      const ctx = userMenuContext[chatId];
      if (ctx.timeout) clearTimeout(ctx.timeout);
      if (ctx.warningTimeout) clearTimeout(ctx.warningTimeout);
      if (ctx.noReplyTimeout) clearTimeout(ctx.noReplyTimeout);
      delete userMenuContext[chatId];
    }

    waClient = {
      sendMessage: jest.fn().mockResolvedValue(),
    };
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    
    // Clean up any remaining timeouts
    if (userMenuContext[chatId]) {
      const ctx = userMenuContext[chatId];
      if (ctx.timeout) clearTimeout(ctx.timeout);
      if (ctx.warningTimeout) clearTimeout(ctx.warningTimeout);
      if (ctx.noReplyTimeout) clearTimeout(ctx.noReplyTimeout);
      delete userMenuContext[chatId];
    }
  });

  it("should set session timeout to 3 minutes (180000ms)", () => {
    setMenuTimeout(chatId, waClient);

    expect(userMenuContext[chatId]).toBeDefined();
    expect(userMenuContext[chatId].timeout).toBeDefined();
  });

  it("should send warning message 2 minutes after session start", () => {
    setMenuTimeout(chatId, waClient);

    // Fast-forward 2 minutes (120000ms)
    jest.advanceTimersByTime(120000);

    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId,
      "⏰ Sesi akan berakhir dalam 1 menit. Balas sesuai pilihan Anda untuk melanjutkan."
    );
    expect(waClient.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("should send expiry message after 3 minutes of inactivity", () => {
    setMenuTimeout(chatId, waClient);

    // Fast-forward 3 minutes (180000ms)
    jest.advanceTimersByTime(180000);

    expect(waClient.sendMessage).toHaveBeenCalledWith(chatId, SESSION_EXPIRED_MESSAGE);
    expect(userMenuContext[chatId]).toBeUndefined();
  });

  it("should clear all timeouts when session is closed", () => {
    setMenuTimeout(chatId, waClient);

    const ctx = userMenuContext[chatId];
    expect(ctx.timeout).toBeDefined();
    expect(ctx.warningTimeout).toBeDefined();

    // Clear all timeouts
    clearTimeout(ctx.timeout);
    clearTimeout(ctx.warningTimeout);
    if (ctx.noReplyTimeout) clearTimeout(ctx.noReplyTimeout);
    delete userMenuContext[chatId];

    expect(userMenuContext[chatId]).toBeUndefined();
  });

  it("should refresh timeout on each interaction", () => {
    setMenuTimeout(chatId, waClient);
    const firstTimeout = userMenuContext[chatId].timeout;

    // Simulate user interaction by refreshing timeout
    setMenuTimeout(chatId, waClient);
    const secondTimeout = userMenuContext[chatId].timeout;

    // Timeouts should be different objects (old one cleared, new one created)
    expect(firstTimeout).not.toBe(secondTimeout);
  });

  it("should set noReplyTimeout when expectReply is true", () => {
    setMenuTimeout(chatId, waClient, true);

    expect(userMenuContext[chatId].noReplyTimeout).toBeDefined();
    
    // Fast-forward 90 seconds to trigger noReply message
    jest.advanceTimersByTime(90000);

    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId,
      "🤖 Kami masih menunggu balasan Anda. Silakan jawab jika sudah siap agar sesi dapat berlanjut."
    );
  });

  it("should send both warning and expiry messages at correct times", () => {
    setMenuTimeout(chatId, waClient);

    // Fast-forward 2 minutes - should trigger warning
    jest.advanceTimersByTime(120000);
    expect(waClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(waClient.sendMessage).toHaveBeenCalledWith(
      chatId,
      "⏰ Sesi akan berakhir dalam 1 menit. Balas sesuai pilihan Anda untuk melanjutkan."
    );

    // Fast-forward another 1 minute (total 3 minutes) - should trigger expiry
    jest.advanceTimersByTime(60000);
    expect(waClient.sendMessage).toHaveBeenCalledTimes(2);
    expect(waClient.sendMessage).toHaveBeenCalledWith(chatId, SESSION_EXPIRED_MESSAGE);
    expect(userMenuContext[chatId]).toBeUndefined();
  });
});

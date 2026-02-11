import { jest } from "@jest/globals";

const mockNormalizeUserId = jest.fn();
const mockFormatNama = jest.fn();
const mockClearSession = jest.fn();

jest.unstable_mockModule("../src/utils/utilsHelper.js", () => ({
  normalizeUserId: mockNormalizeUserId,
  formatNama: mockFormatNama,
}));

jest.unstable_mockModule("../src/utils/sessionsHelper.js", () => ({
  clearSession: mockClearSession,
}));

let parseBulkStatusEntries;
let processBulkDeletionRequest;

beforeAll(async () => {
  ({ parseBulkStatusEntries, processBulkDeletionRequest } = await import(
    "../src/handler/wa/bulkDeletionHandler.js"
  ));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockNormalizeUserId.mockImplementation((value) => String(value).trim());
  mockFormatNama.mockImplementation((user) => user?.nama || "");
});

test("parseBulkStatusEntries parses template, fallback format, and deduplicates same user_id", () => {
  const text = [
    "Permohonan Penghapusan Data Personil - SATKER TEST",
    "1. Andi - 75020201 - mutasi",
    "2. pensiun (Budi) - 75020202",
    "Mohon nonaktifkan data Cici dengan NRP 75020202 karena mutasi.",
    "Tambahan: Dodi 75020203 alasan double data.",
  ].join("\n");

  const { headerLine, entries } = parseBulkStatusEntries(text);

  expect(headerLine).toBe("Permohonan Penghapusan Data Personil - SATKER TEST");
  expect(entries).toHaveLength(3);
  expect(entries[0]).toMatchObject({
    index: 1,
    name: "Andi",
    rawId: "75020201",
    normalizedId: "75020201",
    reason: "mutasi",
  });
  expect(entries[1]).toMatchObject({
    index: 2,
    name: "Budi",
    rawId: "75020202",
    normalizedId: "75020202",
    reason: "pensiun",
  });
  expect(entries[2]).toMatchObject({
    rawId: "75020203",
    normalizedId: "75020203",
  });
});

test("processBulkDeletionRequest executes bulk flow and sends summary", async () => {
  const session = { step: "bulkStatus_process" };
  const waClient = { sendMessage: jest.fn() };
  const userModel = {
    findUserById: jest.fn(async (userId) => {
      if (userId === "75020201") {
        return { user_id: userId, nama: "Andi", status: true, ditbinmas: true };
      }
      return null;
    }),
    deactivateRoleOrUser: jest.fn().mockResolvedValue({ status: false }),
    updateUserField: jest.fn().mockResolvedValue({}),
  };

  const input = [
    "Permohonan Penghapusan Data Personil - SATKER TEST",
    "1. Andi - 75020201 - mutasi",
    "2. Budi - 75020202 - pensiun",
  ].join("\n");

  const result = await processBulkDeletionRequest({
    session,
    chatId: "62812@c.us",
    text: input,
    waClient,
    userModel,
  });

  expect(result).toEqual({ processed: true });
  expect(userModel.deactivateRoleOrUser).toHaveBeenCalledWith("75020201", "ditbinmas");
  expect(userModel.updateUserField).toHaveBeenCalledWith("75020201", "whatsapp", "");
  expect(waClient.sendMessage).toHaveBeenCalledTimes(1);
  expect(waClient.sendMessage.mock.calls[0][1]).toContain("✅ Permintaan diproses untuk 1 personel:");
  expect(waClient.sendMessage.mock.calls[0][1]).toContain("❌ 1 entri gagal diproses:");
  expect(session.step).toBe("main");
  expect(mockClearSession).toHaveBeenCalledWith("62812@c.us");
});


test("processBulkDeletionRequest returns guided error for invalid header format", async () => {
  const session = { step: "bulkStatus_process" };
  const waClient = { sendMessage: jest.fn() };

  const result = await processBulkDeletionRequest({
    session,
    chatId: "62812@c.us",
    text: "Mohon hapus data personel berikut",
    waClient,
    userModel: { findUserById: jest.fn() },
  });

  expect(result).toEqual({ processed: false });
  expect(waClient.sendMessage).toHaveBeenCalledWith(
    "62812@c.us",
    expect.stringContaining("Format tidak valid")
  );
  expect(waClient.sendMessage).toHaveBeenCalledWith(
    "62812@c.us",
    expect.stringContaining("Permohonan Penghapusan Data Personil")
  );
  expect(session.step).toBe("main");
});

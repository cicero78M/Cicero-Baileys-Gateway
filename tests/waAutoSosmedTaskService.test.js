import { jest } from '@jest/globals';

const mockFindClientById = jest.fn();
const mockFetchSinglePostKhusus = jest.fn();
const mockFetchAndStoreSingleTiktokPost = jest.fn();
const mockGenerateSosmedTaskMessage = jest.fn();
const mockHandleFetchLikesInstagram = jest.fn();
const mockHandleFetchKomentarTiktokBatch = jest.fn();

jest.unstable_mockModule('../src/service/clientService.js', () => ({
  findClientById: mockFindClientById,
}));

jest.unstable_mockModule('../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchSinglePostKhusus: mockFetchSinglePostKhusus,
}));

jest.unstable_mockModule('../src/handler/fetchpost/tiktokFetchPost.js', () => ({
  fetchAndStoreSingleTiktokPost: mockFetchAndStoreSingleTiktokPost,
}));

jest.unstable_mockModule('../src/handler/fetchabsensi/sosmedTask.js', () => ({
  generateSosmedTaskMessage: mockGenerateSosmedTaskMessage,
}));

jest.unstable_mockModule('../src/handler/fetchengagement/fetchLikesInstagram.js', () => ({
  handleFetchLikesInstagram: mockHandleFetchLikesInstagram,
}));

jest.unstable_mockModule('../src/handler/fetchengagement/fetchCommentTiktok.js', () => ({
  handleFetchKomentarTiktokBatch: mockHandleFetchKomentarTiktokBatch,
}));

let handleAutoSosmedTaskMessageIfApplicable;

beforeAll(async () => {
  ({ handleAutoSosmedTaskMessageIfApplicable } = await import('../src/service/waAutoSosmedTaskService.js'));
});

beforeEach(() => {
  jest.clearAllMocks();

  mockFindClientById.mockResolvedValue({ nama: 'Ditintelkam' });
  mockFetchSinglePostKhusus.mockResolvedValue({ shortcode: 'IG123' });
  mockFetchAndStoreSingleTiktokPost.mockResolvedValue({ videoId: 'TT123' });
  mockGenerateSosmedTaskMessage.mockResolvedValue({ text: 'Pesan tugas test' });
});

describe('handleAutoSosmedTaskMessageIfApplicable', () => {
  test('mendeteksi format "Selamat siang komandan" dan memproses workflow', async () => {
    const waClient = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const text = `Selamat siang komandan\nMohon izin dibantu\nFollow\nSubscribe\nRepost\nhttps://instagram.com/p/abc123`;

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text,
      chatId: 'chat-1',
      waClient,
    });

    expect(result).toBe(true);
    expect(mockFindClientById).toHaveBeenCalledWith('DITINTELKAM');
    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith('https://instagram.com/p/abc123', 'DITINTELKAM');
    expect(mockGenerateSosmedTaskMessage).toHaveBeenCalledWith('DITINTELKAM', {
      skipTiktokFetch: true,
      skipLikesFetch: true,
    });
  });

  test('mendeteksi format "Selamat sore komandan, senior dan RR"', async () => {
    const waClient = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const text =
      'Selamat sore komandan, senior dan RR\nMohon izin dibantu\nFollow\nSubscribe\nRepost\nhttps://www.tiktok.com/@abc/video/123';

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text,
      chatId: 'chat-2',
      waClient,
    });

    expect(result).toBe(true);
    expect(mockFetchAndStoreSingleTiktokPost).toHaveBeenCalledWith(
      'DITINTELKAM',
      'https://www.tiktok.com/@abc/video/123'
    );
  });

  test('tidak mendeteksi pesan tanpa keyword inti', async () => {
    const waClient = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const text = 'Selamat siang komandan\nTolong bantu engagement hari ini ya.';

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text,
      chatId: 'chat-3',
      waClient,
    });

    expect(result).toBe(false);
    expect(mockFindClientById).not.toHaveBeenCalled();
    expect(mockGenerateSosmedTaskMessage).not.toHaveBeenCalled();
    expect(waClient.sendMessage).not.toHaveBeenCalled();
  });

  test('tetap mendeteksi pesan dengan markdown, bullet, dan zero-width chars', async () => {
    const waClient = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const text =
      '*Selamat sore komandan*\u200B\n• _Mohon izin dibantu_\n- Follow\n- Subscribe\n- Repost\nhttps://instagram.com/p/markdown123';

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text,
      chatId: 'chat-4',
      waClient,
    });

    expect(result).toBe(true);
    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith('https://instagram.com/p/markdown123', 'DITINTELKAM');
  });

  test('ketika format terdeteksi tapi URL IG/TikTok tidak ada, handler tidak memproses workflow berat', async () => {
    const waClient = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const text = 'Selamat siang komandan\nMohon izin dibantu\nFollow\nSubscribe\nRepost';

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text,
      chatId: 'chat-5',
      waClient,
    });

    expect(result).toBe(false);
    expect(mockFindClientById).not.toHaveBeenCalled();
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockFetchAndStoreSingleTiktokPost).not.toHaveBeenCalled();
    expect(mockGenerateSosmedTaskMessage).not.toHaveBeenCalled();
    expect(mockHandleFetchLikesInstagram).not.toHaveBeenCalled();
    expect(mockHandleFetchKomentarTiktokBatch).not.toHaveBeenCalled();
    expect(waClient.sendMessage).not.toHaveBeenCalled();
  });
});

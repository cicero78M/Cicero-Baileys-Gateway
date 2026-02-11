import { jest } from '@jest/globals';

const mockFindClientById = jest.fn();

jest.unstable_mockModule('../src/service/clientService.js', () => ({
  findClientById: mockFindClientById,
}));
jest.unstable_mockModule('../src/model/userModel.js', () => ({}));
jest.unstable_mockModule('../src/service/instaPostService.js', () => ({}));
jest.unstable_mockModule('../src/service/instaLikeService.js', () => ({}));
jest.unstable_mockModule('../src/service/tiktokPostService.js', () => ({}));
jest.unstable_mockModule('../src/service/tiktokCommentService.js', () => ({}));

let getClientProfile;

beforeAll(async () => {
  ({ getClientProfile } = await import('../src/controller/clientController.js'));
});

afterEach(() => {
  mockFindClientById.mockReset();
});

test('uses role client data for social media fields when non-operator org', async () => {
  mockFindClientById
    .mockResolvedValueOnce({
      client_id: 'ORG1',
      client_type: 'org',
      client_insta: 'orginsta',
      client_insta_status: false,
      client_tiktok: 'orgtiktok',
      client_tiktok_status: false,
      client_amplify_status: false,
    })
    .mockResolvedValueOnce({
      client_id: 'DITBINMAS',
      client_type: 'direktorat',
      client_insta: 'ditinsta',
      client_insta_status: true,
      client_tiktok: 'dittiktok',
      client_tiktok_status: true,
      client_amplify_status: true,
    });

  const req = { params: {}, query: { client_id: 'ORG1' }, body: {}, user: { role: 'ditbinmas' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { json, status };

  await getClientProfile(req, res, () => {});

  expect(mockFindClientById).toHaveBeenNthCalledWith(1, 'ORG1');
  expect(mockFindClientById).toHaveBeenNthCalledWith(2, 'DITBINMAS');
  expect(json).toHaveBeenCalledWith({
    success: true,
    client: expect.objectContaining({
      client_id: 'ORG1',
      client_type: 'org',
      client_insta: 'ditinsta',
      client_insta_status: true,
      client_tiktok: 'dittiktok',
      client_tiktok_status: true,
      client_amplify_status: true,
      level: null,
      tier: null,
      premium_tier: null,
    }),
  });
});

test('uses token client_id when not provided in request', async () => {
  mockFindClientById.mockResolvedValueOnce({ client_id: 'C1', client_type: 'org' });
  const req = { params: {}, query: {}, body: {}, user: { client_id: 'C1' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { json, status };

  await getClientProfile(req, res, () => {});

  expect(mockFindClientById).toHaveBeenCalledWith('C1');
  expect(json).toHaveBeenCalledWith({
    success: true,
    client: {
      client_id: 'C1',
      client_type: 'org',
      level: null,
      tier: null,
      premium_tier: null,
    },
  });
});

test('maps client_level to tier aliases in profile response', async () => {
  mockFindClientById.mockResolvedValueOnce({
    client_id: 'LEVEL1',
    client_type: 'org',
    client_level: 'Premium_1',
  });

  const req = { params: {}, query: { client_id: 'LEVEL1' }, body: {}, user: {} };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { json, status };

  await getClientProfile(req, res, () => {});

  expect(json).toHaveBeenCalledWith({
    success: true,
    client: {
      client_id: 'LEVEL1',
      client_type: 'org',
      client_level: 'Premium_1',
      level: 'Premium_1',
      tier: 'premium_1',
      premium_tier: 'premium_1',
    },
  });
});

test('allows ditintelkam role with ORG scope regardless of roleClient regional_id', async () => {
  mockFindClientById
    .mockResolvedValueOnce({
      client_id: 'BOJONEGORO',
      client_type: 'org',
      regional_id: 'JATIM',
      client_insta: 'bojonegoro_insta',
      client_insta_status: false,
      client_tiktok: 'bojonegoro_tiktok',
      client_tiktok_status: false,
      client_amplify_status: false,
    })
    .mockResolvedValueOnce({
      client_id: 'DITINTELKAM',
      client_type: 'direktorat',
      regional_id: 'DIFFERENT_REGION',
      client_insta: 'ditintelkam_insta',
      client_insta_status: true,
      client_tiktok: 'ditintelkam_tiktok',
      client_tiktok_status: true,
      client_amplify_status: true,
    });

  const req = {
    params: {},
    query: {
      client_id: 'BOJONEGORO',
      role: 'ditintelkam',
      scope: 'ORG',
      regional_id: 'JATIM',
    },
    body: {},
    user: {},
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { json, status };

  await getClientProfile(req, res, () => {});

  expect(mockFindClientById).toHaveBeenNthCalledWith(1, 'BOJONEGORO');
  expect(mockFindClientById).toHaveBeenNthCalledWith(2, 'DITINTELKAM');
  expect(json).toHaveBeenCalledWith({
    success: true,
    client: expect.objectContaining({
      client_id: 'BOJONEGORO',
      client_type: 'org',
      regional_id: 'JATIM',
      client_insta: 'ditintelkam_insta',
      client_insta_status: true,
      client_tiktok: 'ditintelkam_tiktok',
      client_tiktok_status: true,
      client_amplify_status: true,
    }),
  });
  expect(status).not.toHaveBeenCalled();
});

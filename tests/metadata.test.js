import { jest } from '@jest/globals';

let getMetadata;

beforeAll(async () => {
  const mod = await import('../src/controller/metaController.js');
  getMetadata = mod.getMetadata;
});

describe('getMetadata', () => {
  test('returns package info', async () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnThis();
    const res = { status, json };

    await getMetadata({}, res, () => {});

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.name).toBeDefined();
    expect(payload.data.version).toBeDefined();
  });
});

import { jest } from '@jest/globals';

const mockCreateDashboardPremiumRequest = jest.fn();
const mockSendDashboardPremiumRequestNotification = jest.fn();

jest.unstable_mockModule('../src/service/dashboardPremiumRequestService.js', () => ({
  createDashboardPremiumRequest: mockCreateDashboardPremiumRequest,
  confirmDashboardPremiumRequest: jest.fn(),
  findDashboardPremiumRequestByToken: jest.fn(),
  markDashboardPremiumRequestNotified: jest.fn(),
}));

jest.unstable_mockModule('../src/service/waService.js', () => ({
  __esModule: true,
  default: {},
  sendDashboardPremiumRequestNotification: mockSendDashboardPremiumRequestNotification,
}));

let createDashboardPremiumRequestController;

beforeAll(async () => {
  ({ createDashboardPremiumRequestController } = await import('../src/controller/dashboardPremiumRequestController.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSendDashboardPremiumRequestNotification.mockResolvedValue(false);
});

test('forwards conflict error without modification', async () => {
  const conflictError = new Error('Permintaan premium sebelumnya masih diproses');
  conflictError.statusCode = 409;
  conflictError.code = 'conflict';

  mockCreateDashboardPremiumRequest.mockRejectedValue(conflictError);

  const req = { body: {}, dashboardUser: { dashboard_user_id: 'user-1' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await createDashboardPremiumRequestController(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith(conflictError);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
});

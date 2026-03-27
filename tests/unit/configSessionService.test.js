import { jest } from '@jest/globals';

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

await jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: loggerMock
}));

const { ConfigSessionService } = await import('../../src/service/configSessionService.js');

describe('ConfigSessionService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await ConfigSessionService.resetAllSessions();
  });

  test('should transition a session into viewing_config with selected client state', async () => {
    const session = await ConfigSessionService.createSession('+6281234567890', '__pending__');

    const updatedSession = await ConfigSessionService.setViewingConfiguration(
      session.session_id,
      'CLIENT_001',
      { connection: { displayName: 'Connection Settings', parameters: [] } }
    );

    expect(updatedSession).toEqual(expect.objectContaining({
      session_id: session.session_id,
      client_id: 'CLIENT_001',
      current_stage: 'viewing_config',
      original_state: {
        connection: { displayName: 'Connection Settings', parameters: [] }
      }
    }));
  });

  test('should allow the viewing_config to selecting_group transition', async () => {
    const session = await ConfigSessionService.createSession('+6281234567890', '__pending__');
    await ConfigSessionService.setViewingConfiguration(session.session_id, 'CLIENT_001', {});

    const updatedSession = await ConfigSessionService.updateSessionStage(
      session.session_id,
      'selecting_group'
    );

    expect(updatedSession.current_stage).toBe('selecting_group');
  });

  test('should reject invalid stage transitions', async () => {
    const session = await ConfigSessionService.createSession('+6281234567890', '__pending__');

    await expect(
      ConfigSessionService.updateSessionStage(session.session_id, 'confirming_changes')
    ).rejects.toThrow('Invalid session stage transition: selecting_client -> confirming_changes');
  });
});

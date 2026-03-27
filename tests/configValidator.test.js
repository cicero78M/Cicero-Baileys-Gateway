import { ConfigValidator, InputParser } from '../src/utils/configValidator.js';

describe('ConfigValidator', () => {
  test('should validate supported configuration values', () => {
    expect(ConfigValidator.validateValue('connection.host', 'api.example.com').isValid).toBe(true);
    expect(ConfigValidator.validateValue('connection.port', '8080').isValid).toBe(true);
    expect(ConfigValidator.validateValue('message_handling.rate_limit', '40/minute').isValid).toBe(true);
  });

  test('should reject invalid configuration values with descriptive feedback', () => {
    const invalidHost = ConfigValidator.validateValue('connection.host', 'invalid host');
    const invalidTimeout = ConfigValidator.validateValue('connection.timeout', '500');

    expect(invalidHost.isValid).toBe(false);
    expect(invalidHost.error).toContain('Invalid format');

    expect(invalidTimeout.isValid).toBe(false);
    expect(invalidTimeout.error).toContain('Invalid value');
  });

  test('should normalize common configuration formats', () => {
    expect(ConfigValidator.normalizeValue('connection.host', 'API.EXAMPLE.COM ')).toBe('api.example.com');
    expect(ConfigValidator.normalizeValue('message_handling.rate_limit', '40 / minutes')).toBe('40/minute');
    expect(ConfigValidator.normalizeValue('notifications.status_alerts', 'Enabled')).toBe('true');
  });
});

describe('InputParser', () => {
  test('should parse yes and no tokens across supported languages', () => {
    expect(InputParser.parseYesNo('ya')).toBe(true);
    expect(InputParser.parseYesNo('modify')).toBe(true);
    expect(InputParser.parseYesNo('tidak')).toBe(false);
    expect(InputParser.parseYesNo('cancel')).toBe(false);
  });

  test('should parse bounded numeric selections', () => {
    expect(InputParser.parseSelection('2', 4)).toBe(2);
    expect(InputParser.parseSelection('9', 4)).toBeNull();
    expect(InputParser.parseSelection('abc', 4)).toBeNull();
  });
});

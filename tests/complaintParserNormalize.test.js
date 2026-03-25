import { jest } from '@jest/globals';

// Mock handleNormalizer to control what normalizeHandleValue returns
const normalizeHandleValueMock = jest.fn();

jest.unstable_mockModule('../src/utils/handleNormalizer.js', () => ({
  normalizeHandleValue: normalizeHandleValueMock,
}));

let parseComplaintMessage;

beforeAll(async () => {
  ({ parseComplaintMessage } = await import('../src/service/complaintParser.js'));
});

// Helper: build a valid "Pesan Komplain" block with a custom IG username
function buildComplaintText(igUsername) {
  return [
    '*Pesan Komplain*',
    'NRP: 12345',
    'Nama: John Doe',
    'Polres: Polres Test',
    `Username IG: ${igUsername}`,
  ].join('\n');
}

describe('complaintParser — normalizeUsername min-length guard', () => {
  beforeEach(() => {
    normalizeHandleValueMock.mockReset();
  });

  test("single char 'p' → normalizeHandleValue returns 'p' (len 1) → igUsername = ''", () => {
    normalizeHandleValueMock.mockReturnValue('p');
    const result = parseComplaintMessage(buildComplaintText('p'));
    expect(result.reporter.igUsername).toBe('');
  });

  test("two chars 'ab' → normalizeHandleValue returns 'ab' (len 2) → igUsername = ''", () => {
    normalizeHandleValueMock.mockReturnValue('ab');
    const result = parseComplaintMessage(buildComplaintText('ab'));
    expect(result.reporter.igUsername).toBe('');
  });

  test("three chars 'abc' → normalizeHandleValue returns 'abc' (len 3 → passes) → igUsername = 'abc'", () => {
    normalizeHandleValueMock.mockReturnValue('abc');
    const result = parseComplaintMessage(buildComplaintText('abc'));
    expect(result.reporter.igUsername).toBe('abc');
  });

  test("URL path segment: normalizeHandleValue returns 'p' (URL like /p/ABC123) → igUsername = ''", () => {
    // e.g. https://instagram.com/p/ABC123/ — normalizer extracts path 'p' which is invalid
    normalizeHandleValueMock.mockReturnValue('p');
    const result = parseComplaintMessage(buildComplaintText('https://instagram.com/p/ABC123/'));
    expect(result.reporter.igUsername).toBe('');
  });

  test("'@johndoe' → normalizeHandleValue returns 'johndoe' → igUsername = 'johndoe'", () => {
    normalizeHandleValueMock.mockReturnValue('johndoe');
    const result = parseComplaintMessage(buildComplaintText('@johndoe'));
    expect(result.reporter.igUsername).toBe('johndoe');
  });

  test("URL 'https://instagram.com/johndoe' → normalizeHandleValue returns 'johndoe' → igUsername = 'johndoe'", () => {
    normalizeHandleValueMock.mockReturnValue('johndoe');
    const result = parseComplaintMessage(buildComplaintText('https://instagram.com/johndoe'));
    expect(result.reporter.igUsername).toBe('johndoe');
  });

  test("'https://tiktok.com/@johndoe' → normalizeHandleValue returns 'johndoe' → igUsername = 'johndoe'", () => {
    normalizeHandleValueMock.mockReturnValue('johndoe');
    const result = parseComplaintMessage(buildComplaintText('https://tiktok.com/@johndoe'));
    expect(result.reporter.igUsername).toBe('johndoe');
  });

  test("URL with trailing slash + query string → normalizeHandleValue strips properly → passes if len >= 3", () => {
    normalizeHandleValueMock.mockReturnValue('username123');
    const result = parseComplaintMessage(buildComplaintText('https://instagram.com/username123/?hl=id'));
    expect(result.reporter.igUsername).toBe('username123');
  });

  test("bold WA marker '*johndoe*' → normalizeHandleValue returns 'johndoe' → igUsername = 'johndoe'", () => {
    normalizeHandleValueMock.mockReturnValue('johndoe');
    const result = parseComplaintMessage(buildComplaintText('*johndoe*'));
    expect(result.reporter.igUsername).toBe('johndoe');
  });

  test("italic WA marker '_johndoe_' → normalizeHandleValue returns 'johndoe' → igUsername = 'johndoe'", () => {
    normalizeHandleValueMock.mockReturnValue('johndoe');
    const result = parseComplaintMessage(buildComplaintText('_johndoe_'));
    expect(result.reporter.igUsername).toBe('johndoe');
  });

  test("empty normalizeHandleValue → igUsername = ''", () => {
    normalizeHandleValueMock.mockReturnValue('');
    const result = parseComplaintMessage(buildComplaintText('???'));
    expect(result.reporter.igUsername).toBe('');
  });

  test("null normalizeHandleValue → igUsername = ''", () => {
    normalizeHandleValueMock.mockReturnValue(null);
    const result = parseComplaintMessage(buildComplaintText('test'));
    expect(result.reporter.igUsername).toBe('');
  });
});

describe('complaintParser — Pesan Komplain header detection', () => {
  test("'*Pesan Komplain*' (bold) is recognized as complaint header", () => {
    normalizeHandleValueMock.mockReturnValue('johndoe');
    const result = parseComplaintMessage([
      '*Pesan Komplain*',
      'NRP: 12345',
      'Nama: John Doe',
      'Polres: Test',
      'Username IG: johndoe',
    ].join('\n'));
    expect(result.isComplaint).toBe(true);
  });

  test("plain 'Pesan Komplain' is recognized as complaint header", () => {
    normalizeHandleValueMock.mockReturnValue('johndoe');
    const result = parseComplaintMessage([
      'Pesan Komplain',
      'NRP: 99999',
      'Nama: Jane',
      'Polres: Test',
      'Username IG: johndoe',
    ].join('\n'));
    expect(result.isComplaint).toBe(true);
  });
});

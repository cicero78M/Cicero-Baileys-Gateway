import { jest } from '@jest/globals';

// Mock all dependencies
const mockGetLinkReports = jest.fn();
const mockFindLinkReportByShortcode = jest.fn();
const mockCreateLinkReport = jest.fn();
const mockUpdateLinkReport = jest.fn();
const mockDeleteLinkReport = jest.fn();
const mockFetchSinglePostKhusus = jest.fn();

jest.unstable_mockModule('../src/model/linkReportKhususModel.js', () => ({
  getLinkReports: mockGetLinkReports,
  findLinkReportByShortcode: mockFindLinkReportByShortcode,
  createLinkReport: mockCreateLinkReport,
  updateLinkReport: mockUpdateLinkReport,
  deleteLinkReport: mockDeleteLinkReport,
}));

jest.unstable_mockModule('../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchSinglePostKhusus: mockFetchSinglePostKhusus,
}));

let createLinkReport, updateLinkReport;

beforeAll(async () => {
  const controller = await import('../src/controller/linkReportKhususController.js');
  createLinkReport = controller.createLinkReport;
  updateLinkReport = controller.updateLinkReport;
});

beforeEach(() => {
  mockGetLinkReports.mockReset();
  mockFindLinkReportByShortcode.mockReset();
  mockCreateLinkReport.mockReset();
  mockUpdateLinkReport.mockReset();
  mockDeleteLinkReport.mockReset();
  mockFetchSinglePostKhusus.mockReset();
});

describe('createLinkReport', () => {
  test('rejects when client_id is missing', async () => {
    const req = {
      body: {
        instagram_link: 'https://www.instagram.com/p/ABC123/',
        user_id: '1'
      }
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'client_id is required',
        statusCode: 400
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when instagram_link is missing', async () => {
    const req = {
      body: { user_id: '1', client_id: 'POLRES' }
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'instagram_link is required',
        statusCode: 400
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when instagram_link is not a valid Instagram URL', async () => {
    const req = {
      body: {
        instagram_link: 'https://facebook.com/post/123',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'instagram_link must be a valid Instagram post URL',
        statusCode: 400
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when other social media links are provided', async () => {
    const req = {
      body: {
        instagram_link: 'https://www.instagram.com/p/ABC123/',
        facebook_link: 'https://facebook.com/post/123',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Only instagram_link is allowed for special assignment uploads',
        statusCode: 400
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('creates link report after successful metadata fetch', async () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123/';
    const expectedShortcode = 'ABC123';
    mockFetchSinglePostKhusus.mockResolvedValueOnce({
      shortcode: expectedShortcode,
      caption: 'Test caption'
    });
    mockCreateLinkReport.mockResolvedValueOnce({
      shortcode: expectedShortcode,
      instagram_link: instagramUrl
    });

    const req = {
      body: {
        instagram_link: instagramUrl,
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
    expect(mockCreateLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({
        instagram_link: instagramUrl,
        shortcode: expectedShortcode,
        facebook_link: null,
        twitter_link: null,
        tiktok_link: null,
        youtube_link: null,
        user_id: '1',
        client_id: 'POLRES'
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts Instagram reel URLs', async () => {
    const instagramUrl = 'https://www.instagram.com/reel/ABC123/';
    mockFetchSinglePostKhusus.mockResolvedValueOnce({
      shortcode: 'ABC123',
      caption: 'Test reel'
    });
    mockCreateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123',
      instagram_link: instagramUrl
    });

    const req = {
      body: {
        instagram_link: instagramUrl,
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
    expect(mockCreateLinkReport).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('handles RapidAPI fetch errors', async () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123/';
    const error = new Error('RapidAPI error');
    mockFetchSinglePostKhusus.mockRejectedValueOnce(error);

    const req = {
      body: {
        instagram_link: instagramUrl,
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const res = {};
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
    expect(next).toHaveBeenCalledWith(error);
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });
});

describe('updateLinkReport', () => {
  test('rejects when instagram_link is invalid', async () => {
    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        instagram_link: 'https://facebook.com/post/123',
        user_id: '1'
      }
    };
    const next = jest.fn();
    const res = {};

    await updateLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'instagram_link must be a valid Instagram post URL',
        statusCode: 400
      })
    );
    expect(mockUpdateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when other social media links are provided', async () => {
    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        instagram_link: 'https://www.instagram.com/p/ABC123/',
        twitter_link: 'https://twitter.com/post/123',
        user_id: '1'
      }
    };
    const next = jest.fn();
    const res = {};

    await updateLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Only instagram_link is allowed for special assignment updates',
        statusCode: 400
      })
    );
    expect(mockUpdateLinkReport).not.toHaveBeenCalled();
  });

  test('updates with valid Instagram link', async () => {
    const instagramUrl = 'https://www.instagram.com/p/XYZ789/';
    mockUpdateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123',
      instagram_link: instagramUrl
    });

    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        instagram_link: instagramUrl,
        user_id: '1'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await updateLinkReport(req, res, next);

    expect(mockUpdateLinkReport).toHaveBeenCalledWith(
      'ABC123',
      '1',
      expect.objectContaining({
        instagram_link: instagramUrl,
        facebook_link: null,
        twitter_link: null,
        tiktok_link: null,
        youtube_link: null
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('allows update without instagram_link', async () => {
    mockUpdateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123'
    });

    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        user_id: '1'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await updateLinkReport(req, res, next);

    expect(mockUpdateLinkReport).toHaveBeenCalledWith(
      'ABC123',
      '1',
      expect.objectContaining({
        facebook_link: null,
        twitter_link: null,
        tiktok_link: null,
        youtube_link: null
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

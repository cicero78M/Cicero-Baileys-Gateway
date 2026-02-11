import * as linkReportModel from '../model/linkReportKhususModel.js';
import { sendSuccess } from '../utils/response.js';
import { extractFirstUrl, extractInstagramShortcode } from '../utils/utilsHelper.js';
import { fetchSinglePostKhusus } from '../handler/fetchpost/instaFetchPost.js';

export async function getAllLinkReports(req, res, next) {
  try {
    const userId = req.query.user_id;
    const postId = req.query.post_id || req.query.shortcode;
    const data = await linkReportModel.getLinkReports({ userId, postId });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getLinkReportByShortcode(req, res, next) {
  try {
    const report = await linkReportModel.findLinkReportByShortcode(
      req.params.shortcode,
      req.query.user_id
    );
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function createLinkReport(req, res, next) {
  try {
    const data = { ...req.body };
    
    // Validate required fields first (fail fast)
    if (!data.client_id) {
      const error = new Error('client_id is required');
      error.statusCode = 400;
      throw error;
    }
    
    // Validate that Instagram link is provided
    if (!data.instagram_link) {
      const error = new Error('instagram_link is required');
      error.statusCode = 400;
      throw error;
    }
    
    // Extract and validate Instagram link format
    const instagramLink = extractFirstUrl(data.instagram_link);
    if (!instagramLink) {
      const error = new Error('instagram_link must be a valid URL');
      error.statusCode = 400;
      throw error;
    }
    
    const shortcode = extractInstagramShortcode(instagramLink);
    if (!shortcode) {
      const error = new Error('instagram_link must be a valid Instagram post URL');
      error.statusCode = 400;
      throw error;
    }
    
    // Ensure no other social media links are provided
    const otherLinks = ['facebook_link', 'twitter_link', 'tiktok_link', 'youtube_link'];
    const hasOtherLinks = otherLinks.some(field => data[field]);
    if (hasOtherLinks) {
      const error = new Error('Only instagram_link is allowed for special assignment uploads');
      error.statusCode = 400;
      throw error;
    }
    
    // Fetch and store Instagram post metadata via RapidAPI
    // The stored data will be referenced by createLinkReport using the shortcode
    await fetchSinglePostKhusus(instagramLink, data.client_id);
    
    // Create link report with validated Instagram link
    data.instagram_link = instagramLink;
    data.shortcode = shortcode;
    data.facebook_link = null;
    data.twitter_link = null;
    data.tiktok_link = null;
    data.youtube_link = null;
    
    const report = await linkReportModel.createLinkReport(data);
    sendSuccess(res, report, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateLinkReport(req, res, next) {
  try {
    const bodyData = { ...req.body };
    
    // Extract Instagram link from payload
    const instagramLink = bodyData.instagram_link ? extractFirstUrl(bodyData.instagram_link) : null;
    
    // Validate that the link is a valid Instagram post link if provided
    if (instagramLink) {
      const shortcode = extractInstagramShortcode(instagramLink);
      if (!shortcode) {
        const error = new Error('instagram_link must be a valid Instagram post URL');
        error.statusCode = 400;
        throw error;
      }
      bodyData.instagram_link = instagramLink;
    }
    
    // Ensure no other social media links are provided for special assignments
    const otherLinks = ['facebook_link', 'twitter_link', 'tiktok_link', 'youtube_link'];
    const hasOtherLinks = otherLinks.some(field => bodyData[field]);
    if (hasOtherLinks) {
      const error = new Error('Only instagram_link is allowed for special assignment updates');
      error.statusCode = 400;
      throw error;
    }
    
    // Set other social media links to null
    bodyData.facebook_link = null;
    bodyData.twitter_link = null;
    bodyData.tiktok_link = null;
    bodyData.youtube_link = null;
    
    const report = await linkReportModel.updateLinkReport(
      req.params.shortcode,
      bodyData.user_id,
      bodyData
    );
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function deleteLinkReport(req, res, next) {
  try {
    const report = await linkReportModel.deleteLinkReport(
      req.params.shortcode,
      req.query.user_id
    );
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

import * as linkReportModel from '../model/linkReportModel.js';
import { sendSuccess } from '../utils/response.js';
import {
  extractFirstUrl,
  getGreeting,
  formatNama,
} from '../utils/utilsHelper.js';
import { generateLinkReportExcelBuffer } from '../service/amplifyExportService.js';
import waClient, { waitForWaReady } from '../service/waService.js';
import { findUserById } from '../model/userModel.js';
import { formatToWhatsAppId, safeSendMessage } from '../utils/waHelper.js';

export async function getAllLinkReports(req, res, next) {
  try {
    const DEFAULT_LIMIT = 20;
    const DEFAULT_PAGE = 1;
    const userId = req.query.user_id;
    const postId = req.query.post_id || req.query.shortcode;

    const requestedLimit = parseInt(req.query.limit, 10);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : DEFAULT_LIMIT;

    let offset;
    if (req.query.offset !== undefined) {
      const requestedOffset = parseInt(req.query.offset, 10);
      offset = Number.isFinite(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
    } else {
      const requestedPage = parseInt(req.query.page, 10);
      const page =
        Number.isFinite(requestedPage) && requestedPage > 0
          ? requestedPage
          : DEFAULT_PAGE;
      offset = (page - 1) * limit;
    }

    const result = await linkReportModel.getLinkReports({
      limit,
      offset,
      userId,
      postId
    });

    const page = Math.floor(result.offset / result.limit) + 1;
    const totalPages = result.totalCount > 0 ? Math.ceil(result.totalCount / result.limit) : 0;

    sendSuccess(res, {
      items: result.rows,
      pagination: {
        total: result.totalCount,
        limit: result.limit,
        offset: result.offset,
        page,
        totalPages
      }
    });
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

export async function createLinkReport(req, res) {
  try {
    const data = { ...req.body };
    [
      'instagram_link',
      'facebook_link',
      'twitter_link',
      'tiktok_link',
      'youtube_link'
    ].forEach((f) => {
      if (data[f]) data[f] = extractFirstUrl(data[f]);
    });
    const report = await linkReportModel.createLinkReport(data);

    if (data.user_id) {
      try {
        await waitForWaReady();
        const user = await findUserById(data.user_id);
        if (user?.whatsapp) {
          const wid = formatToWhatsAppId(user.whatsapp);
          const greeting = getGreeting();
          const fullName = formatNama(user);
          const links = [
            report.facebook_link || 'Facebook Nihil',
            report.instagram_link || 'Instagram Nihil',
            report.twitter_link || 'Twitter Nihil',
            report.tiktok_link || 'Tiktok Nihil',
            report.youtube_link || 'Youtube Nihil',
          ]
            .map((l) => `- ${l}`)
            .join('\n');
          const msg =
            `${greeting},\n\n` +
            `Terimakasih, ${fullName}.\n` +
            `Anda sudah melaksanakan Tugas Amplifikasi Konten:\n` +
            `- https://www.instagram.com/p/${data.shortcode}\n\n` +
            `Link Amplifikasi Anda :\n` +
            `Jangan lupa simpan nomor WA Bot ini agar tetap menerima notifikasi tugas berikutnya.\n` +
            links;
          await safeSendMessage(waClient, wid, msg);
        }
      } catch (err) {
        console.warn(
          `[WA] Skipping link report notification: ${err.message}`
        );
      }
    }

    sendSuccess(res, report, 201);
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function updateLinkReport(req, res, next) {
  try {
    const bodyData = { ...req.body };
    [
      'instagram_link',
      'facebook_link',
      'twitter_link',
      'tiktok_link',
      'youtube_link'
    ].forEach((f) => {
      if (bodyData[f]) bodyData[f] = extractFirstUrl(bodyData[f]);
    });
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

export async function downloadMonthlyLinkReportExcel(req, res, next) {
  try {
    const clientId = req.query.client_id;
    if (!clientId) {
      return res
        .status(400)
        .json({ success: false, message: 'client_id wajib diisi' });
    }
    const rows = await linkReportModel.getReportsThisMonthByClient(clientId);
    const buffer = generateLinkReportExcelBuffer(rows);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="link_report.xlsx"'
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

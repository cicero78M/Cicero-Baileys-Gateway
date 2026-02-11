import * as tiktokPostService from '../service/tiktokPostService.js';
import * as tiktokCommentService from '../service/tiktokCommentService.js';
import * as clientService from '../service/clientService.js';
import { sendSuccess } from '../utils/response.js';
import {
  fetchTiktokProfile,
  fetchTiktokPosts,
  fetchTiktokPostsBySecUid,
  fetchTiktokInfo
} from '../service/tiktokApi.js';
import * as profileCache from '../service/profileCacheService.js';
import { formatTiktokCommentRecapResponse } from '../utils/tiktokCommentRecapFormatter.js';

const TIKTOK_PROFILE_URL_REGEX =
  /^https?:\/\/(www\.)?tiktok\.com\/@([A-Za-z0-9._]+)\/?(\?.*)?$/i;

function normalizeClientId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeClientIdLower(value) {
  const normalized = normalizeClientId(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function normalizeTikTokUsername(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(TIKTOK_PROFILE_URL_REGEX);
  const username = match ? match[2] : trimmed.replace(/^@/, '');
  const normalized = username?.toLowerCase();
  if (!normalized || !/^[a-z0-9._]{1,24}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export async function getTiktokComments(req, res, next) {
  try {
    const client_id =
      req.query.client_id ||
      req.user?.client_id ||
      req.headers['x-client-id'];
    if (!client_id) {
      return res
        .status(400)
        .json({ success: false, message: 'client_id wajib diisi' });
    }

    const posts = await tiktokPostService.findByClientId(client_id);
    let commentsData = [];
    for (const post of posts) {
      const comm = await tiktokCommentService.findByVideoId(post.video_id);
      commentsData.push({
        video_id: post.video_id,
        comment_count: Array.isArray(comm?.comments) ? comm.comments.length : 0,
        comments: comm?.comments || [],
      });
    }
    sendSuccess(res, commentsData);
  } catch (err) {
    next(err);
  }
}

export async function getTiktokPosts(req, res) {
  try {
    const client_id =
      req.query.client_id ||
      req.user?.client_id ||
      req.headers["x-client-id"];
    if (!client_id) {
      return res
        .status(400)
        .json({ success: false, message: "client_id wajib diisi" });
    }

    const posts = await tiktokPostService.findByClientId(client_id);
    sendSuccess(res, posts);
  } catch (err) {
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

import { getRekapKomentarByClient } from '../model/tiktokCommentModel.js';

export async function getTiktokRekapKomentar(req, res) {
  let client_id =
    req.query.client_id ||
    req.user?.client_id ||
    req.headers['x-client-id'];
  const periode = req.query.periode || 'harian';
  const tanggal = req.query.tanggal;
  const startDate = req.query.start_date || req.query.tanggal_mulai;
  const endDate = req.query.end_date || req.query.tanggal_selesai;
  const requestedRole = req.query.role || req.user?.role;
  const requestedScope = req.query.scope;
  const requestedRegionalId = req.query.regional_id || req.user?.regional_id;
  const regionalId = requestedRegionalId
    ? String(requestedRegionalId).trim().toUpperCase()
    : null;
  const roleLower = requestedRole ? String(requestedRole).toLowerCase() : null;
  const scopeLower = requestedScope
    ? String(requestedScope).toLowerCase()
    : null;
  const isOrgOperatorScope =
    scopeLower === 'org' && roleLower === 'operator';
  const directorateRoles = [
    'ditbinmas',
    'ditlantas',
    'bidhumas',
    'ditsamapta',
  ];
  const usesStandardPayload = Boolean(requestedScope || req.query.role);

  if (!usesStandardPayload && roleLower === 'ditbinmas') {
    client_id = 'ditbinmas';
  }
  if (isOrgOperatorScope && req.user?.client_id) {
    client_id = req.user.client_id;
  }

  const normalizedClientId = normalizeClientId(client_id);
  if (!normalizedClientId) {
    return res
      .status(400)
      .json({ success: false, message: 'client_id wajib diisi' });
  }
  client_id = normalizedClientId;
  const normalizedClientIdLower = normalizeClientIdLower(client_id);

  if (req.user?.client_ids) {
    const userClientIds = Array.isArray(req.user.client_ids)
      ? req.user.client_ids
      : [req.user.client_ids];
    const idsLower = userClientIds
      .map((c) => normalizeClientIdLower(c))
      .filter(Boolean);
    const matchesTokenClient =
      req.user?.client_id &&
      normalizeClientIdLower(req.user.client_id) === normalizedClientIdLower;
    if (
      !idsLower.includes(normalizedClientIdLower) &&
      !matchesTokenClient &&
      roleLower !== normalizedClientIdLower
    ) {
      return res
        .status(403)
        .json({ success: false, message: 'client_id tidak diizinkan' });
    }
  }
  if (
    req.user?.client_id &&
    normalizeClientIdLower(req.user.client_id) !== normalizedClientIdLower &&
    roleLower !== normalizedClientIdLower
  ) {
    return res
      .status(403)
      .json({ success: false, message: 'client_id tidak diizinkan' });
  }

  try {
    let rekapOptions = { regionalId };
    let roleForQuery = requestedRole;

    if (usesStandardPayload) {
      const resolvedRole = roleLower || null;
      if (!resolvedRole) {
        return res
          .status(400)
          .json({ success: false, message: 'role wajib diisi' });
      }
      const resolvedScope = scopeLower || 'org';
      if (!['org', 'direktorat'].includes(resolvedScope)) {
        return res
          .status(400)
          .json({ success: false, message: 'scope tidak valid' });
      }

      let postClientId = client_id;
      let userClientId = client_id;
      let userRoleFilter = null;

      if (resolvedScope === 'direktorat') {
        postClientId = client_id;
        userClientId = null;
        userRoleFilter = resolvedRole;
      } else if (resolvedScope === 'org') {
        if (resolvedRole === 'operator') {
          const tokenClientId = req.user?.client_id;
          if (!tokenClientId) {
            return res.status(400).json({
              success: false,
              message: 'client_id pengguna tidak ditemukan',
            });
          }
          postClientId = tokenClientId;
          userClientId = tokenClientId;
          userRoleFilter = 'operator';
        } else if (directorateRoles.includes(resolvedRole)) {
          postClientId = resolvedRole;
          userClientId = req.user?.client_id || client_id;
          userRoleFilter = resolvedRole;
        }
      }

      rekapOptions = {
        postClientId,
        userClientId,
        userRoleFilter,
        includePostRoleFilter: false,
        regionalId,
      };
      roleForQuery = resolvedRole;
    }

    const data = await getRekapKomentarByClient(
      client_id,
      periode,
      tanggal,
      startDate,
      endDate,
      roleForQuery,
      rekapOptions || {}
    );
    const totalPosts = Array.isArray(data) && data.length > 0
      ? data[0]?.total_konten
      : 0;
    const payload = formatTiktokCommentRecapResponse(data, totalPosts);
    const usersWithComments = payload.data
      .filter((u) => u.jumlah_komentar > 0)
      .map((u) => u.username);
    const usersWithoutComments = payload.data
      .filter((u) => u.jumlah_komentar === 0)
      .map((u) => u.username);
    res.json({
      success: true,
      ...payload,
      usersWithComments,
      usersWithoutComments,
      usersWithCommentsCount: usersWithComments.length,
      usersWithoutCommentsCount: usersWithoutComments.length,
    });
  } catch (err) {
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}


export async function getRapidTiktokProfile(req, res) {
  try {
    const username = req.query.username;
    if (!username) {
      return res.status(400).json({ success: false, message: 'username wajib diisi' });
    }
    const normalizedUsername = normalizeTikTokUsername(username);
    if (!normalizedUsername) {
      return res.status(400).json({
        success: false,
        message:
          'Format username TikTok tidak valid. Gunakan tautan profil atau username seperti tiktok.com/@username atau @username.'
      });
    }
    let profile = await profileCache.getProfile('tiktok', normalizedUsername);
    if (!profile) {
      profile = await fetchTiktokProfile(normalizedUsername);
      if (profile) {
        await profileCache.setProfile('tiktok', normalizedUsername, profile);
      }
    }
    sendSuccess(res, profile);
  } catch (err) {
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getRapidTiktokInfo(req, res) {
  try {
    const client_id =
      req.query.client_id ||
      req.user?.client_id ||
      req.headers['x-client-id'];
    if (!client_id) {
      return res
        .status(400)
        .json({ success: false, message: 'client_id wajib diisi' });
    }
    const client = await clientService.findClientById(client_id);
    const username = client?.client_tiktok;
    if (!username) {
      return res
        .status(404)
        .json({ success: false, message: 'Username TikTok tidak ditemukan' });
    }
    const info = await fetchTiktokInfo(username);
    sendSuccess(res, info);
  } catch (err) {
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getRapidTiktokPosts(req, res) {
  try {
    const client_id =
      req.query.client_id ||
      req.user?.client_id ||
      req.headers['x-client-id'];
    let { username, secUid } = req.query;
    let limit = parseInt(req.query.limit);
    if (Number.isNaN(limit) || limit <= 0) limit = 10;
    else if (limit > 100) limit = 100;

    if (!username && !secUid) {
      if (!client_id) {
        return res.status(400).json({ success: false, message: 'client_id wajib diisi' });
      }
      const client = await clientService.findClientById(client_id);
      username = client?.client_tiktok;
      secUid = client?.tiktok_secuid || secUid;
    }

    if (username) {
      const normalizedUsername = normalizeTikTokUsername(username);
      if (!normalizedUsername) {
        return res.status(400).json({
          success: false,
          message:
            'Format username TikTok tidak valid. Gunakan tautan profil atau username seperti tiktok.com/@username atau @username.'
        });
      }
      username = normalizedUsername;
    }

    if (!username && !secUid) {
      return res.status(404).json({ success: false, message: 'Username TikTok tidak ditemukan' });
    }

    const posts = secUid
      ? await fetchTiktokPostsBySecUid(secUid, limit)
      : await fetchTiktokPosts(username, limit);
    sendSuccess(res, posts);
  } catch (err) {
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

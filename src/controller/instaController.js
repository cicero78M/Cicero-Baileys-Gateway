// src/controller/instaController.js
import { getRekapLikesByClient } from "../model/instaLikeModel.js";
import * as instaPostService from "../service/instaPostService.js";
import * as instaPostKhususService from "../service/instaPostKhususService.js";
import {
  fetchInstagramPosts,
  fetchInstagramProfile,
  fetchInstagramInfo,
  fetchInstagramPostsByMonthToken,
} from "../service/instagramApi.js";
import * as instaProfileService from "../service/instaProfileService.js";
import * as instagramUserService from "../service/instagramUserService.js";
import * as instaPostCacheService from "../service/instaPostCacheService.js";
import * as profileCache from "../service/profileCacheService.js";
import { sendSuccess } from "../utils/response.js";
import { sendConsoleDebug } from "../middleware/debugHandler.js";
import { formatLikesRecapResponse } from "../utils/likesRecapFormatter.js";
import { normalizeHandleValue } from "../utils/handleNormalizer.js";
import * as clientModel from "../model/clientModel.js";

function parseOfficialOnlyFlag(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(normalized);
}

function normalizeInstagramUsername(value) {
  const normalizedHandle = normalizeHandleValue(value);
  return normalizedHandle ? normalizedHandle.replace(/^@/, "") : "";
}

export async function getInstaRekapLikes(req, res) {
  let client_id = req.query.client_id;
  const periode = req.query.periode || "harian";
  const tanggal = req.query.tanggal;
  const startDate =
    req.query.start_date || req.query.tanggal_mulai;
  const endDate = req.query.end_date || req.query.tanggal_selesai;
  const requestedRole = req.query.role || req.user?.role;
  const requestedScope = req.query.scope;
  const requestedRegionalId = req.query.regional_id || req.user?.regional_id;
  const officialOnlyFlag = parseOfficialOnlyFlag(req.query.official_only);
  const regionalId = requestedRegionalId
    ? String(requestedRegionalId).trim().toUpperCase()
    : null;
  const roleLower = requestedRole ? String(requestedRole).toLowerCase() : null;
  const scopeLower = requestedScope
    ? String(requestedScope).toLowerCase()
    : null;
  const isOrgOperatorScope =
    scopeLower === "org" && roleLower === "operator";
  const directorateRoles = [
    "ditbinmas",
    "ditlantas",
    "bidhumas",
    "ditsamapta",
  ];
  const usesStandardPayload = Boolean(requestedScope || req.query.role);

  if (!usesStandardPayload && roleLower === "ditbinmas") {
    client_id = "ditbinmas";
  }
  if (isOrgOperatorScope && req.user?.client_id && !client_id) {
    client_id = req.user.client_id;
  }

  if (!client_id) {
    return res
      .status(400)
      .json({ success: false, message: "client_id wajib diisi" });
  }

  const normalizedClientId = String(client_id).toLowerCase();
  const userClientIds = req.user?.client_ids
    ? Array.isArray(req.user.client_ids)
      ? req.user.client_ids
      : [req.user.client_ids]
    : [];
  const idsLower = userClientIds.map((c) => String(c).toLowerCase());
  const matchesTokenClient =
    req.user?.client_id &&
    req.user.client_id.toLowerCase() === normalizedClientId;
  const hasClientIdsAccess =
    idsLower.includes(normalizedClientId) ||
    matchesTokenClient ||
    roleLower === normalizedClientId;

  if (req.user?.client_ids) {
    if (
      !idsLower.includes(normalizedClientId) &&
      !matchesTokenClient &&
      roleLower !== normalizedClientId
    ) {
      return res
        .status(403)
        .json({ success: false, message: "client_id tidak diizinkan" });
    }
  }
  if (
    req.user?.client_id &&
    req.user.client_id.toLowerCase() !== normalizedClientId &&
    roleLower !== normalizedClientId &&
    !hasClientIdsAccess
  ) {
    return res
      .status(403)
      .json({ success: false, message: "client_id tidak diizinkan" });
  }
  try {
    let rekapOptions = { regionalId };
    let roleForQuery = requestedRole;

    if (usesStandardPayload) {
      const resolvedRole = roleLower || null;
      if (!resolvedRole) {
        return res
          .status(400)
          .json({ success: false, message: "role wajib diisi" });
      }
      const resolvedScope = scopeLower || "org";
      if (!["org", "direktorat"].includes(resolvedScope)) {
        return res
          .status(400)
          .json({ success: false, message: "scope tidak valid" });
      }

      let postClientId = client_id;
      let userClientId = client_id;
      let userRoleFilter = null;
      let includePostRoleFilter = false;
      let matchLikeClientId = true;

      let officialAccountsOnly = false;

      if (resolvedScope === "direktorat") {
        postClientId = client_id;
        userClientId = null;
        userRoleFilter = resolvedRole;
      } else if (resolvedScope === "org") {
        if (resolvedRole === "operator") {
          const tokenClientId = req.user?.client_id;
          if (!tokenClientId) {
            return res.status(400).json({
              success: false,
              message: "client_id pengguna tidak ditemukan",
            });
          }
          postClientId = client_id;
          userClientId = client_id;
          userRoleFilter = "operator";
          if (officialOnlyFlag) {
            const tokenClient = await clientModel.findById(client_id);
            officialAccountsOnly =
              tokenClient?.client_type?.toLowerCase() === "org";
          }
        } else if (directorateRoles.includes(resolvedRole)) {
          postClientId = resolvedRole;
          userClientId = req.user?.client_id || client_id;
          userRoleFilter = resolvedRole;
          matchLikeClientId = false;
        }
      }

      rekapOptions = {
        postClientId,
        userClientId,
        userRoleFilter,
        includePostRoleFilter,
        matchLikeClientId,
        officialAccountsOnly,
        regionalId,
      };
      roleForQuery = resolvedRole;
    }

    sendConsoleDebug({ tag: "INSTA", msg: `getInstaRekapLikes ${client_id} ${periode} ${tanggal || ''} ${startDate || ''} ${endDate || ''} ${roleLower || ''} ${scopeLower || ''}` });
    const { rows, totalKonten } = await getRekapLikesByClient(
      client_id,
      periode,
      tanggal,
      startDate,
      endDate,
      roleForQuery,
      rekapOptions
    );

    const payload = formatLikesRecapResponse(rows, totalKonten);

    res.json({
      success: true,
      ...payload,
    });
  } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getInstaRekapLikes: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

  export async function getInstaPosts(req, res) {
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
      if (req.user?.client_ids && !req.user.client_ids.includes(client_id)) {
        return res
          .status(403)
          .json({ success: false, message: "client_id tidak diizinkan" });
      }
      if (req.user?.client_id && req.user.client_id !== client_id) {
        return res
          .status(403)
          .json({ success: false, message: "client_id tidak diizinkan" });
      }
      sendConsoleDebug({ tag: "INSTA", msg: `getInstaPosts ${client_id}` });
      const posts = await instaPostService.findTodayByClientId(client_id);
      sendSuccess(res, posts);
    } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getInstaPosts: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getInstagramPostsFiltered(req, res) {
  try {
    let client_id =
      req.query.client_id ||
      req.user?.client_id ||
      req.headers["x-client-id"];
    const periode = req.query.periode || "harian";
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
    const directorateRoles = [
      "ditbinmas",
      "ditlantas",
      "bidhumas",
      "ditsamapta",
    ];
    const usesStandardPayload = Boolean(requestedScope || req.query.role);

    if (!usesStandardPayload && roleLower === "ditbinmas") {
      client_id = "ditbinmas";
    }

    if (!client_id) {
      return res
        .status(400)
        .json({ success: false, message: "client_id wajib diisi" });
    }

    if (req.user?.client_ids) {
      const userClientIds = Array.isArray(req.user.client_ids)
        ? req.user.client_ids
        : [req.user.client_ids];
      const idsLower = userClientIds.map((c) => c.toLowerCase());
      if (
        !idsLower.includes(client_id.toLowerCase()) &&
        roleLower !== client_id.toLowerCase()
      ) {
        return res
          .status(403)
          .json({ success: false, message: "client_id tidak diizinkan" });
      }
    }
    if (
      req.user?.client_id &&
      req.user.client_id.toLowerCase() !== client_id.toLowerCase() &&
      roleLower !== client_id.toLowerCase()
    ) {
      return res
        .status(403)
        .json({ success: false, message: "client_id tidak diizinkan" });
    }

    let roleForQuery = roleLower;
    let scopeForQuery = scopeLower;
    if (usesStandardPayload) {
      const resolvedRole = roleLower || null;
      if (!resolvedRole) {
        return res
          .status(400)
          .json({ success: false, message: "role wajib diisi" });
      }
      const resolvedScope = scopeLower || "org";
      if (!["org", "direktorat"].includes(resolvedScope)) {
        return res
          .status(400)
          .json({ success: false, message: "scope tidak valid" });
      }

      if (resolvedScope === "org") {
        if (resolvedRole === "operator") {
          const tokenClientId = req.user?.client_id;
          if (!tokenClientId) {
            return res.status(400).json({
              success: false,
              message: "client_id pengguna tidak ditemukan",
            });
          }
          client_id = tokenClientId;
        } else if (directorateRoles.includes(resolvedRole)) {
          client_id = resolvedRole;
        }
      }

      roleForQuery = resolvedRole;
      scopeForQuery = resolvedScope;
    }

    sendConsoleDebug({
      tag: "INSTA",
      msg: `getInstagramPostsFiltered ${client_id} ${periode} ${tanggal || ""} ${startDate || ""} ${endDate || ""} ${roleForQuery || ""} ${scopeForQuery || ""} ${regionalId || ""}`,
    });

    const posts = await instaPostService.findByFilters(client_id, {
      periode,
      tanggal,
      startDate,
      endDate,
      role: roleForQuery,
      scope: scopeForQuery,
      regionalId,
    });

    sendSuccess(res, posts);
  } catch (err) {
    sendConsoleDebug({
      tag: "INSTA",
      msg: `Error getInstagramPostsFiltered: ${err.message}`,
    });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getRapidInstagramPosts(req, res) {
  try {
    const username = normalizeInstagramUsername(req.query.username);
    let limit = parseInt(req.query.limit);
    if (Number.isNaN(limit) || limit <= 0) limit = 10;
    else if (limit > 100) limit = 100;
    if (!username) {
      return res.status(400).json({ success: false, message: 'username wajib diisi' });
    }

    sendConsoleDebug({ tag: "INSTA", msg: `getRapidInstagramPosts ${username} ${limit}` });

    const rawPosts = await fetchInstagramPosts(username, limit);
    const posts = rawPosts.map(p => {
      const thumbnail =
        p.thumbnail_url ||
        p.thumbnail_src ||
        p.thumbnail ||
        p.display_url ||
        (p.image_versions?.items?.[0]?.url) ||
        (p.image_versions2?.candidates?.[0]?.url);
      return {
        id: p.code || p.id || p.pk,
        created_at: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : p.created_at,
        type: p.media_type || p.type,
        caption: p.caption && typeof p.caption === 'object' ? p.caption.text : p.caption,
        like_count: p.like_count,
        comment_count: p.comment_count,
        share_count: p.share_count,
        view_count:
          p.play_count ??
          p.view_count ??
          p.playCount ??
          p.viewCount ??
          p.video_view_count ??
        0,
        thumbnail
      };
    });
    sendSuccess(res, posts);
  } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getRapidInstagramPosts: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getRapidInstagramPostsStore(req, res) {
  try {
    const username = normalizeInstagramUsername(req.query.username);
    let limit = parseInt(req.query.limit);
    if (Number.isNaN(limit) || limit <= 0) limit = 10;
    else if (limit > 100) limit = 100;
    if (!username) {
      return res.status(400).json({ success: false, message: 'username wajib diisi' });
    }
    sendConsoleDebug({ tag: "INSTA", msg: `getRapidInstagramPostsStore ${username} ${limit}` });
    const rawPosts = await fetchInstagramPosts(username, limit);
    const posts = rawPosts.map(p => {
      const thumbnail =
        p.thumbnail_url ||
        p.thumbnail_src ||
        p.thumbnail ||
        p.display_url ||
        (p.image_versions?.items?.[0]?.url) ||
        (p.image_versions2?.candidates?.[0]?.url);
      return {
        id: p.code || p.id || p.pk,
        created_at: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : p.created_at,
        type: p.media_type || p.type,
        caption: p.caption && typeof p.caption === 'object' ? p.caption.text : p.caption,
        like_count: p.like_count,
        comment_count: p.comment_count,
        share_count: p.share_count,
        view_count:
          p.play_count ??
          p.view_count ??
          p.playCount ??
          p.viewCount ??
          p.video_view_count ??
          0,
        thumbnail
      };
    });
    await instaPostCacheService.insertCache(username, posts);
    sendSuccess(res, posts);
  } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getRapidInstagramPostsStore: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getRapidInstagramPostsByMonth(req, res) {
  try {

        sendConsoleDebug({ tag: "INSTA", msg: `Executed` });

    const username = normalizeInstagramUsername(req.query.username);
    const monthInput = parseInt(req.query.month);
    const yearInput = parseInt(req.query.year);
    if (!username) {
      return res.status(400).json({ success: false, message: 'username wajib diisi' });
    }

    const now = new Date();
    const monthNum = Number.isNaN(monthInput) ? now.getMonth() + 1 : monthInput;
    const yearNum = Number.isNaN(yearInput) ? now.getFullYear() : yearInput;

    sendConsoleDebug({ tag: "INSTA", msg: `getRapidInstagramPostsByMonth ${username} ${monthNum}-${yearNum}` });

    const rawPosts = await fetchInstagramPostsByMonthToken(username, monthNum, yearNum);

    const posts = rawPosts.map(p => {
      const thumbnail =
        p.thumbnail_url ||
        p.thumbnail_src ||
        p.thumbnail ||
        p.display_url ||
        (p.image_versions?.items?.[0]?.url) ||
        (p.image_versions2?.candidates?.[0]?.url);
      return {
        id: p.code || p.id || p.pk,
        created_at: p.taken_at ? new Date(p.taken_at * 1000).toISOString() : p.created_at,
        type: p.media_type || p.type,
        caption: p.caption && typeof p.caption === 'object' ? p.caption.text : p.caption,
        like_count: p.like_count,
        comment_count: p.comment_count,
        share_count: p.share_count,
        view_count:
          p.play_count ??
          p.view_count ??
          p.playCount ??
          p.viewCount ??
          p.video_view_count ??
          0,
        thumbnail
      };
    });
    sendSuccess(res, posts);
  } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getRapidInstagramPostsByMonth: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getRapidInstagramProfile(req, res) {
  try {
    const username = normalizeInstagramUsername(req.query.username);
    if (!username) {
      return res.status(400).json({ success: false, message: 'username wajib diisi' });
    }
    sendConsoleDebug({ tag: "INSTA", msg: `getRapidInstagramProfile ${username}` });
    let profile = await profileCache.getProfile('insta', username);
    if (!profile) {
      profile = await fetchInstagramProfile(username);
      if (profile) {
        await profileCache.setProfile('insta', username, profile);
      }
    }
    if (profile && profile.username) {
      await instaProfileService.upsertProfile({
        username: profile.username,
        full_name: profile.full_name,
        biography: profile.biography,
        follower_count: profile.followers_count ?? profile.follower_count,
        following_count: profile.following_count,
        post_count: profile.media_count ?? profile.posts_count,
        profile_pic_url: profile.profile_pic_url,
      });

      const userId = profile.pk || profile.id || profile.user_id;
      if (userId) {
        await instagramUserService.upsertInstagramUser({
          user_id: String(userId),
          username: profile.username,
          full_name: profile.full_name,
          biography: profile.biography,
          business_contact_method: profile.business_contact_method,
          category: profile.category_name || profile.category,
          category_id: profile.category_id,
          account_type: profile.account_type,
          contact_phone_number: profile.contact_phone_number,
          external_url: profile.external_url,
          fbid_v2: profile.fbid_v2,
          is_business: profile.is_business,
          is_private: profile.is_private,
          is_verified: profile.is_verified,
          public_email: profile.public_email,
          public_phone_country_code: profile.public_phone_country_code,
          public_phone_number: profile.public_phone_number,
          profile_pic_url: profile.profile_pic_url,
          profile_pic_url_hd: profile.profile_pic_url_hd
        });

        await instagramUserService.upsertInstagramUserMetrics({
          user_id: String(userId),
          follower_count: profile.followers_count ?? profile.follower_count,
          following_count: profile.following_count,
          media_count: profile.media_count ?? profile.posts_count,
          total_igtv_videos: profile.total_igtv_videos,
          latest_reel_media: profile.latest_reel_media
        });
      }
    }
    sendSuccess(res, profile);
  } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getRapidInstagramProfile: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getRapidInstagramInfo(req, res) {
  try {
    const username = normalizeInstagramUsername(req.query.username);
    if (!username) {
      return res.status(400).json({ success: false, message: 'username wajib diisi' });
    }
    sendConsoleDebug({ tag: "INSTA", msg: `getRapidInstagramInfo ${username}` });
    const info = await fetchInstagramInfo(username);
    sendSuccess(res, info);
  } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getRapidInstagramInfo: ${err.message}` });
    if (err.code === 'RAPIDAPI_KEY_MISSING') {
      return res.status(err.statusCode || 503).json({
        success: false,
        message: 'RAPIDAPI_KEY belum di-set',
      });
    }
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getInstagramProfile(req, res) {
  try {
    const username = req.query.username;
    if (!username) {
      return res.status(400).json({ success: false, message: 'username wajib diisi' });
    }
    sendConsoleDebug({ tag: "INSTA", msg: `getInstagramProfile ${username}` });
    const profile = await instaProfileService.findByUsername(username);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'profile not found' });
    }
    sendSuccess(res, profile);
  } catch (err) {
    sendConsoleDebug({ tag: "INSTA", msg: `Error getInstagramProfile: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

export async function getInstagramUser(req, res) {
  try {
    const user_id = req.query.user_id;
    const username = req.query.username;
    if (!user_id && !username) {
      return res.status(400).json({ success: false, message: 'username atau user_id wajib diisi' });
    }
    sendConsoleDebug({ tag: 'INSTA', msg: `getInstagramUser ${user_id || username}` });
    let profile;
    if (user_id) profile = await instagramUserService.findByUserId(user_id);
    else profile = await instagramUserService.findByUsername(username);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'profile not found' });
    }
    sendSuccess(res, profile);
  } catch (err) {
    sendConsoleDebug({ tag: 'INSTA', msg: `Error getInstagramUser: ${err.message}` });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

  export async function getInstaPostsKhusus(req, res) {
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
      if (req.user?.client_ids && !req.user.client_ids.includes(client_id)) {
        return res
          .status(403)
          .json({ success: false, message: "client_id tidak diizinkan" });
      }
      if (req.user?.client_id && req.user.client_id !== client_id) {
        return res
          .status(403)
          .json({ success: false, message: "client_id tidak diizinkan" });
      }
      const days = req.query.days ? parseInt(req.query.days) : undefined;
      const startDate = req.query.start_date;
      const endDate = req.query.end_date;

      sendConsoleDebug({
        tag: "INSTA",
        msg: `getInstaPostsKhusus ${client_id} ${days || ''} ${startDate || ''} ${endDate || ''}`,
      });

      let posts = await instaPostKhususService.findTodayByClientId(client_id);
      if (posts.length === 0 && (days || startDate || endDate)) {
        posts = await instaPostKhususService.findByClientIdRange(client_id, {
          days,
          startDate,
          endDate,
        });
      }
      sendSuccess(res, posts);
    } catch (err) {
    sendConsoleDebug({
      tag: "INSTA",
      msg: `Error getInstaPostsKhusus: ${err.message}`
    });
    const code = err.statusCode || err.response?.status || 500;
    res.status(code).json({ success: false, message: err.message });
  }
}

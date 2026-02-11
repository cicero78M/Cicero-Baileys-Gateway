import * as clientService from '../service/clientService.js';
import * as userModel from '../model/userModel.js';
import * as instaPostService from '../service/instaPostService.js';
import * as instaLikeService from '../service/instaLikeService.js';
import * as tiktokPostService from '../service/tiktokPostService.js';
import * as tiktokCommentService from '../service/tiktokCommentService.js';
import * as satbinmasOfficialAccountService from '../service/satbinmasOfficialAccountService.js';
import { sendSuccess } from '../utils/response.js';
import { normalizeClientId } from '../utils/utilsHelper.js';

const normalizeTierLabel = (tier) =>
  typeof tier === "string" && tier.trim() !== ""
    ? tier.trim().toLowerCase()
    : null;

// List semua client (bisa filter by group)
export const getAllClients = async (req, res, next) => {
  try {
    const group = req.query.group;
    let clients;
    if (group) {
      clients = await clientService.findClientsByGroup(group);
    } else {
      clients = await clientService.findAllClients();
    }
    sendSuccess(res, clients);
  } catch (err) {
    next(err);
  }
};

// List semua client aktif
export const getActiveClients = async (req, res, next) => {
  try {
    const clients = await clientService.findAllActiveClients();
    sendSuccess(res, clients);
  } catch (err) {
    next(err);
  }
};

// Detail client
export const getClientById = async (req, res, next) => {
  try {
    const client = await clientService.findClientById(req.params.client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    sendSuccess(res, client);
  } catch (err) {
    next(err);
  }
};

// Update client
export const updateClient = async (req, res, next) => {
  try {
    const client = await clientService.updateClient(req.params.client_id, req.body);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    sendSuccess(res, client);
  } catch (err) {
    next(err);
  }
};

// Delete client
export const deleteClient = async (req, res, next) => {
  try {
    const client = await clientService.deleteClient(req.params.client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    sendSuccess(res, client);
  } catch (err) {
    next(err);
  }
};

// Semua user di bawah client
export const getUsers = async (req, res, next) => {
  try {
    const users = await userModel.findUsersByClientId(req.params.client_id);
    sendSuccess(res, users);
  } catch (err) {
    next(err);
  }
};

// Semua posting IG milik client
export const getInstagramPosts = async (req, res, next) => {
  try {
    const posts = await instaPostService.findByClientId(req.params.client_id);
    sendSuccess(res, posts);
  } catch (err) {
    next(err);
  }
};

// Semua like posting IG client (rekap)
export const getInstagramLikes = async (req, res, next) => {
  try {
    const posts = await instaPostService.findByClientId(req.params.client_id);
    const likesData = await Promise.all(
      posts.map(async (post) => {
        const like = await instaLikeService.findByShortcode(post.shortcode);
        return {
          shortcode: post.shortcode,
          like_count: Array.isArray(like?.likes) ? like.likes.length : 0,
          likes: like?.likes || [],
        };
      })
    );
    sendSuccess(res, likesData);
  } catch (err) {
    next(err);
  }
};

// Semua posting TikTok milik client
export const getTiktokPosts = async (req, res, next) => {
  try {
    const posts = await tiktokPostService.findByClientId(req.params.client_id);
    sendSuccess(res, posts);
  } catch (err) {
    next(err);
  }
};

// Semua komentar TikTok client (rekap)
export const getTiktokComments = async (req, res, next) => {
  try {
    const posts = await tiktokPostService.findByClientId(req.params.client_id);
    const commentsData = await Promise.all(
      posts.map(async (post) => {
        const comm = await tiktokCommentService.findByVideoId(post.video_id);
        return {
          video_id: post.video_id,
          comment_count: Array.isArray(comm?.comments)
            ? comm.comments.length
            : 0,
          comments: comm?.comments || [],
        };
      })
    );
    sendSuccess(res, commentsData);
  } catch (err) {
    next(err);
  }
};

// Ringkasan aktivitas client (dashboard)
export const getSummary = async (req, res, next) => {
  try {
    const client_id = req.params.client_id;
    const summary = await clientService.getClientSummary(client_id);
    if (!summary) return res.status(404).json({ error: 'Client not found' });
    sendSuccess(res, summary);
  } catch (err) {
    next(err);
  }
};

export const getSatbinmasOfficialAccounts = async (req, res, next) => {
  try {
    const accounts = await satbinmasOfficialAccountService.listSatbinmasOfficialAccounts(
      req.params.client_id
    );
    sendSuccess(res, accounts);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
};

export const getSatbinmasOfficialAccountData = async (req, res, next) => {
  try {
    const data = await satbinmasOfficialAccountService.getSatbinmasOfficialAccountData(
      req.params.client_id
    );
    sendSuccess(res, data);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
};

export const saveSatbinmasOfficialAccount = async (req, res, next) => {
  try {
    const result = await satbinmasOfficialAccountService.saveSatbinmasOfficialAccount(
      req.params.client_id,
      req.body
    );
    sendSuccess(res, result, result.created ? 201 : 200);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
};

export const deleteSatbinmasOfficialAccount = async (req, res, next) => {
  try {
    const deleted = await satbinmasOfficialAccountService.deleteSatbinmasOfficialAccount(
      req.params.client_id,
      req.params.account_id
    );
    sendSuccess(res, deleted);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
};

export const getClientProfile = async (req, res, next) => {
  try {
    const clientId =
      req.params.client_id ||
      req.query.client_id ||
      req.body.client_id ||
      req.user?.client_id;
    const normalizedClientId = normalizeClientId(clientId);
    if (!normalizedClientId) {
      return res.status(400).json({ error: "client_id required" });
    }

    const requestedRole = req.query.role || req.user?.role;
    const requestedScope = req.query.scope;
    const requestedRegionalId = req.query.regional_id || req.user?.regional_id;
    const role = requestedRole ? String(requestedRole).toLowerCase() : null;
    const scopeLower = requestedScope
      ? String(requestedScope).toLowerCase()
      : null;
    const regionalId = requestedRegionalId
      ? String(requestedRegionalId).trim().toUpperCase()
      : null;
    const directorateRoles = ["ditbinmas", "ditlantas", "bidhumas", "ditsamapta", "ditintelkam"];
    const usesStandardPayload = Boolean(
      req.query.role || req.query.scope || req.query.regional_id
    );

    let resolvedScope = scopeLower;
    if (usesStandardPayload) {
      if (!role) {
        return res.status(400).json({ error: "role wajib diisi" });
      }
      resolvedScope = scopeLower || "org";
      if (!["org", "direktorat"].includes(resolvedScope)) {
        return res.status(400).json({ error: "scope tidak valid" });
      }
      if (
        resolvedScope === "direktorat" &&
        !directorateRoles.includes(role)
      ) {
        return res.status(400).json({ error: "role direktorat tidak valid" });
      }
    }

    const clientIdsFromUser = Array.isArray(req.user?.client_ids)
      ? req.user.client_ids
      : [];
    const normalizedUserClientIds = clientIdsFromUser
      .map((value) => normalizeClientId(value))
      .filter(Boolean);
    if (
      role === "operator" &&
      !normalizedUserClientIds.includes(normalizedClientId)
    ) {
      return res.status(403).json({
        error:
          "client_id tidak terdaftar untuk operator ini. Gunakan client_id yang ada di token.",
      });
    }

    console.log("[GET CLIENT PROFILE]", {
      ip: req.ip,
      userId: req.user?.user_id,
      userAgent: req.headers?.["user-agent"],
      clientId: normalizedClientId,
    });

    let client = await clientService.findClientById(normalizedClientId);

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (usesStandardPayload && resolvedScope === "direktorat") {
      const roleClientId = role?.toUpperCase();
      const roleClient = roleClientId
        ? await clientService.findClientById(roleClientId)
        : null;
      if (!roleClient || roleClient.client_type?.toLowerCase() !== "direktorat") {
        return res.status(404).json({ error: "Client not found" });
      }
      client = roleClient;
    }

    if (
      regionalId &&
      normalizeClientId(client.regional_id) !== regionalId
    ) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (
      role &&
      role !== "operator" &&
      role !== "client" &&
      client.client_type?.toLowerCase() === "org"
    ) {
      const roleClient = await clientService.findClientById(role.toUpperCase());
      if (roleClient) {
        // When scope=org, we overlay social media info from the directorate role client
        // without validating its regional_id, since the org client's regional_id
        // has already been validated above (lines 301-306)
        if (
          resolvedScope !== "org" &&
          regionalId &&
          normalizeClientId(roleClient.regional_id) !== regionalId
        ) {
          return res.status(404).json({ error: "Client not found" });
        }
        client.client_insta = roleClient.client_insta;
        client.client_insta_status = roleClient.client_insta_status;
        client.client_tiktok = roleClient.client_tiktok;
        client.client_tiktok_status = roleClient.client_tiktok_status;
        client.client_amplify_status = roleClient.client_amplify_status;
      }
    }

    const tierFromSubscription =
      normalizeTierLabel(req.user?.premium_tier) ||
      normalizeTierLabel(req.user?.premiumTier) ||
      normalizeTierLabel(client.premium_tier);
    const tierFromLevel =
      normalizeTierLabel(client.client_level) || normalizeTierLabel(client.level);
    const resolvedTier = tierFromSubscription || tierFromLevel;
    const levelAlias = client.level ?? client.client_level ?? null;

    // Sesuaikan key hasil jika ingin (client/profile)
    res.json({
      success: true,
      client: {
        ...client,
        level: levelAlias,
        tier: resolvedTier,
        premium_tier: resolvedTier,
      },
    });
  } catch (err) {
    next(err);
  }
};

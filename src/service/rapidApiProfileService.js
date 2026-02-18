import axios from 'axios';

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBooleanOrNull(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function pickFirst(obj, paths = []) {
  for (const path of paths) {
    const chunks = path.split('.');
    let current = obj;
    let found = true;
    for (const chunk of chunks) {
      if (!current || !(chunk in current)) {
        found = false;
        break;
      }
      current = current[chunk];
    }
    if (found && current !== undefined && current !== null) return current;
  }
  return null;
}

export function mapProviderToSocialProfile(platform, username, data) {
  const normalizedPlatform = String(platform || '').toLowerCase();
  const profile = pickFirst(data, ['data', 'userInfo', 'result', 'profile']) || data;
  const user = pickFirst(profile, ['user']) || profile;
  const stats = pickFirst(profile, ['stats', 'statistics']) || profile;
  const posts = toNumberOrNull(
    pickFirst(stats, ['posts', 'media_count', 'videoCount', 'aweme_count', 'edge_owner_to_timeline_media.count'])
  );

  const mapped = {
    exists: true,
    username: String(
      pickFirst(user, ['username', 'uniqueId', 'handle']) || username || ''
    ),
    isPrivate: toBooleanOrNull(
      pickFirst(user, ['is_private', 'private', 'isPrivate', 'account_private'])
    ),
    followers: toNumberOrNull(pickFirst(stats, ['followers', 'follower_count', 'followerCount'])),
    following: toNumberOrNull(pickFirst(stats, ['following', 'following_count', 'followingCount'])),
    posts,
    likes:
      normalizedPlatform === 'tiktok'
        ? toNumberOrNull(pickFirst(stats, ['likes', 'heart', 'heartCount', 'like_count']))
        : toNumberOrNull(pickFirst(stats, ['likes', 'like_count'])),
    hasProfilePic: toBooleanOrNull(
      Boolean(pickFirst(user, ['profile_pic_url', 'avatar_url', 'avatarThumb', 'profilePicture']))
    ),
    bioLength: (() => {
      const bio = pickFirst(user, ['biography', 'bio', 'signature']);
      return typeof bio === 'string' ? bio.trim().length : null;
    })(),
    lastPostAt: (() => {
      const value = pickFirst(profile, ['last_post_at', 'lastPostAt', 'latest_post_at']);
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    })(),
    recentActivityScore: null,
    raw: data,
  };

  const scoreParts = [mapped.posts, mapped.followers, mapped.following, mapped.likes]
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.min(100, value));
  if (scoreParts.length) {
    mapped.recentActivityScore = Math.round(scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length);
  }

  return mapped;
}

function buildRapidApiUrl(platform, username, host) {
  const cleanUsername = String(username || '').replace(/^@/, '');
  if (platform === 'instagram') {
    return {
      url: `https://${host}/v1/info`,
      params: { username_or_id_or_url: cleanUsername },
    };
  }
  return {
    url: `https://${host}/api/user/info`,
    params: { uniqueId: cleanUsername, username: cleanUsername },
  };
}

export async function fetchSocialProfile({ platform, username }) {
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  const rapidApiHost = process.env.RAPIDAPI_HOST;

  if (!rapidApiKey || !rapidApiHost) {
    const error = new Error('RapidAPI config is missing');
    error.code = 'RAPIDAPI_CONFIG_MISSING';
    throw error;
  }

  const normalizedPlatform = String(platform || '').toLowerCase();
  if (!['instagram', 'tiktok'].includes(normalizedPlatform)) {
    const error = new Error(`Unsupported platform: ${platform}`);
    error.code = 'RAPIDAPI_CONFIG_MISSING';
    throw error;
  }

  try {
    const { url, params } = buildRapidApiUrl(normalizedPlatform, username, rapidApiHost);
    const response = await axios.get(url, {
      params,
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': rapidApiHost,
      },
      timeout: 15000,
    });

    return mapProviderToSocialProfile(normalizedPlatform, username, response.data);
  } catch (err) {
    const status = err?.response?.status;
    const message = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err?.message || 'Unknown RapidAPI error';

    if (status === 400 || status === 404) {
      return {
        exists: false,
        username: String(username || ''),
        isPrivate: null,
        followers: null,
        following: null,
        posts: null,
        likes: null,
        hasProfilePic: null,
        bioLength: null,
        lastPostAt: null,
        recentActivityScore: null,
        raw: err?.response?.data || null,
        providerError: { status, message },
      };
    }

    if (status === 429 || (status >= 500 && status <= 599)) {
      const unavailableError = new Error('RapidAPI unavailable');
      unavailableError.code = 'RAPIDAPI_UNAVAILABLE';
      unavailableError.status = status;
      unavailableError.cause = err;
      throw unavailableError;
    }

    return {
      exists: false,
      username: String(username || ''),
      isPrivate: null,
      followers: null,
      following: null,
      posts: null,
      likes: null,
      hasProfilePic: null,
      bioLength: null,
      lastPostAt: null,
      recentActivityScore: null,
      raw: err?.response?.data || null,
      providerError: { status: status || 0, message },
    };
  }
}

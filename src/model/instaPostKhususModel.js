// src/model/instaPostKhususModel.js
import { query } from '../db/index.js';

export async function upsertInstaPost(data) {
  const {
    client_id,
    shortcode,
    caption = null,
    comment_count = 0,
    like_count = 0,
    thumbnail_url = null,
    is_video = false,
    video_url = null,
    image_url = null,
    images_url = null,
    is_carousel = false,
    source_type = null,
  } = data;

  await query(
    `INSERT INTO insta_post_khusus (client_id, shortcode, caption, comment_count, like_count, thumbnail_url, is_video, video_url, image_url, images_url, is_carousel, source_type, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13, NOW()))
     ON CONFLICT (shortcode) DO UPDATE
      SET client_id = EXCLUDED.client_id,
          caption = EXCLUDED.caption,
          comment_count = EXCLUDED.comment_count,
          like_count = EXCLUDED.like_count,
          thumbnail_url = EXCLUDED.thumbnail_url,
          is_video = EXCLUDED.is_video,
          video_url = EXCLUDED.video_url,
          image_url = EXCLUDED.image_url,
          images_url = EXCLUDED.images_url,
          is_carousel = EXCLUDED.is_carousel,
          source_type = CASE
            WHEN insta_post_khusus.source_type = 'manual_input' THEN insta_post_khusus.source_type
            ELSE EXCLUDED.source_type
          END,
          created_at = EXCLUDED.created_at`,
    [client_id, shortcode, caption, comment_count, like_count, thumbnail_url, is_video, video_url, image_url, JSON.stringify(images_url), is_carousel, source_type, data.created_at || null]
  );
}

export async function findPostByShortcode(shortcode) {
  const res = await query('SELECT * FROM insta_post_khusus WHERE shortcode = $1', [shortcode]);
  return res.rows[0] || null;
}

export async function getShortcodesTodayByClient(client_id) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const res = await query(
    `SELECT shortcode FROM insta_post_khusus
     WHERE client_id = $1 AND DATE(created_at) = $2`,
    [client_id, `${yyyy}-${mm}-${dd}`]
  );
  return res.rows.map(r => r.shortcode);
}

export async function getShortcodesTodayByUsername(username) {
  if (!username) return [];
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const res = await query(
    `SELECT p.shortcode FROM insta_post_khusus p JOIN clients c ON c.client_id = p.client_id
     WHERE c.client_insta = $1 AND DATE(p.created_at) = $2`,
    [username, `${yyyy}-${mm}-${dd}`]
  );
  return res.rows.map(r => r.shortcode);
}


export async function getPostsTodayByClient(client_id) {
  const res = await query(
    `SELECT * FROM insta_post_khusus WHERE client_id = $1 AND created_at::date = NOW()::date`,
    [client_id]
  );
  return res.rows;
}

export async function getPostsByClientId(client_id) {
  const res = await query(
    `SELECT DISTINCT ON (shortcode) *
     FROM insta_post_khusus
     WHERE client_id = $1
     ORDER BY shortcode, created_at DESC`,
    [client_id]
  );
  return res.rows;
}

export async function findByClientId(client_id) {
  return getPostsByClientId(client_id);
}

export async function getPostsByClientAndDateRange(
  client_id,
  { days, startDate, endDate } = {}
) {
  let text =
    'SELECT * FROM insta_post_khusus WHERE client_id = $1';
  const values = [client_id];

  if (days) {
    const safeDays = parseInt(days);
    text += ` AND created_at >= NOW() - INTERVAL '${safeDays} days'`;
  } else {
    if (startDate) {
      values.push(startDate);
      text += ` AND created_at::date >= $${values.length}`;
    }
    if (endDate) {
      values.push(endDate);
      text += ` AND created_at::date <= $${values.length}`;
    }
  }

  text += ' ORDER BY created_at DESC';

  const res = await query(text, values);
  return res.rows;
}

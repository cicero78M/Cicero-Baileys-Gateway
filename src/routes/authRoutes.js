import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import * as penmasUserModel from "../model/penmasUserModel.js";
import * as userModel from "../model/userModel.js";
import {
  isAdminWhatsApp,
  formatToWhatsAppId,
  getAdminWAIds,
  minPhoneDigitLength,
  normalizeWhatsappNumber,
  safeSendMessage,
} from "../utils/waHelper.js";
import redis from "../config/redis.js";
import waClient, {
  waitForWaReady,
  queueAdminNotification,
} from "../service/waService.js";
import { insertVisitorLog } from "../model/visitorLogModel.js";
import { insertLoginLog } from "../model/loginLogModel.js";

async function notifyAdmin(message) {
  try {
    await waitForWaReady();
  } catch (err) {
    console.warn(
      `[WA] Queueing admin notification: ${err.message}`
    );
    queueAdminNotification(message);
    return;
  }
  for (const wa of getAdminWAIds()) {
    safeSendMessage(waClient, wa, message);
  }
}

const router = express.Router();

router.post('/penmas-register', async (req, res) => {
  const { username, password, role = 'penulis' } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'username dan password wajib diisi' });
  }
  const existing = await penmasUserModel.findByUsername(username);
  if (existing) {
    return res
      .status(400)
      .json({ success: false, message: 'username sudah terpakai' });
  }
  const user_id = uuidv4();
  const password_hash = await bcrypt.hash(password, 10);
  const user = await penmasUserModel.createUser({
    user_id,
    username,
    password_hash,
    role,
  });
  return res.status(201).json({ success: true, user_id: user.user_id });
});

router.post('/penmas-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'username dan password wajib diisi' });
  }
  const user = await penmasUserModel.findByUsername(username);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: data tidak ditemukan' });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: password salah' });
  }
  const payload = { user_id: user.user_id, role: user.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '2h',
  });
  try {
    await redis.sAdd(`penmas_login:${user.user_id}`, token);
    await redis.set(`login_token:${token}`, `penmas:${user.user_id}`, {
      EX: 2 * 60 * 60,
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login penmas:', err.message);
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  await insertLoginLog({
    actorId: user.user_id,
    loginType: 'operator',
    loginSource: 'web'
  });
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  notifyAdmin(
    `\uD83D\uDD11 Login Penmas: ${user.username} (${user.role})\nWaktu: ${time}`
  );
  return res.json({ success: true, token, user: payload });
});

router.post("/login", async (req, res) => {
  const { client_id, client_operator } = req.body;
  // Validasi input
  if (!client_id || !client_operator) {
    const reason = "client_id dan client_operator wajib diisi";
    const time = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
    });
    notifyAdmin(
      `❌ Login gagal\nAlasan: ${reason}\nID: ${client_id || "-"}\nOperator: ${
        client_operator || "-"}\nWaktu: ${time}`
    );
    return res
      .status(400)
      .json({ success: false, message: reason });
  }
  // Cari client berdasarkan ID saja
  const { rows } = await query(
    "SELECT * FROM clients WHERE client_id = $1",
    [client_id]
  );
  const client = rows[0];
  // Jika client tidak ditemukan
  if (!client) {
    const reason = "client_id tidak ditemukan";
    const time = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    notifyAdmin(
      `❌ Login gagal\nAlasan: ${reason}\nID: ${client_id}\nOperator: ${client_operator}\nWaktu: ${time}`
    );
    return res.status(401).json({
      success: false,
      message: `Login gagal: ${reason}`,
    });
  }

  // Cek operator yang diberikan: boleh operator asli atau admin
  const inputId = formatToWhatsAppId(client_operator);
  const dbOperator = client.client_operator
    ? formatToWhatsAppId(client.client_operator)
    : "";

  const isValidOperator =
    inputId === dbOperator ||
    client_operator === client.client_operator ||
    isAdminWhatsApp(inputId) ||
    isAdminWhatsApp(client_operator);

  if (!isValidOperator) {
    const reason = "client operator tidak valid";
    const time = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    notifyAdmin(
      `❌ Login gagal\nAlasan: ${reason}\nID: ${client_id}\nOperator: ${client_operator}\nWaktu: ${time}`
    );
    return res.status(401).json({
      success: false,
      message: `Login gagal: ${reason}`,
    });
  }

  // Generate JWT token
  const role =
    client.client_type?.toLowerCase() === "direktorat"
      ? client.client_id.toLowerCase()
      : "client";
  const payload = {
    client_id: client.client_id,
    nama: client.nama,
    role,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "2h",
  });
  try {
    const setKey = `login:${client_id}`;
    await redis.sAdd(setKey, token);
    await redis.set(`login_token:${token}`, client_id, { EX: 2 * 60 * 60 });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login:', err.message);
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production'
  });
  await insertLoginLog({
    actorId: client.client_id,
    loginType: 'operator',
    loginSource: 'mobile'
  });
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  notifyAdmin(
    `\uD83D\uDD11 Login: ${client.nama} (${client.client_id})\nOperator: ${client_operator}\nWaktu: ${time}`
  );
  // Kembalikan token dan data client
  return res.json({ success: true, token, client: payload });
});

router.post('/user-register', async (req, res) => {
  const { nrp, nama, client_id, whatsapp = '', divisi = '', jabatan = '', title = '' } = req.body;
  if (!nrp || !nama || !client_id) {
    return res
      .status(400)
      .json({ success: false, message: 'nrp, nama, dan client_id wajib diisi' });
  }
  const normalizedWhatsapp = normalizeWhatsappNumber(whatsapp);
  if (whatsapp && normalizedWhatsapp.length < minPhoneDigitLength) {
    return res
      .status(400)
      .json({ success: false, message: 'whatsapp tidak valid' });
  }
  const existing = await query('SELECT * FROM "user" WHERE user_id = $1', [nrp]);
  if (existing.rows.length) {
    return res
      .status(400)
      .json({ success: false, message: 'nrp sudah terdaftar' });
  }
  const user = await userModel.createUser({
    user_id: nrp,
    nama,
    client_id,
    whatsapp: normalizedWhatsapp,
    divisi,
    jabatan,
    title
  });
  return res.status(201).json({ success: true, user_id: user.user_id });
});

router.post('/user-login', async (req, res) => {
  const { nrp, whatsapp, password } = req.body;
  const waInput = whatsapp || password;
  if (!nrp || !waInput) {
    return res
      .status(400)
      .json({ success: false, message: 'nrp dan whatsapp wajib diisi' });
  }
  const wa = normalizeWhatsappNumber(waInput);
  const rawWa = String(waInput).replace(/\D/g, "");
  const { rows } = await query(
    'SELECT user_id, nama FROM "user" WHERE user_id = $1 AND (whatsapp = $2 OR whatsapp = $3)',
    [nrp, wa, rawWa]
  );
  const user = rows[0];
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Login gagal: data tidak ditemukan' });
  }
  const payload = { user_id: user.user_id, nama: user.nama, role: 'user' };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '2h'
  });
  try {
    await redis.sAdd(`user_login:${user.user_id}`, token);
    await redis.set(`login_token:${token}`, `user:${user.user_id}`, {
      EX: 2 * 60 * 60
    });
  } catch (err) {
    console.error('[AUTH] Gagal menyimpan token login user:', err.message);
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production'
  });
  await insertLoginLog({
    actorId: user.user_id,
    loginType: 'user',
    loginSource: 'mobile'
  });
  if (process.env.ADMIN_NOTIFY_LOGIN !== 'false') {
    const time = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta'
    });
    queueAdminNotification(
      `\uD83D\uDD11 Login user: ${user.user_id} - ${user.nama}\nWaktu: ${time}`
    );
  }
  return res.json({ success: true, token, user: payload });
});

router.get('/open', async (req, res) => {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || '';
  await insertVisitorLog({ ip, userAgent: ua });
  notifyAdmin(
    `\uD83D\uDD0D Web dibuka\nIP: ${ip}\nUA: ${ua}\nWaktu: ${time}`
  );
  return res.json({ success: true });
});


export default router;

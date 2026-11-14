'use strict';
const express = require('express');
const config = require('../config');
const { get, run } = require('../db');
const { HttpError, str, phone, password, rateLimiter } = require('../util');
const { login: loginField, staffPassword } = require('../util');
const {
  hashPassword, verifyPassword, DUMMY_HASH, createSession, destroySession, publicUser, requireAuth, requireMember,
} = require('../auth');
const events = require('../events');

const r = express.Router();
const loginLimit = rateLimiter({ windowMs: 15 * 60e3, max: 10, message: "Juda ko'p urinish bo'ldi. 15 daqiqadan keyin qayta urinib ko'ring." });
const registerLimit = rateLimiter({ windowMs: 60 * 60e3, max: 20, message: "Juda ko'p ro'yxatdan o'tish urinishlari. Birozdan keyin urinib ko'ring." });

r.get('/health', (req, res) => res.json({ ok: true }));
r.get('/config', (req, res) => res.json({ appName: config.appName }));

r.post('/auth/register', async (req, res) => {
  registerLimit(req.ip);
  const b = req.body || {};
  const name = str(b.name, { min: 2, max: 80, field: 'Ism familiya' });
  const shop = str(b.shop, { max: 100, field: "Do'kon nomi" });
  const ph = phone(b.phone);
  const address = str(b.address, { min: 3, max: 300, field: 'Manzil' });
  const pw = password(b.password);
  if (get('SELECT 1 FROM users WHERE phone = ?', ph)) {
    throw new HttpError(409, "Bu raqam allaqachon ro'yxatdan o'tgan. Kirish bo'limidan foydalaning.");
  }
  const hash = await hashPassword(pw);
  let userId;
  try {
    userId = Number(run(`INSERT INTO users (role, name, shop, phone, address, password_hash, created_at)
                         VALUES ('customer', ?, ?, ?, ?, ?, ?)`, name, shop, ph, address, hash, Date.now()).lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, "Bu raqam allaqachon ro'yxatdan o'tgan.");
    throw e;
  }
  createSession(req, res, userId);
  res.status(201).json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', userId)) });
});

r.post('/auth/login', async (req, res) => {
  const b = req.body || {};
  let ph;
  try { ph = phone(b.phone); } catch { throw new HttpError(400, "Telefon raqamni to'liq kiriting"); }
  loginLimit(`${req.ip}|${ph}`);
  const pw = typeof b.password === 'string' ? b.password : '';
  const u = get('SELECT * FROM users WHERE phone = ?', ph);
  const ok = await verifyPassword(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Telefon raqam yoki parol noto'g'ri");
  // "Admin sifatida kirish" sahifasidan faqat admin kiradi
  if (b.as === 'admin' && u.role !== 'admin') {
    throw new HttpError(403, "Bu hisob admin emas. Mijozlar asosiy sahifadan kiradi.");
  }
  if (!u.active) {
    throw new HttpError(403, u.role === 'admin'
      ? "Hisobingiz bloklangan. Super admin bilan bog'laning."
      : "Hisobingiz bloklangan. Ta'minotchi bilan bog'laning.");
  }
  run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), u.id);
  createSession(req, res, u.id);
  res.json({ user: publicUser(u) });
});

// Super admin alohida sahifadan (/super) login va parol bilan kiradi
const superLimit = rateLimiter({ windowMs: 15 * 60e3, max: 8, message: "Juda ko'p urinish bo'ldi. 15 daqiqadan keyin qayta urinib ko'ring." });
r.post('/auth/super-login', async (req, res) => {
  const b = req.body || {};
  let lg;
  try { lg = loginField(b.login); } catch { throw new HttpError(401, "Login yoki parol noto'g'ri"); }
  superLimit(`${req.ip}|${lg.toLowerCase()}`);
  const u = get("SELECT * FROM users WHERE role = 'superadmin' AND login = ?", lg);
  const ok = await verifyPassword(typeof b.password === 'string' ? b.password : '', u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Login yoki parol noto'g'ri");
  if (!u.active) throw new HttpError(403, 'Hisob bloklangan');
  run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), u.id);
  createSession(req, res, u.id);
  res.json({ user: publicUser(u) });
});

r.post('/auth/logout', (req, res) => {
  if (req.sessionHash) events.dropSession(req.sessionHash);
  destroySession(req, res);
  res.json({ ok: true });
});

r.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

r.put('/me', requireAuth, (req, res) => {
  const b = req.body || {};
  const name = str(b.name, { min: 2, max: 80, field: 'Ism' });
  if (req.user.role === 'customer') {
    const shop = str(b.shop, { max: 100, field: "Do'kon nomi" });
    const address = str(b.address, { min: 3, max: 300, field: 'Manzil' });
    run('UPDATE users SET name = ?, shop = ?, address = ? WHERE id = ?', name, shop, address, req.user.id);
  } else {
    run('UPDATE users SET name = ? WHERE id = ?', name, req.user.id);
  }
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

r.post('/me/password', requireAuth, async (req, res) => {
  const b = req.body || {};
  loginLimit(`${req.ip}|pw|${req.user.id}`);
  if (!(await verifyPassword(String(b.current || ''), req.user.password_hash))) {
    throw new HttpError(400, "Hozirgi parol noto'g'ri");
  }
  const next = req.user.role === 'customer' ? password(b.next) : staffPassword(b.next);
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
  // Boshqa qurilmalardagi kirishlarni bekor qilamiz, shu qurilma qoladi
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, req.sessionHash);
  res.json({ ok: true });
});

r.get('/events', requireMember, (req, res) => events.subscribe(req, res));

// Menyudagi belgilar uchun: yangi buyurtmalar va o'qilmagan xabarlar soni
r.get('/summary', requireAuth, (req, res) => {
  if (req.user.role === 'superadmin') return res.json({ newOrders: 0, unread: 0 });
  if (req.user.role === 'admin') {
    res.json({
      newOrders: get("SELECT COUNT(*) n FROM orders WHERE status = 'yangi'").n,
      unread: get("SELECT COUNT(*) n FROM messages WHERE sender = 'customer' AND read_at IS NULL").n,
    });
  } else {
    res.json({
      newOrders: 0,
      unread: get("SELECT COUNT(*) n FROM messages WHERE customer_id = ? AND sender = 'admin' AND read_at IS NULL", req.user.id).n,
    });
  }
});

module.exports = r;

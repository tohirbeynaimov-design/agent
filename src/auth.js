'use strict';
// Kirish: parollar scrypt bilan xeshlanadi, sessiya HttpOnly cookie'da saqlanadi
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');
const { get, run } = require('./db');
const { HttpError } = require('./util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sid';
const DAY = 86400000;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltB64, keyB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = await scrypt(pw, Buffer.from(saltB64, 'base64'), key.length);
  return crypto.timingSafeEqual(key, test);
}
// Foydalanuvchi topilmaganda ham vaqt bir xil ketishi uchun
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, token, maxAgeMs) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,           // https orqali ochilganda faqat https'da yuboriladi
    maxAge: maxAgeMs,
    path: '/',
  });
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token), userId, now, now + config.sessionDays * DAY);
  setCookie(req, res, token, config.sessionDays * DAY);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

const publicUser = u => u && ({ id: u.id, role: u.role, login: u.login || null, name: u.name, shop: u.shop, phone: u.phone, address: u.address });

// Har bir so'rovda: cookie bo'yicha foydalanuvchini aniqlaymiz
function loadUser(req, res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  const now = Date.now();
  const s = get(`SELECT s.token_hash, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`, sha256(token), now);
  if (!s) return next();
  // Faol foydalanuvchining sessiyasini avtomatik uzaytiramiz
  if (s.expires_at - now < (config.sessionDays * DAY) / 2) {
    run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', now + config.sessionDays * DAY, s.token_hash);
    setCookie(req, res, token, config.sessionDays * DAY);
  }
  req.user = s;
  req.sessionHash = s.token_hash;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Iltimos, tizimga kiring'));
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Iltimos, tizimga kiring'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Bu amal faqat admin uchun'));
  next();
}
function requireCustomer(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Iltimos, tizimga kiring'));
  if (req.user.role !== 'customer') return next(new HttpError(403, 'Bu amal faqat mijoz uchun'));
  next();
}
// Do'kon ishlari (mahsulot, buyurtma, chat) — faqat admin va mijoz. Super admin bu ma'lumotlarni ko'rmaydi
function requireMember(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Iltimos, tizimga kiring'));
  if (req.user.role !== 'admin' && req.user.role !== 'customer') return next(new HttpError(403, "Bu bo'lim sizga ochiq emas"));
  next();
}
function requireSuper(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Iltimos, tizimga kiring'));
  if (req.user.role !== 'superadmin') return next(new HttpError(403, 'Bu amal faqat super admin uchun'));
  next();
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, createSession, destroySession, publicUser,
  loadUser, requireAuth, requireAdmin, requireCustomer, requireMember, requireSuper, sha256,
};

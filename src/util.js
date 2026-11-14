'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new HttpError(400, msg);

// ---------- kiritilgan ma'lumotni tekshirish ----------
function str(v, { max = 200, min = 0, field = 'Maydon' } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (s.length < min) throw bad(min <= 1 ? `${field}ni to'ldiring` : `${field} kamida ${min} belgidan iborat bo'lsin`);
  if (s.length > max) throw bad(`${field} juda uzun (ko'pi bilan ${max} belgi)`);
  return s;
}
// +998 90 123 45 67, 901234567, 998901234567 -> 998901234567
function phone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;
  if (!/^998\d{9}$/.test(d)) throw bad("Telefon raqamni to'liq kiriting: +998 va 9 ta raqam");
  return d;
}
function password(v) {
  const s = typeof v === 'string' ? v : '';
  if (s.length < 6) throw bad("Parol kamida 6 belgidan iborat bo'lsin");
  if (s.length > 200) throw bad('Parol juda uzun');
  return s;
}
// Admin va super admin uchun juda oddiy parollarni rad etamiz
const WEAK = ['admin12345', 'bu-yerga-kuchli-parol-yozing', '12345678', '123456789', 'password', 'qwerty123'];
function isWeakPassword(pw) { return typeof pw !== 'string' || pw.length < 8 || WEAK.includes(pw.toLowerCase()); }
function staffPassword(v) {
  const s = password(v);
  if (isWeakPassword(s)) throw bad("Admin paroli kamida 8 belgidan iborat va oddiy bo'lmasligi kerak");
  return s;
}
// Super admin logini: lotin harflari, raqamlar, nuqta, chiziqcha, pastki chiziq
function login(v) {
  const s = str(v, { min: 3, max: 40, field: 'Login' });
  if (!/^[A-Za-z0-9_.-]+$/.test(s)) throw bad("Login faqat lotin harflari, raqamlar va . _ - belgilaridan iborat bo'lsin");
  return s;
}
function int(v, { min = -Infinity, max = Infinity, field = 'Son' } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.round(n) !== n || n < min || n > max) throw bad(`${field} noto'g'ri`);
  return n;
}
function id(v) { return int(v, { min: 1, field: 'ID' }); }

// ---------- oddiy so'rovlar cheklovi (parol terish hujumlariga qarshi) ----------
function rateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return key => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    if (h.n > max) throw new HttpError(429, message);
  };
}

// ---------- rasmlar ----------
const MAX_IMAGE = 3 * 1024 * 1024;
function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
// "data:image/jpeg;base64,..." -> /uploads/<tasodifiy nom>.jpg
function saveImage(dataUrl, prefix) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad("Rasm formati noto'g'ri. JPG, PNG yoki WebP yuklang.");
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE) throw bad('Rasm juda katta (ko\'pi bilan 3 MB)');
  const ext = detectImage(buf);
  if (!ext) throw bad("Fayl rasm emas. JPG, PNG yoki WebP yuklang.");
  const name = `${prefix}_${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, name), buf);
  return '/uploads/' + name;
}
function removeImage(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  fs.rm(path.join(config.uploadsDir, path.basename(url)), { force: true }, () => {});
}

module.exports = {
  HttpError, bad, str, phone, password, staffPassword, isWeakPassword, login, int, id, rateLimiter, saveImage, removeImage,
};

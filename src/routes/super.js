'use strict';
// Super admin: faqat admin hisoblarini boshqaradi (qo'shish, tahrirlash, parol, bloklash, o'chirish).
// Buyurtma, mahsulot, hisobot va chatga super admin kira olmaydi.
const express = require('express');
const { get, all, run } = require('../db');
const { HttpError, bad, str, phone, staffPassword, int, id } = require('../util');
const { requireSuper, hashPassword } = require('../auth');
const events = require('../events');

const r = express.Router();

const adminOut = a => ({
  id: a.id, name: a.name, phone: a.phone, active: !!a.active, createdAt: a.created_at, lastLoginAt: a.last_login_at,
  customerLimit: a.customer_limit,
  customersAdded: get("SELECT COUNT(*) n FROM users WHERE role = 'customer' AND created_by = ?", a.id).n,
});
// Admin nechta mijoz qo'sha oladi — super admin belgilaydi
function readLimit(v) {
  if (v === undefined || v === null || String(v).trim() === '') throw bad("Admin nechta mijoz qo'sha olishini kiriting");
  return int(v, { min: 0, max: 100_000, field: 'Mijozlar soni' });
}

function getAdmin(rawId) {
  const a = get("SELECT * FROM users WHERE id = ? AND role = 'admin'", id(rawId));
  if (!a) throw new HttpError(404, 'Admin topilmadi');
  return a;
}
function ensurePhoneFree(ph, exceptId = 0) {
  const u = get('SELECT id, role FROM users WHERE phone = ?', ph);
  if (u && u.id !== exceptId) {
    throw new HttpError(409, u.role === 'customer'
      ? "Bu raqam bilan mijoz ro'yxatdan o'tgan. Admin uchun boshqa raqam kiriting."
      : 'Bu raqam boshqa admin hisobida ishlatilgan');
  }
}
// Hisob bloklansa yoki paroli almashsa — barcha kirishlari darhol bekor qilinadi
function signOutEverywhere(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
  events.dropUser(userId);
}

r.get('/super/admins', requireSuper, (req, res) => {
  res.json({ admins: all("SELECT * FROM users WHERE role = 'admin' ORDER BY id").map(adminOut) });
});

r.post('/super/admins', requireSuper, async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, { min: 2, max: 80, field: 'Ism familiya' });
  const ph = phone(b.phone);
  const pw = staffPassword(b.password);
  const limit = readLimit(b.customerLimit);
  ensurePhoneFree(ph);
  const newId = Number(run(`INSERT INTO users (role, name, phone, password_hash, created_at, created_by, customer_limit)
                            VALUES ('admin', ?, ?, ?, ?, ?, ?)`, name, ph, await hashPassword(pw), Date.now(), req.user.id, limit).lastInsertRowid);
  res.status(201).json({ admin: adminOut(get('SELECT * FROM users WHERE id = ?', newId)) });
});

r.put('/super/admins/:id', requireSuper, (req, res) => {
  const a = getAdmin(req.params.id);
  const b = req.body || {};
  const name = str(b.name, { min: 2, max: 80, field: 'Ism familiya' });
  const ph = phone(b.phone);
  const limit = b.customerLimit === undefined ? a.customer_limit : readLimit(b.customerLimit);
  ensurePhoneFree(ph, a.id);
  run('UPDATE users SET name = ?, phone = ?, customer_limit = ? WHERE id = ?', name, ph, limit, a.id);
  res.json({ admin: adminOut(get('SELECT * FROM users WHERE id = ?', a.id)) });
});

r.put('/super/admins/:id/password', requireSuper, async (req, res) => {
  const a = getAdmin(req.params.id);
  const pw = staffPassword((req.body || {}).password);
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw), a.id);
  signOutEverywhere(a.id);
  res.json({ ok: true });
});

r.post('/super/admins/:id/active', requireSuper, (req, res) => {
  const a = getAdmin(req.params.id);
  const active = (req.body || {}).active === true ? 1 : 0;
  run('UPDATE users SET active = ? WHERE id = ?', active, a.id);
  if (!active) signOutEverywhere(a.id);
  res.json({ ok: true, active: !!active });
});

r.delete('/super/admins/:id', requireSuper, (req, res) => {
  const a = getAdmin(req.params.id);
  signOutEverywhere(a.id);
  run('DELETE FROM users WHERE id = ?', a.id);
  res.json({ ok: true });
});

module.exports = r;

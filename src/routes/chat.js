'use strict';
const express = require('express');
const { get, all, run } = require('../db');
const { HttpError, bad, str, id, saveImage, rateLimiter } = require('../util');
const { requireMember, requireAdmin } = require('../auth');
const events = require('../events');

const r = express.Router();
const sendLimit = rateLimiter({ windowMs: 60e3, max: 40, message: "Juda tez yozyapsiz. Bir daqiqadan keyin davom eting." });

const msgOut = m => ({
  id: m.id, customerId: m.customer_id, sender: m.sender, text: m.text, photo: m.photo, createdAt: m.created_at, readAt: m.read_at,
});

// Qaysi mijoz bilan suhbat: admin uchun — so'rovdagi mijoz, mijoz uchun — o'zi
function threadOf(req, raw) {
  if (req.user.role === 'customer') return req.user.id;
  const cid = id(raw);
  if (!get("SELECT 1 FROM users WHERE id = ? AND role = 'customer'", cid)) throw new HttpError(404, 'Mijoz topilmadi');
  return cid;
}

r.get('/chat/messages', requireMember, (req, res) => {
  const cid = threadOf(req, req.query.customerId);
  const rows = all('SELECT * FROM (SELECT * FROM messages WHERE customer_id = ? ORDER BY id DESC LIMIT 300) ORDER BY id', cid);
  res.json({ messages: rows.map(msgOut) });
});

r.post('/chat/messages', requireMember, (req, res) => {
  const b = req.body || {};
  sendLimit(req.user.id);
  const cid = threadOf(req, b.customerId);
  const text = str(b.text, { max: 2000, field: 'Xabar' });
  const photo = b.photo ? saveImage(b.photo, 'm') : '';
  if (!text && !photo) throw bad("Xabar bo'sh");
  const sender = req.user.role === 'admin' ? 'admin' : 'customer';
  const mid = Number(run(`INSERT INTO messages (customer_id, sender, sender_id, text, photo, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    cid, sender, req.user.id, text, photo, Date.now()).lastInsertRowid);
  const who = sender === 'admin' ? 'Admin' : (req.user.shop || req.user.name);
  events.emit('message', { id: mid, customerId: cid, sender, from: who, text: text.slice(0, 120), photo: !!photo }, { customerId: cid });
  res.status(201).json({ message: msgOut(get('SELECT * FROM messages WHERE id = ?', mid)) });
});

// Qarshi tomondan kelgan xabarlarni "o'qildi" deb belgilash
r.post('/chat/read', requireMember, (req, res) => {
  const cid = threadOf(req, (req.body || {}).customerId);
  const other = req.user.role === 'admin' ? 'customer' : 'admin';
  const { changes } = run('UPDATE messages SET read_at = ? WHERE customer_id = ? AND sender = ? AND read_at IS NULL', Date.now(), cid, other);
  if (changes > 0) events.emit('read', { customerId: cid, by: req.user.role }, { customerId: cid });
  res.json({ ok: true, marked: Number(changes) });
});

// Admin: suhbatlar ro'yxati (oxirgi xabar bo'yicha)
r.get('/chat/conversations', requireAdmin, (req, res) => {
  const rows = all(`
    SELECT u.id, u.name, u.shop, u.phone,
           m.text last_text, m.photo last_photo, m.sender last_sender, m.created_at last_at,
           (SELECT COUNT(*) FROM messages x WHERE x.customer_id = u.id AND x.sender = 'customer' AND x.read_at IS NULL) unread
    FROM users u
    JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE customer_id = u.id)
    WHERE u.role = 'customer'
    ORDER BY m.id DESC`);
  res.json({
    conversations: rows.map(c => ({
      customer: { id: c.id, name: c.name, shop: c.shop, phone: c.phone },
      last: { text: c.last_text, photo: !!c.last_photo, sender: c.last_sender, at: c.last_at },
      unread: c.unread,
    })),
  });
});

module.exports = r;

'use strict';
const express = require('express');
const { get, all, run } = require('../db');
const { HttpError, bad, str, int, id, password } = require('../util');
const { requireAdmin, hashPassword } = require('../auth');
const { STATUS_LABEL } = require('../constants');
const events = require('../events');

const r = express.Router();
const DAY = 86400000;

// ---------- Mijozlar ----------
r.get('/admin/customers', requireAdmin, (req, res) => {
  const rows = all(`
    SELECT u.id, u.name, u.shop, u.phone, u.address, u.created_at,
           COUNT(o.id) n, COALESCE(SUM(o.total), 0) sum, MAX(o.created_at) last
    FROM users u
    LEFT JOIN orders o ON o.customer_id = u.id AND o.status != 'bekor'
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY sum DESC, u.id DESC`);
  res.json({
    customers: rows.map(c => ({
      id: c.id, name: c.name, shop: c.shop, phone: c.phone, address: c.address, createdAt: c.created_at,
      orders: c.n, sum: c.sum, lastOrderAt: c.last,
    })),
  });
});

// Mijoz parolini unutsa — admin yangi parol qo'yib beradi
r.put('/admin/customers/:id/password', requireAdmin, async (req, res) => {
  const cid = id(req.params.id);
  if (!get("SELECT 1 FROM users WHERE id = ? AND role = 'customer'", cid)) throw new HttpError(404, 'Mijoz topilmadi');
  const pw = password((req.body || {}).password);
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw), cid);
  run('DELETE FROM sessions WHERE user_id = ?', cid);   // eski kirishlar bekor bo'ladi
  events.dropUser(cid);
  res.json({ ok: true });
});

// ---------- Hisobotlar ----------
function buildReport(query) {
  const from = int(query.from, { min: 0, field: 'Sana' });
  const to = int(query.to, { min: 0, field: 'Sana' });
  if (to <= from) throw bad("Hisobot davri noto'g'ri");
  if (to - from > 93 * DAY) throw bad("Hisobot davri ko'pi bilan 3 oy bo'lishi mumkin");
  const basis = query.basis === 'barcha' ? 'barcha' : 'yetkazildi';
  const cond = basis === 'yetkazildi' ? "o.status = 'yetkazildi'" : "o.status != 'bekor'";
  const range = 'o.created_at >= ? AND o.created_at < ?';

  const orders = all(`SELECT o.id, o.status, o.total, o.created_at, u.id cid, u.name, u.shop
                      FROM orders o JOIN users u ON u.id = o.customer_id
                      WHERE ${range} AND ${cond} ORDER BY o.created_at`, from, to);
  const inPeriod = get(`SELECT COUNT(*) n FROM orders o WHERE ${range}`, from, to).n;
  const products = all(`
    SELECT COALESCE(p.name, MAX(oi.name)) name, oi.unit, SUM(oi.qty) qty, SUM(oi.sum) sum
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE ${range} AND ${cond}
    GROUP BY COALESCE(CAST(oi.product_id AS TEXT), 'n:' || oi.name), oi.unit
    ORDER BY sum DESC`, from, to);
  const customers = all(`
    SELECT u.id, u.name, u.shop, u.phone, COUNT(*) n, SUM(o.total) sum
    FROM orders o JOIN users u ON u.id = o.customer_id
    WHERE ${range} AND ${cond}
    GROUP BY u.id ORDER BY sum DESC`, from, to);

  // Kunlar bo'yicha savdo (davr brauzerdagi mahalliy kun boshidan boshlanadi)
  const days = Math.max(1, Math.round((to - from) / DAY));
  const series = new Array(days).fill(0);
  for (const o of orders) {
    const i = Math.floor((o.created_at - from) / DAY);
    if (i >= 0 && i < days) series[i] += o.total;
  }
  const total = orders.reduce((s, o) => s + o.total, 0);
  return {
    from, to, basis, total, count: orders.length, notCounted: inPeriod - orders.length, series,
    orders: orders.map(o => ({ id: o.id, status: o.status, total: o.total, createdAt: o.created_at, customer: { id: o.cid, name: o.name, shop: o.shop } })),
    products: products.map(p => ({ name: p.name, unit: p.unit, qty: Math.round(p.qty * 100) / 100, sum: p.sum })),
    customers: customers.map(c => ({ id: c.id, name: c.name, shop: c.shop, phone: c.phone, orders: c.n, sum: c.sum })),
  };
}

r.get('/admin/reports', requireAdmin, (req, res) => res.json(buildReport(req.query)));

// Excel'da ochiladigan CSV (nuqta-vergul bilan, UTF-8 BOM)
r.get('/admin/reports.csv', requireAdmin, (req, res) => {
  const rep = buildReport(req.query);
  const label = str(req.query.label, { max: 100, field: 'Nomi' }) || 'Hisobot';
  const fmtPhone = p => (p && p.length === 12 ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : p);
  const num = n => String(n).replace('.', ',');
  const pad = n => String(n).padStart(2, '0');
  const fmtDT = ts => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const rows = [
    [label],
    [rep.basis === 'yetkazildi' ? 'Faqat yetkazilgan buyurtmalar' : 'Barcha buyurtmalar (bekor qilinganlardan tashqari)'],
    [],
    ['Mahsulot', 'Birlik', 'Miqdor', "Summa (so'm)"],
    ...rep.products.map(p => [p.name, p.unit, num(p.qty), p.sum]),
    ['ITOGO', '', '', rep.total],
    [],
    ['Mijoz', 'Telefon', 'Buyurtmalar', "Summa (so'm)"],
    ...rep.customers.map(c => [c.shop || c.name, fmtPhone(c.phone), c.orders, c.sum]),
    ['ITOGO', '', rep.count, rep.total],
    [],
    ['Buyurtma', 'Sana', 'Mijoz', 'Holat', "Summa (so'm)"],
    ...rep.orders.map(o => [`#${o.id}`, fmtDT(o.createdAt), o.customer.shop || o.customer.name, STATUS_LABEL[o.status], o.total]),
  ];
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;   // Excel formulasi sifatida bajarilmasligi uchun
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + rows.map(row => row.map(cell).join(';')).join('\r\n');
  const f = new Date(rep.from);
  const day = `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="hisobot-${day}.csv"`);
  res.send(csv);
});

module.exports = r;

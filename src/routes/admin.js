'use strict';
const express = require('express');
const { get, all, run, tx } = require('../db');
const { HttpError, bad, str, int, id, phone, password } = require('../util');
const { requireAdmin, hashPassword } = require('../auth');
const { STATUS_LABEL } = require('../constants');
const events = require('../events');

const r = express.Router();
const DAY = 86400000;

// ---------- Mijozlar ----------
r.get('/admin/customers', requireAdmin, (req, res) => {
  const rows = all(`
    SELECT u.id, u.name, u.shop, u.phone, u.address, u.created_at, u.created_by, a.name added_by,
           COUNT(o.id) n, COALESCE(SUM(o.total), 0) sum, MAX(o.created_at) last
    FROM users u
    LEFT JOIN users a ON a.id = u.created_by
    LEFT JOIN orders o ON o.customer_id = u.id AND o.status != 'bekor'
    WHERE u.role = 'customer' AND u.deleted_at IS NULL
    GROUP BY u.id
    ORDER BY sum DESC, u.id DESC`);
  res.json({
    customers: rows.map(c => ({
      id: c.id, name: c.name, shop: c.shop, phone: c.phone, address: c.address, createdAt: c.created_at,
      orders: c.n, sum: c.sum, lastOrderAt: c.last, addedBy: c.added_by || '', mine: c.created_by === req.user.id,
    })),
    limit: { used: addedBy(req.user.id), max: req.user.customer_limit },
  });
});

// Shu admin qo'shgan mijozlar soni (limit shu bo'yicha hisoblanadi)
const addedBy = adminId => get("SELECT COUNT(*) n FROM users WHERE role = 'customer' AND created_by = ? AND deleted_at IS NULL", adminId).n;
function readCustomer(b = {}) {
  return {
    name: str(b.name, { min: 2, max: 80, field: 'Ism familiya' }),
    shop: str(b.shop, { max: 100, field: "Do'kon nomi" }),
    phone: phone(b.phone),
    address: str(b.address, { min: 3, max: 300, field: 'Manzil' }),
  };
}
function ensurePhoneFree(ph, exceptId = 0) {
  const u = get('SELECT id, role FROM users WHERE phone = ?', ph);
  if (u && u.id !== exceptId) {
    throw new HttpError(409, u.role === 'customer' ? "Bu raqam bilan mijoz allaqachon qo'shilgan" : 'Bu raqam xodim hisobida ishlatilgan');
  }
}

// Mijozni admin qo'shadi: mijoz shu telefon raqam va parol bilan kiradi
r.post('/admin/customers', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const c = readCustomer(b);
  const hash = await hashPassword(password(b.password));
  const newId = tx(() => {
    const max = get('SELECT customer_limit FROM users WHERE id = ?', req.user.id).customer_limit;
    if (max !== null && addedBy(req.user.id) >= max) {
      throw new HttpError(403, max === 0
        ? "Sizga mijoz qo'shish ruxsat etilmagan. Super admin bilan bog'laning."
        : `Siz ko'pi bilan ${max} ta mijoz qo'sha olasiz. Limitni oshirish uchun super admin bilan bog'laning.`);
    }
    ensurePhoneFree(c.phone);
    return Number(run(`INSERT INTO users (role, name, shop, phone, address, password_hash, created_at, created_by)
                       VALUES ('customer', ?, ?, ?, ?, ?, ?, ?)`, c.name, c.shop, c.phone, c.address, hash, Date.now(), req.user.id).lastInsertRowid);
  });
  res.status(201).json({ customer: { id: newId, ...c } });
});

// Mijozni o'chirish. Buyurtmasi yo'q bo'lsa — butunlay; bor bo'lsa — buyurtmalar va hisobotlar saqlanadi,
// mijoz esa ro'yxatdan yo'qoladi, kira olmaydi va telefon raqami boshqa mijoz uchun bo'shaydi.
r.delete('/admin/customers/:id', requireAdmin, (req, res) => {
  const cid = id(req.params.id);
  if (!get("SELECT 1 FROM users WHERE id = ? AND role = 'customer' AND deleted_at IS NULL", cid)) throw new HttpError(404, 'Mijoz topilmadi');
  tx(() => {
    if (get('SELECT 1 FROM orders WHERE customer_id = ? LIMIT 1', cid)) {
      run("UPDATE users SET deleted_at = ?, active = 0, phone = 'o:' || id || ':' || phone WHERE id = ?", Date.now(), cid);
      run('DELETE FROM sessions WHERE user_id = ?', cid);
      run('UPDATE messages SET read_at = ? WHERE customer_id = ? AND read_at IS NULL', Date.now(), cid);   // menyudagi belgi qolib ketmasin
    } else {
      run('DELETE FROM users WHERE id = ?', cid);   // sessiyalar va xabarlar ham o'chadi
    }
  });
  events.dropUser(cid);
  res.json({ ok: true });
});

// Mijoz ma'lumotlarini tuzatish (masalan, telefon raqam xato yozilgan bo'lsa)
r.put('/admin/customers/:id', requireAdmin, (req, res) => {
  const cid = id(req.params.id);
  if (!get("SELECT 1 FROM users WHERE id = ? AND role = 'customer' AND deleted_at IS NULL", cid)) throw new HttpError(404, 'Mijoz topilmadi');
  const c = readCustomer(req.body);
  ensurePhoneFree(c.phone, cid);
  run('UPDATE users SET name = ?, shop = ?, phone = ?, address = ? WHERE id = ?', c.name, c.shop, c.phone, c.address, cid);
  res.json({ customer: { id: cid, ...c } });
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
  const { from, to } = readPeriod(query);
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

// ---------- Ombor hisobi: davr boshidagi qoldiq, kirdi, chiqdi, oxiridagi qoldiq va har bir harakat ----------
const MOVE_LABEL = { boshlangich: "Boshlang'ich qoldiq", kirim: 'Kirim', chiqim: 'Chiqim', tuzatish: 'Sanoq (tuzatish)', buyurtma: 'Buyurtma', qaytdi: 'Bekor qilindi, qaytdi' };
const r2 = n => Math.round(n * 100) / 100;
function readPeriod(query) {
  const from = int(query.from, { min: 0, field: 'Sana' });
  const to = int(query.to, { min: 0, field: 'Sana' });
  if (to <= from) throw bad("Hisobot davri noto'g'ri");
  if (to - from > 93 * DAY) throw bad("Hisobot davri ko'pi bilan 3 oy bo'lishi mumkin");
  return { from, to };
}
function buildStock(query) {
  const { from, to } = readPeriod(query);
  // O'chirilgan mahsulot (product_id = NULL) nomi va birligi bo'yicha ajratiladi
  const KEY = "COALESCE(CAST(m.product_id AS TEXT), 'n:' || m.name || '|' || m.unit)";
  const lastBefore = t => all(`
    SELECT ${KEY} k, m.after, MAX(m.id) last_id, COALESCE(p.name, m.name) name, COALESCE(p.unit, m.unit) unit, p.category, p.id pid
    FROM stock_moves m LEFT JOIN products p ON p.id = m.product_id
    WHERE m.at < ? GROUP BY k`, t);
  const start = new Map(lastBefore(from).map(x => [x.k, x.after]));
  const sums = new Map(all(`
    SELECT ${KEY} k, SUM(CASE WHEN m.qty > 0 THEN m.qty ELSE 0 END) inn, SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END) out, COUNT(*) n
    FROM stock_moves m WHERE m.at >= ? AND m.at < ? GROUP BY k`, from, to).map(x => [x.k, x]));
  const products = lastBefore(to)
    .filter(x => x.pid !== null || sums.has(x.k))   // o'chirilgan mahsulot faqat shu davrda harakati bo'lsa ko'rinadi
    .map(x => {
      const s = sums.get(x.k);
      return { name: x.name, unit: x.unit, category: x.category || '', deleted: x.pid === null,
               start: r2(start.get(x.k) ?? 0), in: r2(s?.inn ?? 0), out: r2(s?.out ?? 0), end: r2(x.after), moves: s?.n ?? 0 };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const moves = all(`
    SELECT m.id, m.kind, m.qty, m.after, m.order_id, m.at, COALESCE(p.name, m.name) name, COALESCE(p.unit, m.unit) unit,
           u.name u_name, u.shop u_shop, u.role u_role
    FROM stock_moves m LEFT JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.by_user
    WHERE m.at >= ? AND m.at < ? ORDER BY m.at DESC, m.id DESC LIMIT 5000`, from, to);
  const untracked = get('SELECT COUNT(*) n FROM products WHERE stock IS NULL').n;
  return {
    from, to, products, untracked,
    moves: moves.map(m => ({
      id: m.id, kind: m.kind, qty: m.qty, after: m.after, orderId: m.order_id, at: m.at, name: m.name, unit: m.unit,
      by: m.u_name ? (m.u_role === 'customer' ? m.u_shop || m.u_name : m.u_name) : '',
    })),
  };
}

r.get('/admin/stock-report', requireAdmin, (req, res) => res.json(buildStock(req.query)));

// Excel'da ochiladigan CSV (nuqta-vergul bilan, UTF-8 BOM)
const pad = n => String(n).padStart(2, '0');
const num = n => String(n).replace('.', ',');
const fmtDT = ts => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function sendCsv(res, rows, name, from) {
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;   // Excel formulasi sifatida bajarilmasligi uchun
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '\ufeff' + rows.map(row => row.map(cell).join(';')).join('\r\n');
  const f = new Date(from);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}-${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}.csv"`);
  res.send(csv);
}

r.get('/admin/reports.csv', requireAdmin, (req, res) => {
  const rep = buildReport(req.query);
  const label = str(req.query.label, { max: 100, field: 'Nomi' }) || 'Hisobot';
  const fmtPhone = p => (p && p.length === 12 ? `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : p);
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
  sendCsv(res, rows, 'hisobot', rep.from);
});

r.get('/admin/stock-report.csv', requireAdmin, (req, res) => {
  const rep = buildStock(req.query);
  const label = str(req.query.label, { max: 100, field: 'Nomi' }) || 'Ombor hisobi';
  const sign = n => (n > 0 ? '+' : '') + num(n);
  const rows = [
    [label],
    [],
    ['Mahsulot', 'Birlik', 'Davr boshida', 'Kirdi', 'Chiqdi', 'Davr oxirida'],
    ...rep.products.map(p => [p.name + (p.deleted ? " (o'chirilgan)" : ''), 'dona', num(p.start), num(p.in), num(p.out), num(p.end)]),
    [],
    ['Sana', 'Mahsulot', 'Harakat', 'Miqdor', 'Birlik', 'Qoldiq', 'Buyurtma', 'Kim'],
    ...rep.moves.slice().reverse().map(m => [fmtDT(m.at), m.name, MOVE_LABEL[m.kind], sign(m.qty), 'dona', num(m.after), m.orderId ? `#${m.orderId}` : '', m.by]),
  ];
  sendCsv(res, rows, 'ombor', rep.from);
});

module.exports = r;

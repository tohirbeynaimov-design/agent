'use strict';
const express = require('express');
const { get, all, run, tx } = require('../db');
const { HttpError, bad, str, id } = require('../util');
const { requireMember, requireAdmin, requireCustomer } = require('../auth');
const { STATUSES } = require('../constants');
const { takeOrder, returnOrder } = require('../stock');
const events = require('../events');
const productsChanged = () => events.emit('products', {}, { all: true });

const r = express.Router();

function itemsFor(orderIds) {
  const map = new Map(orderIds.map(i => [i, []]));
  if (!orderIds.length) return map;
  const rows = all(`SELECT * FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY id`, ...orderIds);
  for (const it of rows) {
    map.get(it.order_id)?.push({ productId: it.product_id, name: it.name, unit: it.unit, price: it.price, qty: it.qty, sum: it.sum });
  }
  return map;
}

function orderOut(o, items) {
  const out = {
    id: o.id, status: o.status, total: o.total, address: o.address, comment: o.comment,
    createdAt: o.created_at, updatedAt: o.updated_at, items: items || [],
  };
  if (o.c_name !== undefined) out.customer = { id: o.customer_id, name: o.c_name, shop: o.c_shop, phone: o.c_phone };
  return out;
}

const ORDER_SELECT = `SELECT o.*, u.name c_name, u.shop c_shop, u.phone c_phone FROM orders o JOIN users u ON u.id = o.customer_id`;

function withItems(rows) {
  const items = itemsFor(rows.map(o => o.id));
  return rows.map(o => orderOut(o, items.get(o.id)));
}

function setStatus(orderId, status, userId) {
  const now = Date.now();
  run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, now, orderId);
  run('INSERT INTO order_history (order_id, status, at, by_user) VALUES (?, ?, ?, ?)', orderId, status, now, userId);
}

// ---------- Mijoz buyurtma beradi ----------
r.post('/orders', requireCustomer, (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.items) || !b.items.length) throw bad("Savat bo'sh");
  if (b.items.length > 100) throw bad("Bitta buyurtmada ko'pi bilan 100 xil mahsulot bo'lishi mumkin");
  const address = str(b.address, { min: 3, max: 300, field: 'Yetkazib berish manzili' });
  const comment = str(b.comment, { max: 500, field: 'Izoh' });

  // Bir xil mahsulotni birlashtiramiz; narxni FAQAT bazadan olamiz (mijoz yuborgan narxga ishonilmaydi)
  const qtyById = new Map();
  for (const it of b.items) {
    const pid = id(it && it.productId);
    const qty = Math.round(Number(it && it.qty) * 100) / 100;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) throw bad("Mahsulot miqdori noto'g'ri");
    qtyById.set(pid, Math.round(((qtyById.get(pid) || 0) + qty) * 100) / 100);
  }
  const lines = [];
  for (const [pid, qty] of qtyById) {
    const p = get('SELECT * FROM products WHERE id = ?', pid);
    if (!p) throw bad("Savatdagi mahsulotlardan biri endi mavjud emas. Savatni yangilang.");
    if (!p.active) throw bad(`"${p.name}" hozir sotuvda yo'q. Uni savatdan olib tashlang.`);
    // Ombordagi qoldiq yetarliligi pastda, tranzaksiya ichida tekshiriladi (takeOrder)
    lines.push({ p, qty, sum: Math.round(p.price * qty) });
  }
  const total = lines.reduce((s, l) => s + l.sum, 0);
  const now = Date.now();

  const orderId = tx(() => {
    const oid = Number(run(`INSERT INTO orders (customer_id, status, total, address, comment, created_at, updated_at)
                            VALUES (?, 'yangi', ?, ?, ?, ?, ?)`, req.user.id, total, address, comment, now, now).lastInsertRowid);
    for (const l of lines) {
      run(`INSERT INTO order_items (order_id, product_id, name, unit, price, qty, sum) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        oid, l.p.id, l.p.name, l.p.unit, l.p.price, l.qty, l.sum);
    }
    run('INSERT INTO order_history (order_id, status, at, by_user) VALUES (?, ?, ?, ?)', oid, 'yangi', now, req.user.id);
    takeOrder(oid);   // ombordan ayiramiz; yetmasa butun buyurtma bekor bo'ladi
    return oid;
  });

  events.emit('order:new', { id: orderId, customerId: req.user.id, total, shop: req.user.shop || req.user.name }, { customerId: req.user.id });
  productsChanged();
  const [order] = withItems([get(`${ORDER_SELECT} WHERE o.id = ?`, orderId)]);
  res.status(201).json({ order });
});

// ---------- Buyurtmalar ro'yxati ----------
const FILTERS = {
  faol: "o.status IN ('yangi','yigilmoqda','yolda')",
  yangi: "o.status = 'yangi'",
  yigilmoqda: "o.status = 'yigilmoqda'",
  yolda: "o.status = 'yolda'",
  yetkazildi: "o.status = 'yetkazildi'",
  bekor: "o.status = 'bekor'",
  hammasi: '1 = 1',
};

r.get('/orders', requireMember, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  if (req.user.role === 'customer') {
    const rows = all(`${ORDER_SELECT} WHERE o.customer_id = ? ORDER BY o.id DESC LIMIT ? OFFSET ?`, req.user.id, limit, offset);
    const total = get('SELECT COUNT(*) n FROM orders WHERE customer_id = ?', req.user.id).n;
    return res.json({ orders: withItems(rows), total });
  }

  const filter = FILTERS[req.query.status] ? req.query.status : 'faol';
  const rows = all(`${ORDER_SELECT} WHERE ${FILTERS[filter]} ORDER BY o.id DESC LIMIT ? OFFSET ?`, limit, offset);
  const counts = {};
  for (const [k, cond] of Object.entries(FILTERS)) counts[k] = get(`SELECT COUNT(*) n FROM orders o WHERE ${cond}`).n;
  // "Bugun" — mijozning mahalliy vaqtidagi kun boshi (brauzer yuboradi)
  const since = Number(req.query.since) || 0;
  const today = get("SELECT COUNT(*) n, COALESCE(SUM(total), 0) s FROM orders WHERE created_at >= ? AND status != 'bekor'", since);
  res.json({ orders: withItems(rows), total: counts[filter], counts, today: { count: today.n, sum: today.s } });
});

r.get('/orders/:id', requireMember, (req, res) => {
  const o = get(`${ORDER_SELECT} WHERE o.id = ?`, id(req.params.id));
  if (!o || (req.user.role === 'customer' && o.customer_id !== req.user.id)) throw new HttpError(404, 'Buyurtma topilmadi');
  const [order] = withItems([o]);
  order.history = all('SELECT status, at FROM order_history WHERE order_id = ? ORDER BY id', o.id);
  if (req.user.role === 'admin') order.customer.address = get('SELECT address FROM users WHERE id = ?', o.customer_id)?.address || '';
  res.json({ order });
});

// ---------- Holatni o'zgartirish ----------
r.post('/orders/:id/status', requireAdmin, (req, res) => {
  const oid = id(req.params.id);
  const status = String((req.body || {}).status || '');
  if (!STATUSES.includes(status)) throw bad("Noma'lum holat");
  const o = get('SELECT * FROM orders WHERE id = ?', oid);
  if (!o) throw new HttpError(404, 'Buyurtma topilmadi');
  if (o.status !== status) {
    const stockMoved = tx(() => {
      // Bekor qilinsa — mahsulotlar omborga qaytadi; bekor qilingan buyurtma tiklansa — qayta ayiriladi
      const moved = status === 'bekor' ? returnOrder(oid) : o.status === 'bekor' ? takeOrder(oid) : false;
      setStatus(oid, status, req.user.id);
      return moved;
    });
    events.emit('order:status', { id: oid, status, customerId: o.customer_id }, { customerId: o.customer_id });
    if (stockMoved) productsChanged();
  }
  res.json({ ok: true, status });
});

// Mijoz o'z buyurtmasini faqat "Yangi" holatida bekor qila oladi
r.post('/orders/:id/cancel', requireCustomer, (req, res) => {
  const oid = id(req.params.id);
  const o = get('SELECT * FROM orders WHERE id = ? AND customer_id = ?', oid, req.user.id);
  if (!o) throw new HttpError(404, 'Buyurtma topilmadi');
  if (o.status === 'bekor') return res.json({ ok: true, status: 'bekor' });
  if (o.status !== 'yangi') {
    throw new HttpError(409, "Buyurtma yig'ilishni boshlagan, endi uni bekor qilib bo'lmaydi. Admin bilan chatda bog'laning.");
  }
  const stockMoved = tx(() => { const moved = returnOrder(oid); setStatus(oid, 'bekor', req.user.id); return moved; });
  events.emit('order:status', { id: oid, status: 'bekor', customerId: o.customer_id }, { customerId: o.customer_id });
  if (stockMoved) productsChanged();
  res.json({ ok: true, status: 'bekor' });
});

module.exports = r;

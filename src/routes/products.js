'use strict';
const express = require('express');
const { get, all, run, tx } = require('../db');
const { HttpError, bad, str, int, id, saveImage, removeImage } = require('../util');
const { requireMember, requireAdmin } = require('../auth');
const { UNITS } = require('../constants');
const { MAX_STOCK, r2, fmt, readStock, logMove } = require('../stock');
const events = require('../events');

const r = express.Router();

// Admin ombordagi aniq qoldiqni ko'radi, mijoz faqat "tugagan"mi yo'qmi — shuni biladi
const productOut = (p, admin = false) => {
  const out = { id: p.id, name: p.name, category: p.category, unit: p.unit, price: p.price, photo: p.photo, active: !!p.active };
  if (admin) out.stock = p.stock;
  else out.soldOut = p.stock !== null && p.stock <= 0;
  return out;
};

function readProduct(b = {}) {
  const unit = String(b.unit || '');
  if (!UNITS.includes(unit)) throw bad("O'lchov birligini tanlang");
  return {
    name: str(b.name, { min: 1, max: 120, field: 'Mahsulot nomi' }),
    category: str(b.category, { min: 1, max: 60, field: 'Kategoriya' }),
    unit,
    price: int(b.price, { min: 1, max: 10_000_000_000, field: 'Narx' }),
    active: b.active === false ? 0 : 1,
  };
}

const productsChanged = () => events.emit('products', {}, { all: true });

r.get('/products', requireMember, (req, res) => {
  const admin = req.user.role === 'admin';
  const rows = admin
    ? all('SELECT * FROM products ORDER BY id')
    : all('SELECT * FROM products WHERE active = 1 ORDER BY category, name');
  res.json({ products: rows.map(p => productOut(p, admin)), units: UNITS });
});

r.post('/products', requireAdmin, (req, res) => {
  const p = readProduct(req.body);
  const stock = readStock(req.body.stock);
  const photo = req.body.photo ? saveImage(req.body.photo, 'p') : '';
  const now = Date.now();
  const newId = tx(() => {
    const nid = Number(run(`INSERT INTO products (name, category, unit, price, photo, active, stock, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, p.name, p.category, p.unit, p.price, photo, p.active, stock, now, now).lastInsertRowid);
    logMove({ id: nid, ...p }, 'boshlangich', stock, stock, { by: req.user.id });
    return nid;
  });
  productsChanged();
  res.status(201).json({ product: productOut(get('SELECT * FROM products WHERE id = ?', newId), true) });
});

r.put('/products/:id', requireAdmin, (req, res) => {
  const pid = id(req.params.id);
  const old = get('SELECT * FROM products WHERE id = ?', pid);
  if (!old) throw new HttpError(404, 'Mahsulot topilmadi');
  const p = readProduct(req.body);
  // stock: berilmasa — o'zgarmaydi (qoldiq odatda "Ombor" bo'limidan o'zgartiriladi)
  const stock = req.body.stock === undefined ? old.stock : readStock(req.body.stock);
  // photo: berilmasa — eskisi qoladi; '' — o'chiriladi; data:... — yangisi saqlanadi
  let photo = old.photo;
  if (typeof req.body.photo === 'string' && req.body.photo !== old.photo) {
    photo = req.body.photo === '' ? '' : saveImage(req.body.photo, 'p');
  }
  tx(() => {
    run(`UPDATE products SET name = ?, category = ?, unit = ?, price = ?, photo = ?, active = ?, stock = ?, updated_at = ? WHERE id = ?`,
      p.name, p.category, p.unit, p.price, photo, p.active, stock, Date.now(), pid);
    if (stock !== old.stock && stock !== null) {
      logMove({ id: pid, ...p }, old.stock === null ? 'boshlangich' : 'tuzatish', stock - (old.stock ?? 0), stock, { by: req.user.id });
    }
  });
  if (photo !== old.photo) removeImage(old.photo);
  productsChanged();
  res.json({ product: productOut(get('SELECT * FROM products WHERE id = ?', pid), true) });
});

// Ombor: { add: 10 } — kirim (manfiy son — chiqim), { set: 8 } — aniq qoldiqni yozish (sanoqdan keyin)
r.post('/products/:id/stock', requireAdmin, (req, res) => {
  const pid = id(req.params.id);
  const p = get('SELECT * FROM products WHERE id = ?', pid);
  if (!p) throw new HttpError(404, 'Mahsulot topilmadi');
  const b = req.body || {};
  let next, kind;
  if (b.set !== undefined) { next = readStock(b.set, 'Qoldiq'); kind = p.stock === null ? 'boshlangich' : 'tuzatish'; }
  else {
    const add = r2(Number(String(b.add ?? '').replace(',', '.')));
    if (!Number.isFinite(add) || add === 0) throw bad('Miqdorni kiriting');
    next = r2((p.stock ?? 0) + add);
    if (next < 0) throw bad(`Omborda faqat ${fmt(p.stock ?? 0)} ${p.unit} bor`);
    if (next > MAX_STOCK) throw bad('Miqdor juda katta');
    kind = p.stock === null ? 'boshlangich' : add > 0 ? 'kirim' : 'chiqim';
  }
  tx(() => {
    run('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', next, Date.now(), pid);
    logMove(p, kind, next - (p.stock ?? 0), next, { by: req.user.id });
  });
  productsChanged();
  res.json({ product: productOut(get('SELECT * FROM products WHERE id = ?', pid), true) });
});

r.delete('/products/:id', requireAdmin, (req, res) => {
  const pid = id(req.params.id);
  const old = get('SELECT * FROM products WHERE id = ?', pid);
  if (!old) throw new HttpError(404, 'Mahsulot topilmadi');
  // Eski buyurtmalarda mahsulot nomi va narxi saqlanib qoladi
  run('DELETE FROM products WHERE id = ?', pid);
  removeImage(old.photo);
  productsChanged();
  res.json({ ok: true });
});

module.exports = r;

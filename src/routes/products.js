'use strict';
const express = require('express');
const { get, all, run } = require('../db');
const { HttpError, bad, str, int, id, saveImage, removeImage } = require('../util');
const { requireMember, requireAdmin } = require('../auth');
const { UNITS } = require('../constants');
const events = require('../events');

const r = express.Router();

const productOut = p => ({
  id: p.id, name: p.name, category: p.category, unit: p.unit, price: p.price, photo: p.photo, active: !!p.active,
});

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

r.get('/products', requireMember, (req, res) => {
  const rows = req.user.role === 'admin'
    ? all('SELECT * FROM products ORDER BY id')
    : all('SELECT * FROM products WHERE active = 1 ORDER BY category, name');
  res.json({ products: rows.map(productOut), units: UNITS });
});

r.post('/products', requireAdmin, (req, res) => {
  const p = readProduct(req.body);
  const photo = req.body.photo ? saveImage(req.body.photo, 'p') : '';
  const now = Date.now();
  const newId = Number(run(`INSERT INTO products (name, category, unit, price, photo, active, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, p.name, p.category, p.unit, p.price, photo, p.active, now, now).lastInsertRowid);
  events.emit('products', {}, { all: true });
  res.status(201).json({ product: productOut(get('SELECT * FROM products WHERE id = ?', newId)) });
});

r.put('/products/:id', requireAdmin, (req, res) => {
  const pid = id(req.params.id);
  const old = get('SELECT * FROM products WHERE id = ?', pid);
  if (!old) throw new HttpError(404, 'Mahsulot topilmadi');
  const p = readProduct(req.body);
  // photo: berilmasa — eskisi qoladi; '' — o'chiriladi; data:... — yangisi saqlanadi
  let photo = old.photo;
  if (typeof req.body.photo === 'string' && req.body.photo !== old.photo) {
    photo = req.body.photo === '' ? '' : saveImage(req.body.photo, 'p');
  }
  run(`UPDATE products SET name = ?, category = ?, unit = ?, price = ?, photo = ?, active = ?, updated_at = ? WHERE id = ?`,
    p.name, p.category, p.unit, p.price, photo, p.active, Date.now(), pid);
  if (photo !== old.photo) removeImage(old.photo);
  events.emit('products', {}, { all: true });
  res.json({ product: productOut(get('SELECT * FROM products WHERE id = ?', pid)) });
});

r.delete('/products/:id', requireAdmin, (req, res) => {
  const pid = id(req.params.id);
  const old = get('SELECT * FROM products WHERE id = ?', pid);
  if (!old) throw new HttpError(404, 'Mahsulot topilmadi');
  // Eski buyurtmalarda mahsulot nomi va narxi saqlanib qoladi
  run('DELETE FROM products WHERE id = ?', pid);
  removeImage(old.photo);
  events.emit('products', {}, { all: true });
  res.json({ ok: true });
});

module.exports = r;

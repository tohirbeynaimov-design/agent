'use strict';
// Ombor: mahsulot qoldig'ini buyurtma bilan birga kamaytirish va bekor qilinganda qaytarish.
// Hamma funksiyalar tranzaksiya (tx) ichida chaqiriladi.
const { get, all, run } = require('./db');
const { HttpError, bad } = require('./util');

const MAX_STOCK = 10_000_000;
const r2 = n => Math.round(n * 100) / 100;
const fmt = n => String(r2(n)).replace('.', ',');

// Kiritilgan qoldiqni tekshiradi: 0 yoki undan katta son, ko'pi bilan 2 xona kasr
function readStock(v, field = 'Ombordagi miqdor') {
  const n = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? r2(Number(String(v).replace(',', '.'))) : NaN;
  if (!Number.isFinite(n) || n < 0) throw bad(`${field}ni kiriting: 0 yoki undan katta son`);
  if (n > MAX_STOCK) throw bad(`${field} juda katta`);
  return n;
}

// Ombor jurnaliga yozuv: qty — o'zgarish (+ kirdi, - chiqdi), after — shundan keyingi qoldiq
function logMove(p, kind, qty, after, { orderId = null, by = null } = {}) {
  qty = r2(qty);
  if (qty === 0 && kind !== 'boshlangich') return;
  run(`INSERT INTO stock_moves (product_id, name, unit, kind, qty, after, order_id, by_user, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.id, p.name, p.unit, kind, qty, r2(after), orderId, by, Date.now());
}

// Buyurtmadagi mahsulotlarni ombordan ayiradi. Yetmasa — 409 va hech narsa o'zgarmaydi (tx bekor bo'ladi)
function takeOrder(orderId, by = null) {
  const items = all('SELECT id, product_id, qty FROM order_items WHERE order_id = ? AND stock_taken = 0 AND product_id IS NOT NULL', orderId);
  for (const it of items) {
    const p = get('SELECT id, name, unit, stock FROM products WHERE id = ?', it.product_id);
    if (!p || p.stock === null) continue;   // qoldig'i kiritilmagan mahsulot hisoblanmaydi
    const left = r2(p.stock - it.qty);
    if (left < 0) {
      throw new HttpError(409, p.stock <= 0
        ? `"${p.name}" omborda tugagan. Uni savatdan olib tashlang.`
        : `"${p.name}" omborda faqat ${fmt(p.stock)} ${p.unit} qoldi. Miqdorni kamaytiring.`);
    }
    run('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', left, Date.now(), p.id);
    run('UPDATE order_items SET stock_taken = 1 WHERE id = ?', it.id);
    logMove(p, 'buyurtma', -it.qty, left, { orderId, by });
  }
  return items.length > 0;
}

// Bekor qilingan buyurtmaning mahsulotlarini omborga qaytaradi
function returnOrder(orderId, by = null) {
  const items = all('SELECT id, product_id, qty FROM order_items WHERE order_id = ? AND stock_taken = 1', orderId);
  for (const it of items) {
    const p = it.product_id !== null && get('SELECT id, name, unit, stock FROM products WHERE id = ?', it.product_id);
    if (p && p.stock !== null) {
      const left = r2(p.stock + it.qty);
      run('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', left, Date.now(), p.id);
      logMove(p, 'qaytdi', it.qty, left, { orderId, by });
    }
    run('UPDATE order_items SET stock_taken = 0 WHERE id = ?', it.id);
  }
  return items.length > 0;
}

module.exports = { MAX_STOCK, r2, fmt, readStock, logMove, takeOrder, returnOrder };

'use strict';
// Admin yaratish yoki admin parolini almashtirish:
//   npm run admin -- 998901234567 YangiParol "Ism Familiya"
const { get, run } = require('../src/db');
const { phone } = require('../src/util');
const { hashPassword } = require('../src/auth');

(async () => {
  const [rawPhone, password, name] = process.argv.slice(2);
  if (!rawPhone || !password) {
    console.log('Foydalanish: npm run admin -- <telefon> <parol> ["Ism"]');
    console.log('Masalan:     npm run admin -- 998901234567 KuchliParol123 "Administrator"');
    process.exit(1);
  }
  const ph = phone(rawPhone);
  if (password.length < 8) { console.error("Parol kamida 8 belgidan iborat bo'lsin."); process.exit(1); }
  const hash = await hashPassword(password);
  const u = get('SELECT * FROM users WHERE phone = ?', ph);
  if (u && u.role !== 'admin') {
    console.error(`+${ph} raqami mijoz sifatida ro'yxatdan o'tgan. Admin uchun boshqa raqam kiriting.`);
    process.exit(1);
  }
  if (u) {
    run('UPDATE users SET password_hash = ?, name = COALESCE(?, name) WHERE id = ?', hash, name || null, u.id);
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
    console.log(`Admin paroli yangilandi: +${ph}`);
  } else {
    run(`INSERT INTO users (role, name, shop, phone, address, password_hash, created_at) VALUES ('admin', ?, '', ?, '', ?, ?)`,
      name || 'Administrator', ph, hash, Date.now());
    console.log(`Yangi admin yaratildi: +${ph}`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });

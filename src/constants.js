'use strict';
// Buyurtma holatlari: yangi -> yig'ilmoqda -> yo'lda -> yetkazildi (yoki bekor qilindi)
const FLOW = ['yangi', 'yigilmoqda', 'yolda', 'yetkazildi'];
const STATUSES = [...FLOW, 'bekor'];
const ACTIVE = ['yangi', 'yigilmoqda', 'yolda'];
const STATUS_LABEL = { yangi: 'Yangi', yigilmoqda: "Yig'ilmoqda", yolda: "Yo'lda", yetkazildi: 'Yetkazildi', bekor: 'Bekor qilindi' };
const UNITS = ['dona', 'kg', 'qop', 'quti', 'blok', 'pachka', 'litr', 'metr'];

module.exports = { FLOW, STATUSES, ACTIVE, STATUS_LABEL, UNITS };

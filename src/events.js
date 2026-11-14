'use strict';
// Real vaqtdagi xabarlar (Server-Sent Events): yangi buyurtma, holat o'zgarishi, chat
const clients = new Set();

function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx bufferlamasligi uchun
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const client = { res, userId: req.user.id, role: req.user.role, session: req.sessionHash };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(client); });
}

// to: { customerId } — adminlar + shu mijoz; { all: true } — hamma
function emit(type, data, to = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (to.all || c.role === 'admin' || (to.customerId && c.userId === to.customerId)) {
      try { c.res.write(payload); } catch { /* ulanish uzilgan */ }
    }
  }
}

// Chiqib ketgan yoki o'chirilgan sessiyalarning oqimini yopamiz
function dropSession(sessionHash) {
  for (const c of clients) if (c.session === sessionHash) { try { c.res.end(); } catch { /* */ } clients.delete(c); }
}
function dropUser(userId) {
  for (const c of clients) if (c.userId === userId) { try { c.res.end(); } catch { /* */ } clients.delete(c); }
}

function closeAll() { for (const c of clients) { try { c.res.end(); } catch { /* */ } } clients.clear(); }

module.exports = { subscribe, emit, dropSession, dropUser, closeAll };

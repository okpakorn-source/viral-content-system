// ============================================================
// 🩺 crash-logger — พรีโหลดผ่าน NODE_OPTIONS/--require เพื่อ "ตามองเห็น" การตายของ :3900
// ------------------------------------------------------------
// บทเรียน 18 ก.ค. 69: :3900 ตายเงียบตอนขั้น search+YT capture (ไม่มี V8 OOM/segfault/event log)
//   → สืบสาเหตุไม่ได้เพราะไม่มีหลักฐาน. โมดูลนี้เขียนเหตุ+แรมลง _crash-3900.log:
//     • uncaughtException / unhandledRejection (ถ้าเป็น JS error)
//     • exit code + signal (ถ้าจับได้)
//     • ★ heartbeat แรมทุก 15 วิ — สำคัญสุด: เห็น RSS/external/arrayBuffers ไต่จนตาย
//       (image/frame buffer อยู่นอก V8 heap → RSS พุ่งได้แม้ heap ปกติ)
//   ปลอดภัย: เขียน log อย่างเดียว ไม่แตะพฤติกรรมแอป · ปิด: ถอด --require ออกจาก .cmd
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const LOG = path.join(process.cwd(), '_crash-3900.log');

function ts() { return new Date().toISOString(); }
function mem() {
  const m = process.memoryUsage();
  const mb = (n) => Math.round((n || 0) / 1048576);
  return `rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB external=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB`;
}
function osFree() {
  try {
    const os = require('os');
    return `sysFree=${Math.round(os.freemem() / 1048576)}MB/${Math.round(os.totalmem() / 1048576)}MB`;
  } catch { return ''; }
}
function write(line) {
  try { fs.appendFileSync(LOG, line + '\n'); } catch { /* เขียน log ล้มเองไม่ให้กระทบแอป */ }
}

write(`[${ts()}] ==== crash-logger loaded · pid=${process.pid} · ${mem()} · ${osFree()} ====`);

process.on('uncaughtException', (e) => {
  write(`[${ts()}] 🔴 UNCAUGHT_EXCEPTION: ${(e && e.stack) || e} | ${mem()} ${osFree()}`);
});
process.on('unhandledRejection', (r) => {
  write(`[${ts()}] 🔴 UNHANDLED_REJECTION: ${(r && r.stack) || r} | ${mem()} ${osFree()}`);
});
process.on('warning', (w) => {
  write(`[${ts()}] ⚠️ WARNING: ${(w && w.stack) || w}`);
});
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => { write(`[${ts()}] 🟠 SIGNAL ${sig} received | ${mem()} ${osFree()}`); process.exit(0); }); } catch { /* บาง signal ตั้งไม่ได้บน windows */ }
}
process.on('exit', (code) => {
  write(`[${ts()}] 🟠 EXIT code=${code} | ${mem()} ${osFree()}`);
});

// ★ heartbeat แรม — ตัวจับหลัก: เห็น RSS ไต่ก่อนตาย (unref เพื่อไม่กันไม่ให้ process ปิดตัวปกติ)
const hb = setInterval(() => { write(`[${ts()}] 💓 ${mem()} ${osFree()}`); }, 15000);
if (hb && typeof hb.unref === 'function') hb.unref();

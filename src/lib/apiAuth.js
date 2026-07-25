/**
 * ========================================
 * API AUTH — ด่านหน้ามาตรฐานของ route ที่ "สั่งงาน/ลบงาน" ได้
 * ========================================
 * ★ 25 ก.ค. 69 — ปิดช่องที่ตรวจเจอ:
 *   ของเดิมเขียนว่า "ถ้าผู้เรียกส่ง header กุญแจมา ค่อยตรวจ" → ไม่ส่งอะไรเลย = ผ่านฉลุย
 *   คนนอกยิง POST เปล่าๆ เข้าเว็บโปรดักชันสั่งเจนข่าวได้ = เผาเงิน AI + สแปมคิว
 *   และกุญแจสำรองเดิมตกไปใช้ค่า public (anon key) หรือคำว่า 'test-key' ซึ่งไม่ใช่ความลับ
 *
 * หลักการใหม่ (ไม่ทำให้หน้าเว็บเดิมพัง):
 *   ผ่านได้เมื่อเข้าเงื่อนไขข้อใดข้อหนึ่ง
 *   1) มีกุญแจถูกต้อง (API_SECRET_KEY / DISCORD_API_SECRET / CRON_SECRET)
 *   2) เป็น Vercel Cron (ส่ง header x-vercel-cron มาเอง — ผู้ใช้ภายนอกตั้งเองไม่ได้)
 *   3) เป็นคำขอจากหน้าเว็บของเราเอง (origin/referer เป็นโฮสต์เดียวกับเซิร์ฟเวอร์)
 *   4) เรียกจากเครื่องตัวเอง (localhost — เครื่องทีม/ยามในเครื่อง)
 *   ไม่เข้าสักข้อ = 401 (เช่น curl เปล่าๆ จากอินเทอร์เน็ต)
 *
 *   บังคับเข้มได้ด้วย env API_REQUIRE_KEY=1 → ต้องมีกุญแจเท่านั้น (ตัดข้อ 3 ทิ้ง)
 */

/** กุญแจที่ถือว่า "ของจริง" — ตัดค่า public/placeholder ที่ไม่ใช่ความลับออก */
function realKeys() {
  const keys = [process.env.API_SECRET_KEY, process.env.DISCORD_API_SECRET, process.env.CRON_SECRET]
    .filter(k => typeof k === 'string' && k.length >= 8 && k !== 'test-key');
  return keys;
}

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

function isLocalHost(h) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h || '');
}

/**
 * ตรวจสิทธิ์คำขอ
 * @returns {{ ok: boolean, via?: string, reason?: string }}
 */
export function checkApiAuth(req, { requireKey = false } = {}) {
  const h = (name) => req.headers.get(name) || '';
  const authHeader = h('authorization');
  const apiKeyHeader = h('x-api-key');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const keys = realKeys();

  // 1) กุญแจถูกต้อง
  if (keys.length && (keys.includes(apiKeyHeader) || keys.includes(bearer))) {
    return { ok: true, via: 'api-key' };
  }
  // ส่งกุญแจมาแต่ผิด = ปฏิเสธทันที (ไม่ตกไปเช็ค origin)
  if (apiKeyHeader || bearer) {
    return { ok: false, reason: 'bad-key' };
  }

  // 2) Vercel Cron (แพลตฟอร์มใส่ header นี้เอง และตัด x-vercel-* ที่มาจากภายนอกทิ้ง)
  if (h('x-vercel-cron')) return { ok: true, via: 'vercel-cron' };

  const strict = requireKey || process.env.API_REQUIRE_KEY === '1';
  if (strict) return { ok: false, reason: 'key-required' };

  // ★ โหมดผ่อนผัน: ถ้ายังไม่ได้ตั้งกุญแจจริงไว้เลย ระบบภายในจะเรียกกันเองไม่ได้ (worker → process ไม่มี origin)
  //   จึงยอมให้ผ่านไปก่อนพร้อมเตือนดังๆ ใน log — ตั้ง API_SECRET_KEY เมื่อไหร่ ด่านจะแน่นทันทีโดยไม่ต้องแก้โค้ด
  if (!keys.length) {
    if (!global.__apiAuthWarned) {
      global.__apiAuthWarned = true;
      console.warn('[apiAuth] ⚠️ ยังไม่ได้ตั้ง API_SECRET_KEY — ด่านตรวจสิทธิ์ทำงานแบบผ่อนผัน (ตั้งค่าแล้วจะบังคับทันที)');
    }
    return { ok: true, via: 'no-key-configured' };
  }

  // 3) คำขอจากหน้าเว็บของเราเอง
  const selfHost = (h('host') || '').toLowerCase();
  const originHost = hostOf(h('origin')) || hostOf(h('referer'));
  if (selfHost && originHost && originHost === selfHost) return { ok: true, via: 'same-origin' };

  // 4) เรียกจากเครื่องตัวเอง (server self-call / เครื่องทีม)
  if (isLocalHost(selfHost) || isLocalHost(originHost)) return { ok: true, via: 'localhost' };

  return { ok: false, reason: originHost ? 'cross-origin' : 'no-origin' };
}

/** true = ผ่าน · ใช้กับ route ที่อยากเขียนสั้นๆ */
export function isTrustedRequest(req, opts) {
  return checkApiAuth(req, opts).ok;
}

/**
 * header สำหรับ "ระบบเรียกตัวเอง" (worker → process, add → worker ฯลฯ)
 * ตั้ง API_SECRET_KEY เมื่อไหร่ การเรียกภายในจะพกกุญแจไปเองทันที
 */
export function internalAuthHeaders() {
  const k = process.env.API_SECRET_KEY;
  return k && k.length >= 8 ? { 'x-api-key': k } : {};
}

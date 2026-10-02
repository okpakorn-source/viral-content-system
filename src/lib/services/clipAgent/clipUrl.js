/**
 * ล้างลิงก์คลิปให้เป็นรูปเดียวกับที่คลังเก็บ (Fable 8 ก.ย. 69)
 *   คลัง clip-insights / clip-transcripts เก็บ record.url = cleanClipUrl(raw) (ดู src/app/api/clip-transcript/insight/route.js:150
 *   และ src/app/api/clip-transcript/route.js:23) → เอเจนต์ส่ง youtu.be/shorts/ลิงก์ติด fbclid มาค้น ต้องล้างก่อนเทียบ
 *   สำเนาตรรกะเดียวกับต้นทาง (ต้นทางอยู่ในไฟล์ route ที่ import แล้วลากของหนักมาด้วย จึงไม่ import ตรง) — ถ้าแก้ต้นทาง ให้แก้ที่นี่ด้วย
 * ★ 30 ก.ย. 69 (เคสล่ม pepedog89): รหัสคลิป YouTube ต้องยาว 11 ตัว "พอดี" (ตัวถัดไปต้องไม่ใช่ตัวอักษรรหัส)
 *   ตอนนี้คิวคลิป (submitClipJob) ล้างลิงก์ด้วยฟังก์ชันนี้ก่อนเก็บ/กันซ้ำ — แบบเดิมตัดรหัสที่ยาวเกินเหลือ 11 ตัวเงียบๆ
 *   ทำให้ลิงก์คนละใบถูกนับเป็นใบซ้ำ (เทส clip-agent-api ล็อกว่าต้องแยกใบ) · รหัสจริงของ YouTube ยาว 11 ตัวเสมอ = ลิงก์จริงได้ผลเดิมทุกไบต์
 *   ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R7): สำเนาใน insight/route.js และ clip-transcript/route.js แก้ให้ตรงกันแล้ว — ทั้ง 3 สำเนาต้องเหมือนกันทุกตัวอักษร
 */
export function cleanClipUrl(raw) {
  const u = String(raw || '').trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  if (yt) return `https://www.youtube.com/watch?v=${yt[1]}`;
  try {
    const url = new URL(u);
    ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 'feature', 'app_id', '_aem', 'mibextid'].forEach(p => url.searchParams.delete(p));
    return url.toString();
  } catch { return u.split('#')[0]; }
}

/**
 * ★ 30 ก.ย. 69 (เคสล่ม pepedog89): ดึง "ลิงก์แรกลิงก์เดียว" ออกจากข้อความที่พนักงานวาง
 *   เคสจริง 15:04: วางลิงก์ FB ซ้อน 2 รอบติดกัน (…/videos/1084395141170409https://www.facebook.com/…)
 *   cleanClipUrl/new URL() รับผ่านเพราะ hostname ยังเป็น facebook.com → เข้าคิวได้ → yt-dlp "Command failed"
 *   กติกา: trim · หา http(s):// ตัวแรก · ตัดเมื่อเจอ http(s):// ตัวถัดไป หรือช่องว่าง/ขึ้นบรรทัด/เครื่องหมายคำพูด
 *   ไม่มีลิงก์ (หรือมีแต่ "https://" เปล่า) → คืน '' · ใช้คู่ cleanClipUrl เสมอ: cleanClipUrl(extractFirstUrl(raw))
 * ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R9): ตัดเพิ่มที่อักขระนอก ASCII (โค้ด > 0x7E — ไทยติดท้ายลิงก์ · “” · zero-width)
 *   + อักขระควบคุม · แล้วตัดเครื่องหมายท้ายที่ค้าง ,;.)]}> (ลิงก์ในวงเล็บ/ท้ายประโยค)
 *   หมายเหตุ (ยอมรับตามใบโจทย์รอบ 1–2 · ยกเลิกแล้วในรอบ 3 L6 ข้างล่าง): ลิงก์ห่อแบบ l.php?u=https://… ที่ไม่ได้เข้ารหัส เคยถูกตัดที่ http ตัวที่สอง
 *   เหมือนลิงก์ซ้อน (ได้ "…/l.php?u=" ซึ่งจะไปล้มตอนโหลดคลิป)
 * ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (L6): แกะลิงก์ห่อของเฟซบุ๊ก/เมสเซนเจอร์ (host l.facebook.com · lm.facebook.com · l.messenger.com ที่มี u=)
 *   ใบงานที่ล้มจริง 3 ใน 45 ใบเป็นลิงก์ห่อ (…/l.php?u=https%3A%2F%2Fvt.tiktok.com…) — พนักงานต้องไปหาลิงก์จริงแล้วส่งใหม่เอง
 *   เข้ารหัส (%3A%2F%2F): ได้ลิงก์แรกแล้ว → host ตัวห่อ + มี u= → decodeURIComponent(u) เป็นผลลัพธ์
 *     (สูงสุด 2 ชั้น · decode ล้ม หรือข้างในไม่ใช่ลิงก์ http(s) = คงลิงก์เดิม)
 *   ไม่เข้ารหัส (u=https://…): ข้ามส่วนตัวห่อไปเริ่มที่ลิงก์ข้างใน (แทนการตัดที่ http ตัวที่สอง) แล้วใช้กติกาตัดเดิมทั้งหมด (ถึงช่องว่าง/ไทย/เครื่องหมาย)
 *     ลิงก์ข้างในที่ไม่มี "?" แต่มี "&" = พารามิเตอร์ของตัวห่อติดมา (เช่น &h=AT0… ของเฟซบุ๊ก) → ตัดตั้งแต่ "&" (ไม่งั้นกลายเป็นพาธเสีย)
 *   ผลนี้ไหลผ่าน cleanClipUrl ต่อในทุกจุดที่เรียกอยู่แล้ว (submitClipJob + 3 route) — ไม่ต้องแก้ที่อื่น
 * ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F5): ปิดช่องโหว่ถอดลิงก์ห่อ
 *   (ก) อ่าน u ด้วย new URL(…).searchParams.get('u') แทน regex+decodeURIComponent — ถอดตามกติกา query จริง
 *       ("+" = ช่องว่าง · %2B = "+" · ชั้นละหนึ่งรอบถอดพอดี) · ถอดไม่ได้ (UTF-8 เสีย ได้ U+FFFD) = คงลิงก์เดิมเหมือนรอบ 3
 *   (ข) host ตัวห่อเพิ่ม: www.facebook.com / m.facebook.com "เฉพาะพาธ /l.php" · l.instagram.com (ต้องมี u= เหมือนตัวอื่น)
 *   (ค) แกะแบบไม่เข้ารหัสแล้วลิงก์ข้างในมี "?" อยู่แล้ว → พารามิเตอร์ของตัวห่อที่ต่อท้ายมา (h · __tn__ · c[0] · __cft__[0] · s · e)
 *       ปนเป็นของลิงก์จริง → ลบเฉพาะชื่อเหล่านี้ผ่าน URL.searchParams (ของลิงก์จริงคงไว้) · ทำเฉพาะที่แกะจากตัวห่อ ลิงก์ตรงไม่แตะ
 */
const FB_WRAP_HOST = /^(?:l\.facebook\.com|lm\.facebook\.com|l\.messenger\.com|l\.instagram\.com)$/i;
const FB_WRAP_L_PHP_HOST = /^(?:www\.facebook\.com|m\.facebook\.com)$/i; // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F5-ข): เป็นตัวห่อเฉพาะพาธ /l.php
const FB_WRAP_BARE_PREFIX = /^https?:\/\/(?:(?:l\.facebook\.com|lm\.facebook\.com|l\.messenger\.com|l\.instagram\.com)\/[^\s?]*|(?:www\.facebook\.com|m\.facebook\.com)\/l\.php)\?(?:[^\s]*?&)?u=(?=https?:\/\/)/i;
const FB_WRAP_PARAMS = ['h', '__tn__', 'c[0]', '__cft__[0]', 's', 'e']; // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F5-ค): พารามิเตอร์ของตัวห่อ

// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F5-ข): ตัวห่อ = host ห่อล้วน (l./lm.facebook.com · l.messenger.com · l.instagram.com)
//   หรือ www./m.facebook.com ที่พาธเป็น /l.php พอดี (หน้าอื่นของเฟซบุ๊กที่บังเอิญมี u= ไม่นับ)
function _isFbWrapper(parsed) {
  if (FB_WRAP_HOST.test(parsed.hostname)) return true;
  return FB_WRAP_L_PHP_HOST.test(parsed.hostname) && parsed.pathname === '/l.php';
}

// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F5-ค): ลบพารามิเตอร์ของตัวห่อที่ติดท้ายลิงก์ข้างใน (มีเท่าที่เจอ · ไม่เจอ/แยกไม่ได้ = คืนเดิมทุกไบต์)
function _dropWrapperParams(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return url; }
  const found = FB_WRAP_PARAMS.filter((name) => parsed.searchParams.has(name));
  if (!found.length) return url;
  for (const name of found) parsed.searchParams.delete(name);
  return parsed.toString();
}

// ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (L6): ลิงก์ห่อแบบเข้ารหัส → ลิงก์จริงข้างใน (สูงสุด 2 ชั้น) · ไม่ใช่ตัวห่อ/แกะไม่ได้ = คืนลิงก์เดิม
function _unwrapEncodedFbLink(url) {
  let cur = url;
  for (let depth = 0; depth < 2; depth += 1) {
    let parsed;
    try { parsed = new URL(cur); } catch { return cur; }
    if (!_isFbWrapper(parsed)) return cur;
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F5-ก): ถอด u ตามกติกา query จริง (URLSearchParams) — ไม่มี u = ได้ '' = คงลิงก์เดิม
    const inner = (parsed.searchParams.get('u') || '').trim();
    if (inner.includes('\uFFFD')) return cur;           // ถอดไม่ได้ (เช่น %E0%B8 ขาดท้าย → U+FFFD) = คงลิงก์เดิม
    if (!/^https?:\/\/\S/i.test(inner)) return cur;    // ข้างในไม่ใช่ลิงก์ http(s) = คงลิงก์เดิม
    cur = inner;
  }
  return cur;
}

export function extractFirstUrl(raw) {
  const s = String(raw ?? '').trim();
  const start = s.search(/https?:\/\//i);
  if (start < 0) return '';
  let rest = s.slice(start);
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (L6): ลิงก์ห่อไม่เข้ารหัส (…/l.php?u=https://…) → เริ่มที่ลิงก์ข้างใน (สูงสุด 2 ชั้น)
  let unwrapped = false;
  for (let depth = 0; depth < 2; depth += 1) {
    const wrap = rest.match(FB_WRAP_BARE_PREFIX);
    if (!wrap) break;
    rest = rest.slice(wrap[0].length);
    unwrapped = true;
  }
  const next = rest.slice(1).search(/https?:\/\//i); // ลิงก์ถัดไป (ข้ามตัวแรกที่ตำแหน่ง 0) — ลิงก์ห่อไม่เข้ารหัสถูกข้ามไปแล้วด้านบน
  let url = next >= 0 ? rest.slice(0, next + 1) : rest;
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R9): หยุดที่อักขระนอกช่วง ASCII พิมพ์ได้ (≤ 0x20 ช่องว่าง/ควบคุม · ≥ 0x7F นอก ASCII รวม “”‘’ และ zero-width เดิม)
  //   หรือเครื่องหมายคำพูด/backtick/<>
  const stop = url.search(/[^\x21-\x7e]|["'`<>]/);
  if (stop >= 0) url = url.slice(0, stop);
  url = url.replace(/[,;.)\]}>]+$/, ''); // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 2 (R9): เครื่องหมายท้ายที่ค้าง (ลิงก์ในวงเล็บ/ท้ายประโยค)
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (L6): พารามิเตอร์ของตัวห่อที่ติดท้ายลิงก์ข้างใน (ลิงก์ข้างในไม่มี "?" จึงเป็นเจ้าของ "&" ไม่ได้)
  if (unwrapped && !url.includes('?') && url.includes('&')) url = url.slice(0, url.indexOf('&'));
  // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F5-ค): ลิงก์ข้างในมี "?" → "&h=…" ของตัวห่อปนเป็นพารามิเตอร์ของลิงก์จริง → ลบเฉพาะของตัวห่อ
  if (unwrapped && url.includes('?')) url = _dropWrapperParams(url);
  url = _unwrapEncodedFbLink(url); // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 3 (L6): ลิงก์ห่อแบบเข้ารหัส
  return /^https?:\/\/\S/i.test(url) ? url : '';
}

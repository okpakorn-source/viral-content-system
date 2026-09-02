/**
 * ตัวอ่านสวิตช์ env แบบทน — รับ 1/true/on/yes (ไม่สนตัวพิมพ์ ช่องว่าง อัญประกาศที่ติดมาจาก `vercel env add`)
 * ★ 1 ก.ย. 69: บั๊กที่พิสูจน์แล้ว 4 จุด — สวิตช์ต้องพิมพ์ '1' หรือ 'true' เป๊ะ ผิดนิดเดียวคือเงียบ (ไม่เตือน)
 *   ใช้แทน `process.env.X === '1'` / `=== 'true'` ในจุดที่เจ้าของอาจตั้งค่าเองบน Vercel
 */
const ON = new Set(['1', 'true', 'on', 'yes', 'y']);
const OFF = new Set(['0', 'false', 'off', 'no', 'n', '']);

function normalize(raw) {
  return String(raw ?? '').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
}

/**
 * @param {string} name ชื่อ env
 * @param {boolean} [def=false] ค่าเมื่อไม่ได้ตั้ง หรือตั้งเป็นค่าที่อ่านไม่ออก
 */
export function envOn(name, def = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return def;
  const v = normalize(raw);
  if (ON.has(v)) return true;
  if (OFF.has(v)) return false;
  console.warn(`[envFlag] ⚠️ ${name}="${String(raw).slice(0, 20)}" อ่านไม่ออก (รับ 1/true/on/yes หรือ 0/false/off/no) → ใช้ค่าเริ่มต้น ${def}`);
  return def;
}

/** อ่านค่า env แบบข้อความ ตัดช่องว่าง/อัญประกาศ — คืน '' ถ้าไม่ตั้ง */
export function envStr(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return '';
  return String(raw).trim().replace(/^["']+|["']+$/g, '').trim();
}

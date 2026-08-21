/**
 * objText — ตัวแปลงกลาง "รายการวัตถุดิบข่าว → ข้อความที่คนอ่านรู้เรื่อง" (19 ส.ค. 69)
 * ─────────────────────────────────────────────────────────────
 * ปัญหาที่มาแก้: ขั้นสกัด (breakdown) คืนบางช่องเป็น object บ้าง เป็นสตริงบ้าง (ไม่แน่นอนรายรอบ)
 *   จุดที่เอาไปต่อสตริงตรงๆ (`${h}` / `.join(' | ')`) จะได้ "[object Object]" ส่งเข้าตัวเขียนโดยไม่มี error
 *   นับจากไฟล์ผลจริง 23 รอบยิง: best_sections พัง 19/23 (83%) · pain_points 5/23 · emotional_hooks 1/23
 *
 * กติกา:
 *   - สตริง → คืนค่าเดิม **ทุกไบต์** (ห้าม trim ห้ามแตะ) = no-op สนิท
 *   - object → ดึง "เนื้อหลัก" + "เหตุผล/รายละเอียด" ตามคีย์ที่พบจริงในไฟล์ผล (ห้ามใช้ JSON.stringify)
 *   - null / undefined / ค่าว่าง / object ว่าง → คืน '' แล้วถูกกรองทิ้งจากรายการ (ห้ามกลายเป็น "undefined")
 *   - ไม่ throw ไม่ว่าเจอค่าอะไร (มีเพดานความลึกกัน object ซ้อน/วนซ้ำ)
 *
 * สวิตช์ถอย: HOOKS_OBJ_FIX=0 (หรือ off/false/no · ทน อัญประกาศ/ช่องว่าง/ตัวพิมพ์ใหญ่)
 *   = คืนอาเรย์เดิมทั้งดุ้น → พฤติกรรมเดิมเป๊ะทุกไบต์
 *   ค่าตั้งต้น = **เปิด** (ของเดิมคือ "[object Object]" ซึ่งเป็นขยะชัดเจน ไม่ใช่ทางเลือกเชิงรสนิยม)
 */

// ─── คีย์ "เนื้อหลัก" — ไล่ตามลำดับ เจอตัวไหนมีเนื้อก่อนใช้ตัวนั้น ───
//   (คีย์ทั้งหมดยกมาจากรูปร่าง object จริงในไฟล์ผล _planD/RES-*.json 23 รอบ)
const HEAD_KEYS = [
  'section',   // best_sections
  'hook',      // emotional_hooks
  'pain',      // pain_points
  'quote',     // quotes
  'point',     // key_points
  'conflict',  // conflicts
  'angle',     // suggested_angles
  'fact', 'event', 'item', 'text', 'content', 'title', 'name', 'label', 'value',
];

// ─── คีย์ "เหตุผล/รายละเอียด" — ต่อท้ายเนื้อหลักด้วย ' — ' (แบบเดียวกับตัวแปลงที่ปลอดภัยอยู่แล้วในระบบ) ───
//   เรียง "เนื้อข้อเท็จจริง" (detail/reason/description) มาก่อน "คำวิจารณ์ว่าทำไมดี" (why_*)
//   เหตุ: pain_points ของจริงมีทั้ง detail และ why_it_hits ในใบเดียว — ตัววัตถุดิบที่นักเขียนใช้ได้คือ detail
const DETAIL_KEYS = [
  'detail', 'reason', 'description', 'emotional_reason', 'context',
  'why_strong', 'why_it_works', 'why_best', 'why_it_matters', 'why_it_hits',
  'usable_angle', 'best_use', 'use_for', 'use_case', 'emotional_use',
];

const MAX_DEPTH = 3; // เพดานความลึก — กัน object ซ้อน/อ้างวนกันเองจนลูปไม่จบ

/**
 * ตัวแปลงจริง (recursive แต่มีเพดาน)
 * @param {*} v ค่าอะไรก็ได้
 * @param {number} depth ความลึกปัจจุบัน
 * @returns {string} ข้อความ (สตริงว่าง = ไม่มีเนื้อ → ให้ผู้เรียกกรองทิ้ง)
 */
function textOf(v, depth) {
  if (v === null || v === undefined) return '';
  const tp = typeof v;
  if (tp === 'string') return v; // 🔴 no-op สนิท — ห้าม trim ห้ามแตะแม้แต่ไบต์เดียว
  if (tp === 'number' || tp === 'bigint' || tp === 'boolean') return String(v);
  if (tp !== 'object') return ''; // function / symbol → ไม่มีเนื้อ
  if (depth >= MAX_DEPTH) return '';

  if (Array.isArray(v)) {
    const parts = [];
    for (const x of v) {
      const s = textOf(x, depth + 1);
      if (s.trim() !== '') parts.push(s);
    }
    return parts.join(' — ');
  }

  // object ธรรมดา — หาเนื้อหลักก่อน แล้วค่อยหาเหตุผล/รายละเอียด
  let head = '';
  let headKey = '';
  for (const k of HEAD_KEYS) {
    const s = textOf(v[k], depth + 1);
    if (s.trim() !== '') { head = s; headKey = k; break; }
  }
  let detail = '';
  for (const k of DETAIL_KEYS) {
    if (k === headKey) continue;
    const s = textOf(v[k], depth + 1);
    if (s.trim() !== '') { detail = s; break; }
  }

  // ไม่รู้จักคีย์เลย → หยิบคีย์แรกที่มีเนื้อ (เรียงตาม Object.keys) ดีกว่าทิ้งข้อมูล
  if (head === '' && detail === '') {
    let keys = [];
    try { keys = Object.keys(v); } catch { keys = []; }
    for (const k of keys) {
      const s = textOf(v[k], depth + 1);
      if (s.trim() !== '') { head = s; break; }
    }
  }

  // ยังว่าง → ลอง toString ของตัวมันเอง (เช่น Date) แต่ห้ามคืน "[object Object]" เด็ดขาด
  if (head === '' && detail === '') {
    let raw = '';
    try { raw = String(v); } catch { raw = ''; }
    return raw === '[object Object]' ? '' : raw;
  }

  if (head === '') return detail;
  if (detail === '' || detail === head) return head;
  return `${head} — ${detail}`;
}

/**
 * สวิตช์ถอย — ค่าตั้งต้น "เปิด" · ปิดได้ด้วย HOOKS_OBJ_FIX=0/off/false/no
 * รับค่าแบบทนทาน: ถอดอัญประกาศ + trim + ตัวพิมพ์เล็ก ก่อนเทียบ
 * (แบบอ้างอิง: src/lib/correction/fabricationGate.js — isFabGateEnabled)
 */
export function isObjFixEnabled() {
  const raw = String(process.env.HOOKS_OBJ_FIX ?? '').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
  if (raw === '') return true; // ไม่ตั้ง env = เปิด
  return !(raw === '0' || raw === 'off' || raw === 'false' || raw === 'no');
}

/**
 * แปลงค่าเดี่ยว → ข้อความ (pure · ไม่อ่าน env · ไม่ throw)
 * @param {*} item
 * @returns {string}
 */
export function objText(item) {
  return textOf(item, 0);
}

// ─── คีย์ "ตัวคำพูดจริง" ของช่อง quotes — เรียงตามรูปร่างที่พบจริงในไฟล์ผล 23 รอบ ───
//   รูปร่างปกติ:        { quote, speaker, context, ... }                    → โค้ดเดิมอ่านได้
//   รูปร่างที่ทำให้พัง:  { speaker, quote_type, content, emotional_use }     → ไม่มีคีย์ quote/text เลย
//   (RES-F4-both-daria.json — จุดเรียกอ่านแค่ q.quote || q.text → คำพูดหายทั้งก้อน 6/23 รอบ แบบเงียบสนิท)
const QUOTE_KEYS = ['quote', 'text', 'content'];

/**
 * กู้ "ตัวคำพูด" จาก object quote รูปร่างที่โค้ดเดิมอ่านไม่ได้ (บั๊ก A · 19 ส.ค. 69)
 * วิธีใช้: เป็น "ตัวสำรองท้ายสุด" ของนิพจน์เดิมเท่านั้น → `q.quote || q.text || quoteTextFix(q)`
 *   รูปร่างเดิมที่อ่านได้อยู่แล้ว นิพจน์เดิม short-circuit ก่อน ฟังก์ชันนี้ไม่ถูกเรียกเลย = ผลเดิมทุกไบต์
 * สวิตช์ถอย HOOKS_OBJ_FIX=0 → คืน '' เสมอ = จุดเรียกกลับพฤติกรรมเดิมทุกไบต์ (ถอยทั้งชุดด้วยสวิตช์เดียว)
 * @param {*} q รายการ quote 1 ใบจากขั้นสกัด
 * @returns {string} ตัวคำพูด ('' = ไม่มีเนื้อ/สวิตช์ปิด → ให้ filter(Boolean) ของจุดเรียกทิ้งแบบเดิม)
 */
export function quoteTextFix(q) {
  if (!isObjFixEnabled()) return ''; // 🔙 สวิตช์ถอย: ไม่กู้ → จุดเรียกได้พฤติกรรมเดิมทุกไบต์
  if (q === null || typeof q !== 'object' || Array.isArray(q)) return '';
  for (const k of QUOTE_KEYS) {
    const s = textOf(q[k], 1);
    if (s.trim() !== '') {
      console.log(`[ObjFix] 🔧 quotes: กู้ตัวคำพูดจากคีย์ "${k}" (รูปร่างไม่มี quote/text ให้โค้ดเดิมอ่าน)`);
      return s;
    }
  }
  return '';
}

/**
 * แปลงทั้งรายการ → อาเรย์สตริงที่พร้อมเอาไปต่อ (`join` / เรนเดอร์รายบรรทัด)
 * @param {*} list อาเรย์ (ค่าอื่นคืน [] — ของเดิมจุดเหล่านี้ก็ crash อยู่แล้วถ้าไม่ใช่อาเรย์)
 * @param {string} fieldName ชื่อช่อง — ใช้ในบรรทัดล็อกเท่านั้น
 * @returns {string[]}
 */
export function objTextList(list, fieldName = '') {
  // 🔙 สวิตช์ถอยต้องมาก่อน guard เสมอ — ปิดแล้วต้องคืนของเดิมทั้งดุ้นทุกกรณี
  if (!isObjFixEnabled()) return list;
  // 🔧 20 ส.ค. 69 (โซล-max ตรวจรอบ 2): เดิม guard คืน [] ทำให้ค่า "คล้ายอาเรย์" (เช่น Uint8Array)
  //   ที่ของเดิม .join() ทำงานได้ กลายเป็นสตริงว่าง → คืน list เดิมแทน ให้จุดเรียกทำแบบเดิมเป๊ะ
  if (!Array.isArray(list)) return list;

  const out = [];
  let converted = 0;
  for (const it of list) {
    const wasObj = it !== null && typeof it === 'object';
    const s = textOf(it, 0);
    if (s.trim() === '') continue; // null/undefined/ว่าง/object ว่าง → ทิ้ง (ห้ามกลายเป็น "undefined")
    if (wasObj) converted++;
    out.push(s);
  }
  if (converted > 0) {
    console.log(`[ObjFix] 🔧 ${fieldName || 'field'}: แปลง object → ข้อความ ${converted} รายการ`);
  }
  return out;
}

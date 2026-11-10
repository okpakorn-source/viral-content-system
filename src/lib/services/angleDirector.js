/**
 * =====================================================
 * Angle Director — ผู้กำหนดทิศทางข่าว (10 พ.ย. 69)
 * =====================================================
 * เจ้าของสั่ง 10 พ.ย. 69: "ทุกครั้งที่มีเนื้อดิบส่งเข้ามา ระบบต้องหยิบทักษะต้นแบบมาเป็นตัวกำหนดทิศทางข่าว
 *   แล้วค่อยให้คลังพรอมต์/ครูช่วยเขียนเสริม โดยต้องยังคงประเด็นไว้"
 *
 * ต้นแบบ = ปก "งานปัง" ของทีม (data/angle-exemplars/angle-library.json) — แต่ละปกคือคำตอบว่า
 *   "จากข่าวทั้งเรื่อง ทีมเลือกชูประเด็นไหน และเรียงมันเป็นกี่บรรทัดอย่างไร"
 *
 * ลำดับอำนาจในท่อใหม่ (ชัดเจน ไม่ทับซ้อน):
 *   1. เนื้อข่าวจากทีม  = ข้อเท็จจริง (แหล่งเดียว)
 *   2. ทิศทางข่าว      = จะชูอะไร เล่าอะไรก่อนหลัง อะไรห้ามหาย  ← ไฟล์นี้กำหนด
 *   3. ครู/คลังพรอมต์   = สำนวนและรูปแบบโพสต์เท่านั้น ห้ามเปลี่ยนประเด็น (src/lib/services/teacherWriter.js)
 *
 * ไฟล์นี้ไม่เรียก AI เอง — ผู้เรียกส่งตัวเรียกโมเดลเข้ามา · ไม่มี import แบบ alias (รันด้วย node ตรงๆ ได้)
 */
import fs from 'fs';
import path from 'path';

const LIBRARY_FILE = ['data', 'angle-exemplars', 'angle-library.json'];
let _cache = null;

/** โหลดคลังต้นแบบประเด็น (อ่านไฟล์ครั้งเดียวต่อ process) — ไฟล์หาย/ว่าง = error ที่มี errorType */
export function loadAngleExemplars({ file } = {}) {
  const target = file || path.join(process.cwd(), ...LIBRARY_FILE);
  if (_cache && _cache.file === target) return _cache.exemplars;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    const err = new Error(`โหลดคลังต้นแบบประเด็นไม่ได้ (${path.basename(target)}): ${e.message}`);
    err.errorType = 'ANGLE_LIBRARY_UNREADABLE';
    throw err;
  }
  const exemplars = (Array.isArray(parsed) ? parsed : parsed?.exemplars || [])
    .filter((x) => x && typeof x.id === 'string' && Array.isArray(x.lines) && x.lines.some((l) => String(l || '').trim()));
  if (exemplars.length === 0) {
    const err = new Error('คลังต้นแบบประเด็นว่าง');
    err.errorType = 'ANGLE_LIBRARY_EMPTY';
    throw err;
  }
  _cache = { file: target, exemplars };
  return exemplars;
}

/** ล้างแคช (ใช้ในเทสเท่านั้น) */
export function _resetAngleCache() { _cache = null; }

/** กฎของผู้กำหนดทิศทางข่าว — แก้ที่นี่ที่เดียว */
export const ANGLE_RULES = [
  'คุณคือบรรณาธิการของเพจข่าวบน Facebook หน้าที่คือ "กำหนดทิศทางข่าว" จากเนื้อข่าวที่ทีมส่งมา ก่อนส่งให้นักเขียน คุณไม่ได้เขียนโพสต์',
  'คุณมี "ต้นแบบ" คือปกข่าวที่ทีมทำแล้วปัง แต่ละปกแสดงว่าทีมเลือกชูประเด็นไหนจากข่าวทั้งเรื่อง และเรียงเป็นบรรทัดอย่างไร ให้เรียนวิธีเลือกจากต้นแบบ แล้วเลือกแบบเดียวกันกับข่าวนี้',
  '',
  'วิธีทำ',
  '1. อ่านเนื้อข่าวให้จบ แล้วหา "จุดที่คนจะหยุดอ่าน" ตามวิธีของต้นแบบ เช่น รายละเอียดเล็กๆ ที่จับต้องได้ซึ่งบอกความรู้สึกแทนคำบรรยาย คำพูดของเจ้าตัว ตัวเลขที่ขัดกับภาพจำ หรือการกระทำที่บอกนิสัยของคน',
  '2. เสนอทิศทางที่ดีที่สุด 1 ทิศทาง และทิศทางสำรองอีกไม่เกิน 2 ทิศทางถ้าเนื้อข่าวมีวัตถุดิบพอจริง ห้ามฝืนให้ครบ 3 ทิศทางที่เสนอต้องต่างกันที่ "ประเด็นที่ชู" ไม่ใช่แค่เปลี่ยนคำ',
  '3. ทุกทิศทางต้องยืนบนข้อเท็จจริงในเนื้อข่าวเท่านั้น ห้ามเติมบุคคล ตัวเลข เหตุการณ์ คำพูด หรือความรู้สึกที่เนื้อข่าวไม่ได้บอก ถ้อยคำบนปกที่เป็นคำพูดต้องเป็นคำพูดที่มีในเนื้อข่าวจริง',
  '4. ทิศทางต้องไม่ทิ้งแก่นของข่าว: ระบุ "เหตุการณ์หลัก" ของข่าวนี้ให้ชัด (ใครทำอะไร หรือเกิดอะไรขึ้นที่ทำให้เรื่องนี้เป็นข่าว) และทุกทิศทางต้องเล่าเหตุการณ์หลักนั้นด้วย ประเด็นที่ชูคือ "ประตูเข้าเรื่อง" ไม่ใช่การเปลี่ยนไปเล่าเรื่องอื่น เนื้อข่าวที่มีหลายเรื่องปนกัน ให้ถือเรื่องที่เนื้อข่าวเปิดและให้น้ำหนักมากที่สุดเป็นเหตุการณ์หลัก',
  '5. เพจเล่าในมุมที่ให้เกียรติคนในข่าว ไม่แซะ ไม่ประจาน ไม่ขยี้ความเศร้าหรือความรุนแรง',
  '',
  'ตอบเป็น JSON เท่านั้น:',
  '{"angles": [{',
  '  "core": "เหตุการณ์หลักของข่าว เขียน 1 ประโยค (เหมือนกันทุกทิศทาง)",',
  '  "focus": "ประเด็นที่ชู เขียน 1 ประโยค",',
  '  "coverLines": ["ข้อความพาดปกบรรทัด 1", "บรรทัด 2", "บรรทัด 3"],',
  '  "order": ["สิ่งที่ต้องเล่าเป็นอย่างแรก", "ถัดมา", "ปิดด้วยอะไร"],',
  '  "mustKeep": ["ถ้อยคำสั้นๆ ที่คัดจากเนื้อข่าวตรงตัว (ชื่อ ตัวเลข คำพูด) ซึ่งโพสต์ต้องมี ไม่เกิน 6 รายการ"],',
  '  "exemplarIds": ["รหัสต้นแบบที่ใช้เป็นแนว 1-2 รหัส"],',
  '  "why": "เหตุผลสั้นๆ ว่าทำไมประเด็นนี้ทำให้คนหยุดอ่าน และตรงกับวิธีของต้นแบบอย่างไร"',
  '}]}',
  'coverLines มี 2-4 บรรทัด สั้นแบบต้นแบบ · mustKeep ต้องคัดจากเนื้อข่าวตรงตัวทุกตัวอักษร',
].join('\n');

/** ประกอบคำสั่งให้ผู้กำหนดทิศทางข่าว: ต้นแบบทั้งคลัง + เนื้อข่าวเต็ม */
export function buildAnglePrompt({ rawText, exemplars }) {
  const raw = String(rawText || '').trim();
  if (raw.length < 20) {
    const err = new Error('เนื้อข่าวจากทีมสั้นเกินไป');
    err.errorType = 'RAW_TEXT_TOO_SHORT';
    throw err;
  }
  const list = (exemplars || []).map((x) => {
    const lines = x.lines.map((l) => String(l).trim()).filter(Boolean).join(' / ');
    return `[${x.id}] ${lines}${x.techniqueNote ? `\n    วิธีเลือกประเด็น: ${String(x.techniqueNote).trim()}` : ''}`;
  }).join('\n');
  const user = `=== ต้นแบบ: ปกข่าวที่ทีมทำแล้วปัง (${(exemplars || []).length} ปก) ===\n${list}\n=== จบต้นแบบ ===\n\n`
    + `=== เนื้อข่าวจากทีม ===\n${raw}\n=== จบเนื้อข่าวจากทีม ===\n\nกำหนดทิศทางข่าวสำหรับเนื้อข่าวนี้`;
  return { system: ANGLE_RULES, user };
}

const stripSpace = (s) => String(s || '').replace(/\s+/g, '');
const QUOTE_RE = /["“”]([^"“”\n]{6,})["“”]/g;

/**
 * อ่านและตรวจผลของผู้กำหนดทิศทางข่าว
 *   - ทิ้งทิศทางที่ไม่มีประเด็น/ไม่มีข้อความพาดปก
 *   - mustKeep: เก็บเฉพาะรายการที่ "มีในเนื้อข่าวจริง" (กัน AI แต่งถ้อยคำแล้วบังคับให้นักเขียนใส่)
 *   - คำพูดในเครื่องหมายคำพูดบนปกที่ไม่มีในเนื้อข่าว = ติดธง inventedQuotes (ผู้เรียกไม่ควรใช้ทิศทางนั้นเป็นตัวหลัก)
 * @returns {{ok:boolean, angles:Array<object>, dropped:number}}  ok=false = ไม่มีทิศทางที่ใช้ได้ (ผู้เรียกต้องใช้ทางสำรอง ห้ามเงียบ)
 */
export function readAngleBrief(result, { rawText = '', exemplars = [] } = {}) {
  let obj = result;
  if (typeof result === 'string') {
    const s = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { obj = JSON.parse(s); } catch {
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      try { obj = a !== -1 && b > a ? JSON.parse(s.slice(a, b + 1)) : null; } catch { obj = null; }
    }
  }
  const list = Array.isArray(obj?.angles) ? obj.angles : [];
  const rawFlat = stripSpace(rawText);
  const knownIds = new Set((exemplars || []).map((x) => x.id));
  const strList = (v, max) => (Array.isArray(v) ? v : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, max);
  const angles = [];
  for (const a of list.slice(0, 3)) {
    if (!a || typeof a !== 'object') continue;
    const focus = String(a.focus || '').trim();
    const coverLines = strList(a.coverLines, 4);
    if (!focus || coverLines.length === 0) continue;
    const mustKeep = strList(a.mustKeep, 6).filter((m) => stripSpace(m).length >= 2 && rawFlat.includes(stripSpace(m)));
    const inventedQuotes = [];
    for (const line of coverLines) {
      let m;
      QUOTE_RE.lastIndex = 0;
      while ((m = QUOTE_RE.exec(line)) !== null) {
        const q = stripSpace(m[1]);
        // ปกของทีมใช้เครื่องหมายคำพูดเน้นชื่อ/ฉายาสั้นๆ ด้วย (เช่น "ชมพู่ อารยา") — นับเป็น "คำพูดที่แต่งเอง" เฉพาะท่อนยาวพอจะเป็นประโยค
        if (q.length >= 16 && !rawFlat.includes(q.slice(0, 14))) inventedQuotes.push(m[1].trim());
      }
    }
    angles.push({
      core: String(a.core || '').trim().slice(0, 300),
      focus: focus.slice(0, 300),
      coverLines: coverLines.map((l) => l.slice(0, 120)),
      order: strList(a.order, 5).map((l) => l.slice(0, 200)),
      mustKeep,
      exemplarIds: strList(a.exemplarIds, 3).filter((id) => knownIds.size === 0 || knownIds.has(id)),
      why: String(a.why || '').trim().slice(0, 400),
      inventedQuotes,
    });
  }
  // ทิศทางที่แต่งคำพูดขึ้นเองถูกดันไปท้าย (ยังคืนให้เห็น แต่ไม่ได้เป็นตัวหลัก)
  angles.sort((x, y) => (x.inventedQuotes.length ? 1 : 0) - (y.inventedQuotes.length ? 1 : 0));
  return { ok: angles.some((a) => a.inventedQuotes.length === 0), angles, dropped: list.length - angles.length };
}

/** ทิศทางของเวอร์ชันที่ i (เริ่ม 0): มีทิศทางสำรองก็ใช้ ไม่มีก็ใช้ทิศทางหลัก — ทุกเวอร์ชันมีทิศทางเสมอ */
export function angleForVersion(brief, index) {
  const usable = (brief?.angles || []).filter((a) => a.inventedQuotes.length === 0);
  if (usable.length === 0) return null;
  return usable[index] || usable[0];
}

/** ข้อความ "ทิศทางข่าว" ที่ส่งให้นักเขียน (และผู้ตรวจข้อเท็จจริง) */
export function formatAngleForWriter(angle) {
  if (!angle) return '';
  const out = [];
  if (angle.core) out.push(`เหตุการณ์หลักของข่าว (ต้องเล่าให้คนอ่านรู้ว่าเกิดอะไรขึ้น): ${angle.core}`);
  out.push(`ประเด็นที่ชู: ${angle.focus}`);
  if (angle.coverLines?.length) out.push(`ข้อความพาดปกที่วางไว้: ${angle.coverLines.join(' / ')}`);
  if (angle.order?.length) out.push('ลำดับการเล่า:\n' + angle.order.map((o, i) => `  ${i + 1}. ${o}`).join('\n'));
  if (angle.mustKeep?.length) out.push(`ต้องมีในโพสต์ (ตรงตามเนื้อข่าว): ${angle.mustKeep.map((m) => `"${m}"`).join(' · ')}`);
  return out.join('\n');
}

const numberTokens = (s) => (String(s || '').match(/[0-9][0-9,]*(?:\.[0-9]+)?/g) || []).map((n) => n.replace(/,/g, '').replace(/\.$/, '')).filter(Boolean);

/**
 * ข้อความ "ยังมี" ถ้อยคำที่ต้องคงไหม
 * ตรงตัว (ไม่นับช่องว่างและเครื่องหมายคำพูด) = มี · ถ้อยคำที่มีตัวเลข: ตัวเลขทุกตัวยังอยู่ = มี
 *   · วลียาว ≥ 8 ตัวอักษร: คำส่วนใหญ่ของวลี (≥ 70% ของตัวอักษร นับเป็นท่อน ≥ 4 ตัวอักษร) ยังอยู่ = มี
 * เหตุ (รอบ 5–6 ตีตกเวอร์ชันที่ประเด็นยังอยู่ครบ แล้วสั่งเขียนซ้ำ 3 รอบโดยไม่จำเป็น):
 *   "วัย 28" แทน "อายุ 28 ปี" · “…” แทน "…" · "ถอดเสื้อของตัวเองให้ใส่ทันที" แทน "ถอดให้ใส่ทันที"
 * ชื่อและคำสั้น (< 8 ตัวอักษร) ยังต้องตรงตัว
 */
export function keepsPhrase(content, phrase) {
  const norm = (s) => stripSpace(s).replace(/["“”'‘’]/g, '');
  const flat = norm(content);
  const want = norm(phrase);
  if (!want) return true;
  if (flat.includes(want)) return true;
  const nums = numberTokens(phrase);
  if (nums.length > 0) {
    const have = new Set(numberTokens(content));
    return nums.every((n) => have.has(n));
  }
  if (want.length < 8) return false;
  const WIN = 4;
  const covered = new Uint8Array(want.length);
  for (let i = 0; i + WIN <= want.length; i++) {
    if (flat.includes(want.slice(i, i + WIN))) for (let k = i; k < i + WIN; k++) covered[k] = 1;
  }
  return covered.reduce((s, c) => s + c, 0) / want.length >= 0.7;
}

/** รายการ mustKeep ที่ไม่อยู่ในโพสต์ — ใช้ตรวจว่า "ประเด็นยังอยู่" ด้วยโค้ด */
export function missingMustKeep(content, angle) {
  return (angle?.mustKeep || []).filter((m) => !keepsPhrase(content, m));
}

/**
 * กำหนดทิศทางข่าว 1 ข่าว — เรียกโมเดล 1 ครั้ง · ล้ม/ใช้ไม่ได้ = คืน ok:false พร้อมเหตุ (ผู้เรียกเขียนต่อแบบไม่มีทิศทางได้ แต่ต้องติดป้ายบอก)
 * @param {(req:{system:string,user:string}) => Promise<object|string>} p.callModel
 */
export async function directAngle({ rawText, exemplars, callModel }) {
  if (typeof callModel !== 'function') throw new Error('directAngle: ต้องส่ง callModel');
  try {
    const brief = readAngleBrief(await callModel(buildAnglePrompt({ rawText, exemplars })), { rawText, exemplars });
    return brief.ok ? brief : { ...brief, ok: false, error: 'ผู้กำหนดทิศทางไม่ได้คืนทิศทางที่ใช้ได้' };
  } catch (e) {
    return { ok: false, angles: [], dropped: 0, error: String(e?.message || e).slice(0, 200) };
  }
}

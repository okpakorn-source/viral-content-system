/**
 * ★ 10 ส.ค. 69 — ตัววัด "ความลื่นของเนื้อดิบ" (เฟส A: วัดล้วน ไม่แตะเนื้อ ไม่เรียก AI)
 *
 * ที่มา: เจ้าของทัก "พาดหัวเขียนดี แต่เนื้อดิบเล่าห้วน/ไม่ลื่น เอาไปเจนข่าวแล้วไม่สวย"
 * วัดจากคลังจริง 60 เคส: ประโยคยาวเฉลี่ย 620 ตัวอักษร (คลิปยาว) / 500 (กลาง) / 370 (สั้น)
 *
 * 🔴 หลักการที่ผู้ตรวจ Sol ย้ำ และโมดูลนี้ยึด:
 *   - ตัวตัดประโยคภาษาไทยด้วย heuristic "ห้ามเป็นตัวตัดสินเด็ดขาด" → ที่นี่จึงวัดหลายมุมและคืนเป็น
 *     "ข้อสังเกต" พร้อมความรุนแรง ไม่ใช่คำตัดสินถูก/ผิดเด็ดขาด
 *   - ภาษาไทยใช้ "ช่องว่าง" แทนเครื่องหมายวรรคตอน จึงวัด "ช่วงยาวที่ไม่มีที่พัก" (runs) เป็นหลัก
 *     แทนการนับประโยคแบบภาษาอังกฤษ
 *   - โมดูลนี้เป็น pure function ล้วน ไม่มี I/O ไม่มี env ไม่มี side effect (เทสง่าย ปลอดภัย)
 */

/** คำเชื่อมที่ทำให้ประโยคพ่วงยาวจนอ่านไม่ทัน (จากบทวิเคราะห์เนื้อจริง) */
const CONNECTORS = ['โดย', 'ซึ่ง', 'จึง', 'ส่งผลให้', 'ทำให้', 'เนื่องจาก', 'อย่างไรก็ตาม'];

/** รูปเปิดเรื่องแบบ "กรอบการสนทนา" ที่ทำให้เข้าเรื่องช้า (เจ้าของยกมาเอง) */
const FRAME_OPENERS = [
  'ร่วมสนทนากับ', 'ร่วมพูดคุยกับ', 'พูดคุยกับ', 'ให้สัมภาษณ์', 'ในรายการ', 'ผู้ร่วมรายการ',
];

const clean = (t) => String(t ?? '').replace(/\r/g, '');

/**
 * ตัดเนื้อเป็น "ช่วงพัก" ตามธรรมชาติของภาษาไทย: ขึ้นบรรทัดใหม่ + ช่องว่าง
 * (ไม่เรียกว่า sentence เพราะไทยไม่มีจุดจบประโยคชัดเจน — เรียกว่า run เพื่อไม่ให้เข้าใจผิด)
 */
export function splitRuns(text) {
  return clean(text)
    .split(/\n+/)
    .flatMap((para) => para.split(/\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitParagraphs(text) {
  return clean(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/** วัดเนื้อหนึ่งก้อน — คืนตัวเลขล้วน ไม่ตัดสิน */
export function measureFlow(text) {
  const t = clean(text);
  const runs = splitRuns(t);
  const paragraphs = splitParagraphs(t);
  const lens = runs.map((r) => r.length);
  const chars = t.length;
  const connCount = CONNECTORS.reduce((n, c) => n + (t.split(c).length - 1), 0);
  const head = t.slice(0, 120);
  const paraLens = paragraphs.map((p) => p.length);
  return {
    chars,
    runs: runs.length,
    avgRun: runs.length ? Math.round(chars / runs.length) : 0,
    maxRun: lens.length ? Math.max(...lens) : 0,
    longRuns: lens.filter((l) => l > 220).length,      // ช่วงที่ยาวจนอ่านรวดเดียวไม่ไหว
    tinyRuns: lens.filter((l) => l > 0 && l < 12).length, // เศษคำกระท่อนกระแท่น
    paragraphs: paragraphs.length,
    // 🔑 คาลิเบรตกับคลังจริง 60 เคส: อาการจริงคือ "กำแพงตัวอักษร" ไม่ใช่ประโยคยาว
    //    (longRuns = 0 ทุกเคส แต่ย่อหน้าเดียวยาวเป็นพันตัวอักษร)
    maxParagraph: paraLens.length ? Math.max(...paraLens) : 0,
    connPer100: chars ? Math.round((connCount / chars) * 1000) / 10 : 0,
    opensWithFrame: FRAME_OPENERS.some((f) => head.includes(f)),
  };
}

/**
 * เกณฑ์ตามชนิดคลิป — คลิปสั้นห้ามบังคับให้แตกย่อหน้า (กันเนื้อกลายเป็นห้วน ซึ่งเจ้าของทักมาแล้ว)
 * ตัวเลขตั้งจากสถิติคลังจริง (ดูหัวไฟล์) ไม่ได้ตั้งลอยๆ
 */
export function thresholdsFor(clipDurationSec) {
  const d = Number(clipDurationSec) || 0;
  // maxParagraph = ตัวชี้วัดหลัก (กำแพงตัวอักษร) · minParagraphs ใช้เฉพาะคลิปที่เนื้อยาวพอจะแบ่งได้จริง
  if (d >= 180) return { minParagraphs: 2, maxParagraph: 700, minCharsToSplit: 900, maxLongRuns: 0, maxAvgRun: 200, maxConnPer100: 1.2 };
  if (d >= 60) return { minParagraphs: 1, maxParagraph: 700, minCharsToSplit: 900, maxLongRuns: 0, maxAvgRun: 220, maxConnPer100: 1.4 };
  return { minParagraphs: 1, maxParagraph: 800, minCharsToSplit: 1200, maxLongRuns: 1, maxAvgRun: 260, maxConnPer100: 1.8 };
}

/**
 * ตัดสินเป็น "ข้อสังเกต" ต่อหนึ่งช่อง — ไม่ใช่ pass/fail เด็ดขาด
 * @returns {Array<{field:string,type:string,detail:string}>}
 */
export function inspectField(field, text, clipDurationSec) {
  const m = measureFlow(text);
  const th = thresholdsFor(clipDurationSec);
  const issues = [];
  if (!m.chars) return issues;
  if (m.longRuns > th.maxLongRuns) {
    issues.push({ field, type: 'long_run', detail: `มีช่วงยาวเกิน 220 ตัวอักษร ${m.longRuns} จุด (ยาวสุด ${m.maxRun})` });
  }
  if (m.avgRun > th.maxAvgRun) {
    issues.push({ field, type: 'dense', detail: `ช่วงเฉลี่ยยาว ${m.avgRun} ตัวอักษร (เกณฑ์ ${th.maxAvgRun})` });
  }
  // 🔑 อาการจริงที่วัดได้จากคลัง: ย่อหน้าเดียวยาวเป็นกำแพง — ตรวจที่ "ความยาวย่อหน้า" เป็นหลัก
  if (m.maxParagraph > th.maxParagraph) {
    issues.push({ field, type: 'wall', detail: `มีย่อหน้ายาว ${m.maxParagraph} ตัวอักษร (เกณฑ์ ${th.maxParagraph}) — ควรแบ่งตามช่วงเหตุการณ์` });
  }
  // บังคับจำนวนย่อหน้าเฉพาะเมื่อเนื้อยาวพอจะแบ่งได้จริง (กันคลิปสั้นถูกบังคับจนห้วน)
  if (m.chars >= th.minCharsToSplit && m.paragraphs < th.minParagraphs) {
    issues.push({ field, type: 'no_break', detail: `เนื้อ ${m.chars} ตัวอักษรแต่มี ${m.paragraphs} ย่อหน้า (ควรมีอย่างน้อย ${th.minParagraphs})` });
  }
  if (m.connPer100 > th.maxConnPer100) {
    issues.push({ field, type: 'connector', detail: `คำเชื่อมหนาแน่น ${m.connPer100} ต่อ 100 ตัวอักษร` });
  }
  if (m.opensWithFrame) {
    issues.push({ field, type: 'frame_open', detail: 'เปิดเรื่องด้วยกรอบการสนทนาแทนเหตุการณ์' });
  }
  return issues;
}

/** ตรวจทั้งเคส (เนื้อหลัก + ประเด็นย่อยทุกก้อน) */
export function flowVerdict(insight, clipDurationSec) {
  const issues = [];
  issues.push(...inspectField('rawData', insight?.rawData, clipDurationSec));
  const subs = Array.isArray(insight?.subStories) ? insight.subStories : [];
  subs.forEach((s, i) => {
    const body = typeof s === 'string' ? s : (s?.rawData || s?.story || '');
    issues.push(...inspectField(`subStories[${i + 1}]`, body, clipDurationSec));
  });
  return { pass: issues.length === 0, issues };
}

/**
 * ★ ของสำหรับเฟสถัดไป (ยังไม่ต่อสาย): ดึง "หลักยึด" ไว้เทียบว่าของหายไหมหลังจัดรูป
 * ตัวเลข+หน่วย และคำที่ขึ้นต้นด้วยอักษรใหญ่/ชื่อเฉพาะแบบไทยจับยาก จึงเก็บเฉพาะตัวเลขซึ่งเทียบได้แม่น
 */
export function extractAnchors(text) {
  const t = clean(text);
  const nums = [...t.matchAll(/(\d[\d,.]*)\s*(บาท|ล้าน|แสน|หมื่น|พัน|ปี|ขวบ|คน|วัน|เดือน|ชั่วโมง|นาที|กิโลเมตร|เมตร|ครั้ง|%)?/g)]
    .map((m) => `${m[1].replace(/,/g, '')}${m[2] || ''}`)
    .filter((x) => x.length > 1);
  return nums;
}

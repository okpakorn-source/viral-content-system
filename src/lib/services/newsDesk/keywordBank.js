/**
 * =====================================================
 * 🗝️ คลังคีย์เวิร์ดเชิงลึก — News Desk (19 มิ.ย. 2026)
 * =====================================================
 * คำสั่งผู้ใช้: "แตกในแตก อย่างละ ~100 คีย์เวิร์ด — น้ำดี/ข่าวเก่าทำใหม่ได้ + กระแสรายวันมาก่อน"
 *
 * วิธี: สร้างคีย์แบบ combinatorial = วงการ(SUBJECTS) × แนวเรื่อง×แอ็กชันเฉพาะ(THEME_ACTIONS)
 *      → ได้หลายร้อยคีย์ต่อแนวอัตโนมัติ (เช่น "นักร้อง กตัญญู ซื้อบ้านให้แม่")
 *      คีย์เฉพาะเจาะจง = ข่าวที่ "ทำได้จริง" + รู้หมวดทันทีจากคีย์ (ไม่ต้องเดา)
 * หมุนชุดตามเวลา → แต่ละรอบ harvest ยิงไม่กี่สิบคีย์ (เบา) แต่ครอบทั้งคลังภายใน 1-2 วัน
 *
 * ★ category ที่ tag ต้องตรงกับ DESK_CATEGORIES ใน deskBrain.js
 */

// ── วงการคนดัง (subject) — ครอบทุกวงการที่เพจเล่นได้ ──
export const SUBJECTS = [
  'ดารา', 'นักแสดง', 'นักร้อง', 'นักร้องลูกทุ่ง', 'ไอดอล', 'พิธีกร', 'ตลก',
  'เน็ตไอดอล', 'ยูทูบเบอร์', 'ติ๊กต็อกเกอร์', 'นางงาม', 'นักกีฬา', 'ศิลปิน',
  'อินฟลูเอนเซอร์', 'คนดัง', 'ซุปตาร์',
];

// ── แนวเรื่อง (category ตรงกับ DESK_CATEGORIES) → ชุดแอ็กชัน/เหตุการณ์เฉพาะ ──
//    แอ็กชันเฉพาะ = ทำให้ผลลัพธ์เป็น "เหตุการณ์ที่เป็นข่าวทำได้" ไม่ใช่คำกว้างลอยๆ
export const THEME_ACTIONS = {
  'กตัญญู/ครอบครัวอบอุ่น': [
    'กตัญญู', 'ซื้อบ้านให้แม่', 'ซื้อบ้านให้พ่อแม่', 'ซื้อรถให้แม่', 'ซื้อรถให้พ่อ',
    'สร้างบ้านให้พ่อแม่', 'ดูแลแม่ป่วย', 'ดูแลพ่อป่วย', 'พาพ่อแม่เที่ยว', 'ใช้หนี้ให้พ่อแม่',
    'ฉลองวันเกิดให้แม่', 'พาแม่ไปหาหมอ', 'เลี้ยงดูพ่อแม่', 'ของขวัญให้แม่',
  ],
  'น้ำใจ/ช่วยเหลือ': [
    'บริจาค', 'ช่วยผู้ประสบภัย', 'สร้างบ้านให้คนจน', 'ช่วยค่ารักษา', 'มอบทุนการศึกษา',
    'ช่วยน้ำท่วม', 'เลี้ยงอาหารคนจร', 'ยกที่ดินให้', 'สละทรัพย์ช่วย', 'บริจาคโรงพยาบาล',
    'สร้างโรงเรียน', 'ช่วยเด็กป่วย', 'ช่วยคนชรา',
  ],
  'คนดังทำดี/ติดดิน': [
    'ติดดิน', 'กินข้าวข้างทาง', 'ใช้ชีวิตเรียบง่าย', 'ขับรถเก่า', 'ไม่ถือตัว',
    'ทำบุญเงียบ', 'ทำนา', 'ปลูกผักขาย', 'กลับบ้านเกิด', 'ทำสวน',
  ],
  'สู้ชีวิต': [
    'สู้ชีวิต', 'จากศูนย์', 'พลิกชีวิต', 'เคยลำบาก', 'ตั้งตัวจากติดลบ',
    'ขายของสู้ชีวิต', 'ทำงานหนักส่งตัวเองเรียน', 'ไม่ยอมแพ้', 'ชีวิตพลิกผัน',
  ],
  'ความรัก/แต่งงาน': [
    'แต่งงาน', 'จดทะเบียนสมรส', 'ขอแต่งงาน', 'งานหมั้น', 'ควงแฟน',
    'ตั้งครรภ์', 'คลอดลูก', 'ครบรอบแต่งงาน', 'รักหวาน', 'สละโสด', 'รับขวัญลูก',
  ],
  'สัมภาษณ์/บทสนทนาดี': [
    'เปิดใจ', 'เปิดอกสัมภาษณ์', 'เล่าชีวิต', 'ให้กำลังใจ', 'ข้อคิดชีวิต',
    'ผ่านช่วงตกต่ำ', 'เปิดใจครั้งแรก', 'เล่าเบื้องหลัง',
  ],
};

// ── กระแสรายวัน (daily trend) — โซเชียลสด "ทำได้จริง" (มีคน/เรื่อง ไม่ใช่การเมือง/สถิติ) ──
export const DAILY_TREND_QUERIES = [
  'ดราม่า ล่าสุด วันนี้', 'ไวรัล ล่าสุด วันนี้', 'คนแห่ชื่นชม วันนี้', 'ชาวเน็ตแห่แชร์ วันนี้',
  'ดาราดราม่า ล่าสุด', 'คนดังเป็นข่าว วันนี้', 'เรื่องราวซึ้ง ไวรัล', 'คลิปไวรัล วันนี้',
  'ทอล์กออฟเดอะทาวน์', 'ดราม่าร้านดัง ล่าสุด', 'สังคมแห่แชร์ วันนี้', 'กระแสโซเชียล วันนี้',
  'เน็ตไอดอลเป็นข่าว ล่าสุด', 'ดาราโพสต์เดือด ล่าสุด', 'คนดังตอบกลับดราม่า', 'เรื่องราวน่าทึ่ง ไวรัล',
  'หนุ่มสาวไวรัล ล่าสุด', 'คลิปประทับใจ ล่าสุด', 'แห่ตามหา ไวรัล', 'เปิดใจกลางรายการ ล่าสุด',
];

// ── เครื่องสร้างคีย์เชิงลึก: theme × action × subject → หมุนชุดตามเวลา ──
/**
 * @param {number} perTheme - จำนวนคีย์ต่อแนว/รอบ (หมุนชุดทุก 2 ชม.)
 * @returns {Array<{q:string, category:string, lane:string}>}
 */
export function generateThemeQueries(perTheme = 6) {
  const slot = Math.floor(Date.now() / (3600e3 * 2)); // หมุนทุก 2 ชม. → ครอบคลังภายใน ~1-2 วัน
  const out = [];
  let s = 0;
  for (const [category, actions] of Object.entries(THEME_ACTIONS)) {
    for (let i = 0; i < perTheme; i++) {
      const action = actions[(slot + i) % actions.length];
      const subj = SUBJECTS[(slot + i + s) % SUBJECTS.length];
      // สลับรูปแบบ: "ดารา กตัญญู" กับ "นักร้อง ซื้อบ้านให้แม่" — กว้างพอ + เจาะจงพอ
      const q = `${subj} ${action}`.trim();
      out.push({ q, category, lane: 'broad' });
      s++;
    }
  }
  return out;
}

/** กระแสรายวัน — หมุนทุก ชม. */
export function generateDailyTrend(n = 14) {
  const slot = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < n; i++) out.push(DAILY_TREND_QUERIES[(slot + i) % DAILY_TREND_QUERIES.length]);
  return out;
}

// ════════════════════════════════════════════════════
// 🧠 คลังคีย์ Exa (neural semantic) — 19 มิ.ย. รอบ 7 (ผู้ใช้: "Exa เก่งสุดกับดาราน้ำดี แตกคีย์เป็นร้อยพัน ขุดของอมตะ")
//   ★ Exa ค้นด้วย "อังกฤษเชิงความหมาย" ได้ข่าวไทยตรงคอนเซ็ปต์คมสุด — เน้นข่าวน้ำดี "ไม่มีวันหมดอายุ" (เล่าใหม่ได้เรื่อยๆ)
//   วงการ(16) × มุม(~38) = ~600 คีย์ combinatorial → หมุนชุดทุก ชม. ครอบคลังใน ~2 วัน ไม่เปลืองต่อรอบ
// ════════════════════════════════════════════════════
const EXA_SUBJECTS = [
  'Thai actor', 'Thai actress', 'Thai singer', 'Thai luk thung singer', 'Thai idol',
  'Thai TV host', 'Thai comedian', 'Thai influencer', 'Thai YouTuber', 'Thai TikToker',
  'Thai celebrity', 'Thai superstar', 'Thai former beauty queen', 'Thai athlete', 'Thai net idol', 'famous Thai star',
];

// [template (มี {S}), category] — มุมข่าวน้ำดี "อมตะ" ที่เขียนใหม่ได้ตลอด
const EXA_ANGLES = [
  // 🙏 กตัญญู/ครอบครัวอบอุ่น
  ['{S} buys a house for their parents, heartwarming gratitude story', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} builds a new house for their parents in their hometown', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} buys a brand new car for their mother or father', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} pays off their parents debt out of gratitude', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} devotedly takes care of their sick parents', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} takes their parents on a trip abroad', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} throws a lavish birthday for their mother', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} supports their whole family financially after success', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['{S} buys land in hometown to build a family home', 'กตัญญู/ครอบครัวอบอุ่น'],
  // 💚 น้ำใจ/ช่วยเหลือ
  ['{S} donates a large sum of money to a hospital', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} helps flood and disaster victims with money and supplies', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} builds houses for poor families in need', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} funds the medical treatment of a stranger in need', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} gives free meals to homeless and poor people', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} rescues and cares for stray dogs and cats', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} gives scholarships to underprivileged students', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} donates generously to a temple or school', 'น้ำใจ/ช่วยเหลือ'],
  ['{S} opens their home to shelter disaster victims', 'น้ำใจ/ช่วยเหลือ'],
  // 💪 สู้ชีวิต
  ['{S} inspiring rags to riches life story', 'สู้ชีวิต'],
  ['{S} grew up very poor and became hugely successful', 'สู้ชีวิต'],
  ['{S} worked humble menial jobs before becoming famous', 'สู้ชีวิต'],
  ['{S} lived in a slum as a child and fought to success', 'สู้ชีวิต'],
  ['{S} saved money for years to achieve their dream', 'สู้ชีวิต'],
  ['{S} made a comeback after bankruptcy or downfall', 'สู้ชีวิต'],
  ['{S} overcame poverty and hardship through hard work', 'สู้ชีวิต'],
  ['{S} sold street food or did labor before fame', 'สู้ชีวิต'],
  // 🌾 คนดังทำดี/ติดดิน
  ['{S} humble and down to earth simple lifestyle despite fame', 'คนดังทำดี/ติดดิน'],
  ['{S} eats cheap street food despite being wealthy', 'คนดังทำดี/ติดดิน'],
  ['{S} still drives an old car or rides a motorbike', 'คนดังทำดี/ติดดิน'],
  ['{S} returned to their hometown to farm and live simply', 'คนดังทำดี/ติดดิน'],
  ['{S} known for treating staff and fans with great kindness', 'คนดังทำดี/ติดดิน'],
  // 🎤 สัมภาษณ์/บทสนทนาดี
  ['{S} emotional interview about life hardship and struggle', 'สัมภาษณ์/บทสนทนาดี'],
  ['{S} shares inspiring life lessons in a heartfelt interview', 'สัมภาษณ์/บทสนทนาดี'],
  ['{S} talks openly about overcoming loss or depression', 'สัมภาษณ์/บทสนทนาดี'],
  ['{S} reflects on their humble poor past with gratitude', 'สัมภาษณ์/บทสนทนาดี'],
  ['{S} touching interview about family and giving back', 'สัมภาษณ์/บทสนทนาดี'],
];

/** หมุนชุดคีย์ Exa (วงการ × มุม) ทุก ชม. — n คีย์/รอบ */
export function generateExaQueries(n = 15) {
  const combos = [];
  for (const [tmpl, category] of EXA_ANGLES) {
    for (const s of EXA_SUBJECTS) combos.push({ q: tmpl.replace('{S}', s), category });
  }
  const slot = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < n; i++) out.push(combos[(slot * n + i) % combos.length]);
  return out;
}

/** ขนาดคลังทั้งหมด (ไว้ log/ตรวจ) */
export function bankSize() {
  let combos = 0;
  for (const actions of Object.values(THEME_ACTIONS)) combos += actions.length * SUBJECTS.length;
  return { themes: Object.keys(THEME_ACTIONS).length, subjects: SUBJECTS.length, themeCombos: combos, dailyTrend: DAILY_TREND_QUERIES.length };
}

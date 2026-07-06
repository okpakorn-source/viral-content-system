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

// ── วงการคนดัง (subject) — ★ 2 ก.ค.: ขยายครอบ "ทุกวงการที่มีชื่อเสียงบนโซเชียล" ──
//   เฉพาะวงการที่ "มีชีวิตสาธารณะ" (แต่งงาน/กตัญญู/สู้ชีวิต/สัมภาษณ์ ได้สมเหตุผล) → cross กับ THEME_ACTIONS ไม่เพี้ยน
//   วงการเฉพาะทาง (พระ/หมอ/ครู/กู้ภัย/หมอดู ฯลฯ) แยกไปที่ FIELD_ANGLES ด้านล่าง (จับคู่มุมที่เหมาะเฉพาะตัว)
export const SUBJECTS = [
  // บันเทิง
  'ดารา', 'นักแสดง', 'นักร้อง', 'นักร้องลูกทุ่ง', 'นักร้องอินดี้', 'แร็ปเปอร์', 'ไอดอล', 'พิธีกร', 'ตลก', 'ดาราตลก', 'ผู้กำกับ', 'นักพากย์', 'ดีเจ', 'นักเต้น', 'วงดนตรี',
  // ครีเอเตอร์/โซเชียล
  'เน็ตไอดอล', 'ยูทูบเบอร์', 'ติ๊กต็อกเกอร์', 'สตรีมเมอร์', 'เกมแคสเตอร์', 'คอสเพลเยอร์', 'อินฟลูเอนเซอร์', 'บิวตี้บล็อกเกอร์', 'บล็อกเกอร์ท่องเที่ยว', 'นักเขียน',
  // กีฬา
  'นักกีฬา', 'นักฟุตบอล', 'นักวอลเลย์บอล', 'นักแบดมินตัน', 'นักมวย', 'นักกีฬาทีมชาติ', 'นักกีฬาอีสปอร์ต',
  // ธุรกิจ/แฟชั่น/อาหาร
  'นักธุรกิจ', 'เจ้าของแบรนด์', 'แม่ค้าออนไลน์', 'เชฟ', 'นางแบบ', 'นายแบบ',
  // รวม
  'นางงาม', 'ศิลปิน', 'คนดัง', 'ซุปตาร์', 'เซเลบ',
];

// ── แนวเรื่อง (category ตรงกับ DESK_CATEGORIES) → ชุดแอ็กชัน/เหตุการณ์เฉพาะ ──
//    แอ็กชันเฉพาะ = ทำให้ผลลัพธ์เป็น "เหตุการณ์ที่เป็นข่าวทำได้" ไม่ใช่คำกว้างลอยๆ
export const THEME_ACTIONS = {
  'กตัญญู/ครอบครัวอบอุ่น': [
    'กตัญญู', 'ซื้อบ้านให้แม่', 'ซื้อบ้านให้พ่อแม่', 'ซื้อรถให้แม่', 'ซื้อรถให้พ่อ',
    'สร้างบ้านให้พ่อแม่', 'ดูแลแม่ป่วย', 'ดูแลพ่อป่วย', 'พาพ่อแม่เที่ยว', 'ใช้หนี้ให้พ่อแม่',
    'ฉลองวันเกิดให้แม่', 'พาแม่ไปหาหมอ', 'เลี้ยงดูพ่อแม่', 'ของขวัญให้แม่',
    // ★ 3 ก.ค. (ผู้ใช้ชี้ตัวอย่าง: แฉ "พีท ทองเจือ-เจ็ง พ่อแม่สนับสนุนทุกความฝันของลูก"):
    //   แนว "พ่อแม่ต้นแบบ/แนวคิดเลี้ยงลูก" — ต้องมีแก่นคิด/ปรัชญา (ไลฟ์สไตล์ลูกดาราเฉยๆ ไม่มีปม = แป้กตามข้อมูลจริง)
    'สนับสนุนความฝันลูก', 'แนวคิดเลี้ยงลูก เปิดใจ', 'พ่อแม่ต้นแบบ เลี้ยงลูก', 'สอนลูก น่าชื่นชม',
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
    // ★ 3 ก.ค. (ผู้ใช้ชี้ตัวอย่าง: คลิปแฉ "กว่าจะมีลูก พยายาม 2 ปี" เมย์ พิชญ์นาฏ วัย 44):
    //   แนว "เส้นทางกว่าจะมีลูก" — contrast ความพยายาม+ตัวเลขปี = DNA สูตรปัง (อารมณ์ร่วมสูง เล่าใหม่ได้เสมอ)
    'กว่าจะมีลูก', 'มีบุตรยาก เปิดใจ', 'ตั้งครรภ์สำเร็จ พยายามนาน', 'ทำเด็กหลอดแก้ว สำเร็จ', 'อุ้มลูกคนแรก น้ำตาซึม',
  ],
  'สัมภาษณ์/บทสนทนาดี': [
    'เปิดใจ', 'เปิดอกสัมภาษณ์', 'เล่าชีวิต', 'ให้กำลังใจ', 'ข้อคิดชีวิต',
    'ผ่านช่วงตกต่ำ', 'เปิดใจครั้งแรก', 'เล่าเบื้องหลัง', 'เล่าเส้นทางชีวิต', 'บทสัมภาษณ์พิเศษ',
  ],
  // ★ 2 ก.ค.: มุม "ประเด็น/มีเนื้อหา" — คลิป/ข่าวที่มีปมให้เล่าต่อ (soft drama คนดัง — คนตามจริง)
  'คนดัง/ดราม่าบันเทิง': [
    'เปิดใจประเด็นร้อน', 'ตอบดราม่า', 'เคลียร์ปม', 'พูดถึงข่าวลือ', 'เล่าเบื้องหลังวงการ',
    'ปมในใจ', 'สวนกลับดราม่า', 'ประเด็นร้อน', 'ไลฟ์เล่าเรื่อง', 'แจงดราม่า', 'ตอบทุกคำถาม',
  ],
  // ★ 2 ก.ค.: มุม "ไฮไลท์/โมเมนต์" — คลิปไฮไลท์รายการ/โมเมนต์เด็ด (พูดน้อยแต่การกระทำมีประเด็น = ถอดคลิปได้)
  'บันเทิงกระแส': [
    'ไฮไลท์รายการ', 'โมเมนต์ประทับใจ', 'ช่วงพีครายการ', 'โมเมนต์ซึ้ง', 'คลิปฮาในรายการ',
    'โมเมนต์ไวรัล', 'ช่วงเด็ดในรายการ', 'คลิปน่ารัก', 'แอ็กชันสุดปัง',
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
//   วงการ(27) × มุม(~38) = ~1000 คีย์ combinatorial → หมุนชุดทุก ชม. ครอบคลังใน ~2 วัน ไม่เปลืองต่อรอบ
// ════════════════════════════════════════════════════
const EXA_SUBJECTS = [
  'Thai actor', 'Thai actress', 'Thai singer', 'Thai luk thung singer', 'Thai idol',
  'Thai TV host', 'Thai comedian', 'Thai influencer', 'Thai YouTuber', 'Thai TikToker',
  'Thai celebrity', 'Thai superstar', 'Thai former beauty queen', 'Thai athlete', 'Thai net idol', 'famous Thai star',
  // ★ 2 ก.ค.: ขยายทุกวงการ
  'Thai footballer', 'Thai volleyball player', 'Thai boxer', 'Thai esports player', 'Thai streamer',
  'Thai chef', 'Thai entrepreneur', 'Thai business owner', 'Thai model', 'Thai content creator', 'Thai national athlete',
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
  // ★ 3 ก.ค. (ผู้ใช้ชี้ตัวอย่างคลิปแฉ เมย์ พิชญ์นาฏ): เส้นทางกว่าจะมีลูก — semantic search เก่งกับคอนเซ็ปต์นี้
  ['{S} emotional journey trying to have a baby for years, finally pregnant', 'ความรัก/แต่งงาน'],
  ['{S} opens up about infertility struggle and IVF success', 'ความรัก/แต่งงาน'],
  // ★ 3 ก.ค. (ผู้ใช้ชี้ตัวอย่างแฉ พีท ทองเจือ): พ่อแม่ต้นแบบสนับสนุนฝันลูก
  ['{S} parenting philosophy, supporting their children dreams', 'กตัญญู/ครอบครัวอบอุ่น'],
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

// ════════════════════════════════════════════════════
// 🏭 FIELD_ANGLES (2 ก.ค.) — วงการเฉพาะทางที่ "ไม่มีชีวิตสาธารณะแบบดารา" → จับคู่มุมเฉพาะตัว
//   (ไม่เอาไป cross กับ THEME_ACTIONS กันคีย์เพี้ยน เช่น "พระ แต่งงาน") · [subject, [angles], category]
// ════════════════════════════════════════════════════
export const FIELD_ANGLES = [
  ['พระเกจิ', ['พัฒนาวัด', 'สร้างโรงเรียน', 'ช่วยชาวบ้าน', 'สงเคราะห์คนยากไร้', 'เกจิดังทำบุญ'], 'น้ำใจ/ช่วยเหลือ'],
  ['หมอ', ['หมอใจดีช่วยผู้ป่วยยากไร้', 'หมอรักษาฟรี', 'ฮีโร่เสื้อกาวน์', 'เปิดใจอาชีพหมอ', 'หมอลงพื้นที่ช่วยคน'], 'น้ำใจ/ช่วยเหลือ'],
  ['พยาบาล', ['พยาบาลน้ำใจ', 'ดูแลผู้ป่วยเกินหน้าที่', 'ฮีโร่ชุดขาว'], 'น้ำใจ/ช่วยเหลือ'],
  ['ครู', ['ครูใจดีช่วยเด็ก', 'ครูบ้านนอกสู้ชีวิต', 'อุทิศตนเพื่อศิษย์', 'ครูดังสอนเก่ง'], 'สู้ชีวิต'],
  ['กู้ภัย', ['ช่วยชีวิตคน', 'ฮีโร่กู้ภัย', 'อาสาสมัครช่วยเหลือ'], 'น้ำใจ/ช่วยเหลือ'],
  ['ตำรวจ', ['ตำรวจน้ำใจช่วยประชาชน', 'ตำรวจพลเมืองดี', 'ตำรวจช่วยชีวิต'], 'น้ำใจ/ช่วยเหลือ'],
  ['ทหาร', ['ทหารช่วยประชาชน', 'ทหารน้ำใจ', 'ฮีโร่ทหาร'], 'น้ำใจ/ช่วยเหลือ'],
  ['นักธุรกิจ', ['เศรษฐีสร้างตัวจากศูนย์', 'เจ้าของแบรนด์สู้ชีวิต', 'คืนกำไรสังคม', 'นักธุรกิจใจบุญ'], 'สู้ชีวิต'],
  ['หมอดู', ['หมอดูแม่นๆ', 'สายมูดัง', 'ทำนายดวงคนดัง'], 'ไลฟ์สไตล์/ไวรัล'],
  ['ศิลปินแห่งชาติ', ['ผลงานสร้างชื่อ', 'อุทิศตนเพื่องานศิลป์', 'เปิดใจเส้นทางศิลปิน'], 'สัมภาษณ์/บทสนทนาดี'],
  ['ช่างฝีมือ', ['ช่างฝีมือดัง', 'สร้างผลงานน่าทึ่ง', 'สายอาชีพสู้ชีวิต'], 'สู้ชีวิต'],
  ['เกษตรกร', ['เกษตรกรพลิกชีวิต', 'ทำเกษตรรวย', 'ปราชญ์ชาวบ้าน'], 'สู้ชีวิต'],
  ['นักวิชาการ', ['ผลงานวิจัยสร้างชื่อ', 'นักวิชาการเพื่อสังคม', 'เปิดใจเส้นทางวิชาการ'], 'สัมภาษณ์/บทสนทนาดี'],
];

/** หมุนชุดคีย์วงการเฉพาะทาง (FIELD_ANGLES) — n คีย์/รอบ */
export function generateFieldQueries(n = 10) {
  const combos = [];
  for (const [subj, angles, category] of FIELD_ANGLES) {
    for (const a of angles) combos.push({ q: `${subj} ${a}`.trim(), category, lane: 'field' });
  }
  const slot = Math.floor(Date.now() / 3600e3); // หมุนทุก ชม.
  const out = [];
  for (let i = 0; i < n; i++) out.push(combos[(slot * n + i) % combos.length]);
  return out;
}

// ════════════════════════════════════════════════════
// 🎬 CLIP queries แยกแพลตฟอร์ม (2 ก.ค.) — โหมดคลิป: ยูทูป/TikTok/IG/Reels/FB video
//   มุมคลิป = ไฮไลท์/สัมภาษณ์/โมเมนต์/ประเด็น (รวมคลิป "พูดน้อยแต่การกระทำมีประเด็น" — มี AI ถอดคลิป)
//   คืน {q, platform, category, lane:'clip'} · harvester (เฟส 2) เป็นคนใส่ site:/endpoint ต่อแพลตฟอร์ม
// ════════════════════════════════════════════════════
export const CLIP_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'reels', 'facebook'];

// [angle, category] — มุมคลิปที่ "ทำข่าวได้เยอะ"
const CLIP_ANGLES = [
  ['สัมภาษณ์', 'สัมภาษณ์/บทสนทนาดี'], ['เปิดใจ', 'สัมภาษณ์/บทสนทนาดี'], ['เล่าเรื่องชีวิต', 'สัมภาษณ์/บทสนทนาดี'],
  // ★ 3 ก.ค. (ผู้ใช้ชี้ตัวอย่างคลิปแฉ): เส้นทางกว่าจะมีลูก + พ่อแม่ต้นแบบ — คลิปรายการเปิดใจแนวนี้ทำข่าวได้เสมอ
  ['เปิดใจ กว่าจะมีลูก', 'สัมภาษณ์/บทสนทนาดี'],
  ['เปิดใจ เลี้ยงลูก สนับสนุนความฝัน', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['ไฮไลท์', 'บันเทิงกระแส'], ['โมเมนต์', 'บันเทิงกระแส'], ['ช่วงพีค', 'บันเทิงกระแส'],
  ['เบื้องหลัง', 'คนดัง/ดราม่าบันเทิง'], ['ตอบคำถาม', 'คนดัง/ดราม่าบันเทิง'], ['ประเด็นร้อน', 'คนดัง/ดราม่าบันเทิง'],
  ['คลิปไวรัล', 'ไลฟ์สไตล์/ไวรัล'], ['โมเมนต์น่ารัก', 'ไลฟ์สไตล์/ไวรัล'], ['ทำสิ่งน่าทึ่ง', 'ไลฟ์สไตล์/ไวรัล'],
];

/**
 * หมุนชุดคีย์คลิปต่อแพลตฟอร์ม — perPlatform คีย์/แพลตฟอร์ม/รอบ
 * @returns {Array<{q:string, platform:string, category:string, lane:string}>}
 */
export function generateClipQueriesByPlatform(perPlatform = 4) {
  const slot = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (const platform of CLIP_PLATFORMS) {
    for (let i = 0; i < perPlatform; i++) {
      const [angle, category] = CLIP_ANGLES[(slot + i) % CLIP_ANGLES.length];
      const subj = SUBJECTS[(slot + i * 3 + CLIP_PLATFORMS.indexOf(platform)) % SUBJECTS.length];
      out.push({ q: `${subj} ${angle}`.trim(), platform, category, lane: 'clip' });
    }
  }
  return out;
}

// ★★★ 4 ก.ค. (ผู้ใช้สั่ง "คลิปน้ำดีเยอะๆ คลิปทำยอดดีกว่าลิงก์"): คลังคลิปน้ำดีลึกแนวปัญญาปันสุข
//   วลีที่ค้นเป็น "คลิป" เจอจริงทุกแพลตฟอร์ม (TikTok/FB/IG/YouTube) — เรื่องคนจริงกินใจ ไม่ใช่ดาราบันเทิง
const DEEP_GOOD_CLIP_POOL = [
  // 👶 เด็ก/เยาวชน ลำบาก-เก่ง-กตัญญู
  ['เด็กยากจน สู้ชีวิต', 'สู้ชีวิต'], ['เด็กกตัญญู ช่วยพ่อแม่ทำงาน', 'กตัญญู/ครอบครัวอบอุ่น'],
  ['เด็กเก็บขยะ ขายของ ช่วยครอบครัว', 'สู้ชีวิต'], ['นักเรียนยากจน เรียนเก่ง', 'สู้ชีวิต'],
  ['เด็กกำพร้า อยู่กับยาย', 'สู้ชีวิต'],
  // 🤲 ช่วยเหลือ/ปันน้ำใจ (ปัญญาปันสุข แท้ — คลิปแจกของ/มอบเงิน)
  ['ช่วยเหลือคนจน ปันน้ำใจ', 'น้ำใจ/ช่วยเหลือ'], ['แจกข้าว แจกเงิน คนยากไร้', 'น้ำใจ/ช่วยเหลือ'],
  ['มอบทุน ช่วยเด็กยากจน', 'น้ำใจ/ช่วยเหลือ'], ['สร้างบ้านให้คนจน ไวรัล', 'น้ำใจ/ช่วยเหลือ'],
  // 🤝 พลเมืองดี/น้ำใจ
  ['พลเมืองดี ช่วยชีวิต', 'น้ำใจ/ช่วยเหลือ'], ['คืนเงิน คืนของ ซื่อสัตย์', 'น้ำใจ/ช่วยเหลือ'],
  ['น้ำใจ ช่วยคนแปลกหน้า ประทับใจ', 'น้ำใจ/ช่วยเหลือ'],
  // 🧓 คนแก่/สู้ชีวิต
  ['คนแก่ สู้ชีวิต ขายของ', 'สู้ชีวิต'], ['ตายาย เลี้ยงหลาน ลำบาก', 'สู้ชีวิต'],
  ['คนพิการ สู้ชีวิต ไม่ยอมแพ้', 'สู้ชีวิต'],
  // 🎖️ เครื่องแบบ/พระ/ครู เสียสละ
  ['กู้ภัย ช่วยชีวิต นาทีชีวิต', 'น้ำใจ/ช่วยเหลือ'], ['ตำรวจ ทหาร น้ำใจ ช่วยชาวบ้าน', 'น้ำใจ/ช่วยเหลือ'],
  ['ครูดอย เสียสละ เพื่อเด็ก', 'สู้ชีวิต'], ['พระ หลวงพ่อ ช่วยคนยาก', 'น้ำใจ/ช่วยเหลือ'],
  // 🐶 รักสัตว์ (น้ำดีที่คลิปปังมาก)
  ['ช่วยหมาแมวจร รักสัตว์', 'ไลฟ์สไตล์/ไวรัล'], ['เลี้ยงสัตว์จร ใจบุญ ไวรัล', 'ไลฟ์สไตล์/ไวรัล'],
  // 🔥 กระแสน้ำดี
  ['เรื่องราวน้ำใจ ประทับใจ ไวรัล', 'น้ำใจ/ช่วยเหลือ'], ['คลิปซึ้ง กินใจ ชาวเน็ตแห่ชม', 'น้ำใจ/ช่วยเหลือ'],
];

/** ★★★ คลิปน้ำดีลึกทุกแพลตฟอร์ม (4 ก.ค.) — เรื่องคนจริงกินใจ perPlatform คีย์/แพลตฟอร์ม/รอบ */
export function generateDeepGoodClipQueries(perPlatform = 3) {
  const slot = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (const platform of CLIP_PLATFORMS) {
    for (let i = 0; i < perPlatform; i++) {
      const [q, category] = DEEP_GOOD_CLIP_POOL[(slot * perPlatform + i + CLIP_PLATFORMS.indexOf(platform) * 2) % DEEP_GOOD_CLIP_POOL.length];
      out.push({ q, platform, category, lane: 'clip' });
    }
  }
  return out;
}

/** ขนาดคลังทั้งหมด (ไว้ log/ตรวจ) */
export function bankSize() {
  let combos = 0;
  for (const actions of Object.values(THEME_ACTIONS)) combos += actions.length * SUBJECTS.length;
  let fieldCombos = 0;
  for (const [, angles] of FIELD_ANGLES) fieldCombos += angles.length;
  const exaCombos = EXA_SUBJECTS.length * EXA_ANGLES.length;
  const clipCombos = CLIP_PLATFORMS.length * SUBJECTS.length * CLIP_ANGLES.length;
  return {
    themes: Object.keys(THEME_ACTIONS).length, subjects: SUBJECTS.length, themeCombos: combos,
    dailyTrend: DAILY_TREND_QUERIES.length, fields: FIELD_ANGLES.length, fieldCombos,
    exaSubjects: EXA_SUBJECTS.length, exaCombos, clipPlatforms: CLIP_PLATFORMS.length, clipCombos,
    grandTotal: combos + fieldCombos + exaCombos + clipCombos,
  };
}

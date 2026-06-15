/**
 * =====================================================
 * กองสืบน้ำดี (Good-News Scout Squad) — เฟส 1 (13 มิ.ย. 69 คำสั่งทีม)
 * =====================================================
 * ปัญหาเดิม: เลนน้ำดีใช้คำค้นตายตัว 18 ชุดหมุนวนซ้ำ → เจอแต่ข่าวที่ทุกเพจก็เจอ
 *           ข่าวน้ำดีดีๆ ที่ "ไม่มีใครนึกถึง" ไม่เคยถูกขุด
 * วิธีใหม่: สมองสืบ 7 แนว แต่ละแนวเชี่ยวชาญคนละด้านของข่าวน้ำดี
 *   - ทุกรอบหมุนเวร 2 แนว → AI คิดคำค้น "สด" เชิงลึกตามแนวนั้น (ไม่ใช่ลิสต์ตายตัว)
 *   - ความจำกันค้นซ้ำ: ไม่คิดคำที่เพิ่งใช้ใน 3 วัน → ขุดกว้างขึ้นเรื่อยๆ ไม่วนที่เดิม
 *   - ล่มเมื่อไหร่ fallback ไปคำค้นตายตัวเดิม (ไม่ทำให้รอบเก็บพัง)
 * ต้นทุน: 1 คอล gpt-4o-mini/รอบ (~฿0.5) + Serper เท่าเดิม (6 คำค้น/รอบ)
 */
import { callAI } from '@/lib/ai/openai';
import { createStore } from '@/lib/persistStore';

// 7 แนวข่าวน้ำดีที่เพจเล่นได้ — แต่ละแนวมีคำอธิบาย + ตัวอย่างจุดที่อยากได้ (seed ให้ AI เห็นทิศ)
export const SCOUT_GENRES = [
  { key: 'celeb_good', name: 'ดาราใจบุญ-กตัญญู', brief: 'ดารา/คนดังบริจาค ดูแลพ่อแม่ ทำบุญ ช่วยเหลือเงียบๆ คืนกำไรสังคม', seed: 'ดาราสร้างตึกให้โรงพยาบาล, นักร้องดูแลแม่ป่วย, ดาราบริจาคทุนเด็กกำพร้า' },
  { key: 'ordinary_fighter', name: 'สามัญชนสู้ชีวิต', brief: 'คนธรรมดาฝ่าฟันความยากจน/อุปสรรค จนตั้งตัวได้/สำเร็จ', seed: 'แม่ค้าส่งลูกเรียนหมอ, คนพิการเปิดธุรกิจ, เด็กยากจนสอบติดมหาลัยดัง' },
  { key: 'thai_abroad', name: 'คนไทยไกลบ้าน (ใจฟู)', brief: 'คนไทยไปรุ่ง/ทำอาชีพน่าทึ่ง/สร้างชื่อในต่างแดน — แนวที่คนไทยภูมิใจ', seed: 'สาวไทยขับรถบรรทุกอเมริกาเงินเดือนสูง, เชฟไทยร้านมิชลินยุโรป, คนไทยเป็นพยาบาลญี่ปุ่น' },
  { key: 'good_samaritan', name: 'น้ำใจ-พลเมืองดี', brief: 'คืนของ/คืนเงิน ช่วยชีวิต ช่วยคนเดือดร้อน โดยไม่หวังผล', seed: 'วินคืนกระเป๋าเงินแสน, พลเมืองดีช่วยคนจมน้ำ, คนเก็บเงินได้ตามคืนเจ้าของ' },
  { key: 'animal_love', name: 'รักสัตว์', brief: 'ช่วย/เลี้ยง/รักษาสัตว์จร ความผูกพันคนกับสัตว์', seed: 'หนุ่มเลี้ยงหมาจร 50 ตัว, ช่วยช้างป่วย, แมวเฝ้าหลุมเจ้าของ' },
  { key: 'youth_good', name: 'เด็ก-เยาวชนเก่งดี', brief: 'เด็ก/เยาวชนกตัญญู เก่ง มีน้ำใจ ทำเพื่อครอบครัว/สังคม', seed: 'เด็กเก็บขยะส่งตัวเองเรียน, นักเรียนช่วยคนแก่ข้ามถนน, เด็กคืนเงินที่เก็บได้' },
  { key: 'elder_admirable', name: 'ผู้สูงวัย-อาชีพน่าทึ่ง', brief: 'คนแก่สู้ชีวิต อาชีพหายาก/น่าทึ่ง ภูมิปัญญา', seed: 'ยายขายขนม 40 ปีส่งหลานเรียนจบ, ตาวัย 80 ยังทำงานช่าง, ป้าทำอาชีพโบราณ' },
];

// ★ ทะเบียนดาราดัง (13 มิ.ย. 69): ข่าวดาราดังทำดีคือของที่ดันเพจสุด แต่คำค้นกว้างหาไม่เจอ
//   ต้องค้น "ด้วยชื่อ" ถึงเจอ เช่น "พลอย เฌอมาลย์ สร้างบ้าน" — หมุนชื่อทุกรอบ + คู่กับคำทำดี
const CELEB_REGISTRY = [
  'ญาญ่า อุรัสยา', 'ณเดชน์', 'ใบเตย อาร์สยาม', 'ลิซ่า ลลิษา', 'มาริโอ้ เมาเร่อ',
  'อั้ม พัชราภา', 'ชมพู่ อารยา', 'แต้ว ณฐพร', 'มิว นิษฐา', 'เฌอมาลย์ บุญยศักดิ์',
  'พลอย เฌอมาลย์', 'เบลล่า ราณี', 'เวียร์ ศุกลวัฒน์', 'หมาก ปริญ', 'เจมส์ จิรายุ',
  'ก้อย รัชวิน', 'ตูน บอดี้สแลม', 'พิม พิมประภา', 'มดดำ คชาภา', 'บูม กิตติคุณ',
  'เต้ย จรินทร์พร', 'แอฟ ทักษอร', 'นุ่น วรนุช', 'เจนนี่ ได้หมดถ้าสดชื่น', 'ลำไย ไหทองคำ',
  'หนูรัตน์', 'จ๊ะ นงผณี', 'ดีเจภูมิ', 'โตโน่ ภาคิน', 'บิ๊กเอ็ม กฤตฤทธิ์',
  'ก๊อต จิรายุ', 'เวฟ กันตพงศ์', 'ป๊อก ภัสสรกรณ์', 'หนิง ปณิตา', 'น้ำชา ชีรณัฐ',
  'ลูกหว้า พิจิกา', 'อ๋อม สกาวใจ', 'ฟิล์ม ธนภัทร', 'แจ๊ส ชวนชื่น', 'เก้า จิรายุ',
  // เพิ่ม 14 มิ.ย.: ดาราที่ดังเรื่องทำดี/ไลฟ์สไตล์น้ำดี (ตามที่ทีมยกตัวอย่าง)
  'บี้ สุกฤษฎิ์', 'ไต๋ อรทัย', 'แก้มบุ๋ม ปนัดดา', 'พีท กันตพร', 'บอย ปกรณ์',
  'เอ ศุภชัย', 'แอน ทองประสม', 'ปู ไปรยา', 'เจี๊ยบ โสภิตนภา', 'หนุ่ม กรรชัย',
  'ทูน หิรัญทรัพย์', 'ก้อง สหรัถ', 'เจ เจตริน', 'อาเล็ก ธีรเดช', 'มาร์กี้ ราศรี',
];

// คำ "ทำดี" คู่กับชื่อดารา — ครอบความดีอมตะ (14 มิ.ย.: เพิ่มแนวที่ทีมยก หมาแมว/อยู่วัด/บ้านสวน)
const GOOD_DEED_TERMS = [
  'บริจาค ช่วยเหลือ', 'สร้างบ้านให้ ยกที่ดิน', 'ทำบุญ การกุศล', 'ดูแลพ่อแม่ กตัญญู', 'ติดดิน ใจดี น้ำใจ',
  'สร้างบ้านให้หมาแมว ดูแลสัตว์', 'ทิ้งวงการ ไปอยู่วัด ปฏิบัติธรรม', 'ใช้ชีวิตบ้านสวน ทำเกษตร', 'สร้างบ้านให้คนจน',
];

// ★ ความดี "อมตะ" (14 มิ.ย.): ค้นด้วยชื่อ × ความดีเฉพาะ ย้อนทั้งปี — ของรีเมคได้ ไม่ผูกเวลา
const EVERGREEN_CELEB_DEEDS = [
  'สร้างบ้านให้คนจน ยกที่ดิน', 'สร้างบ้านให้หมาแมว มูลนิธิสัตว์', 'ดูแลหมาแมวจร จ่ายค่าใช้จ่าย',
  'ทิ้งวงการบันเทิง ไปบวช อยู่วัด', 'กลับไปใช้ชีวิตบ้านสวน ทำไร่ทำนา', 'ดูแลพ่อแม่ กตัญญู ปลูกบ้าน',
  'บริจาคโรงพยาบาล สร้างตึก มูลนิธิ', 'ใช้ชีวิตเรียบง่าย ติดดิน พอเพียง',
];

// คำค้นกว้าง "ดาราดีอมตะ" ไม่ระบุชื่อ ย้อนทั้งปี
const EVERGREEN_BROAD = [
  'ดารา สร้างบ้านให้คนจน ยกที่ดิน', 'คนดัง เลี้ยงหมาแมวจร สร้างบ้านสัตว์', 'ดารา ทิ้งวงการไปบวช อยู่วัด',
  'ดารา กลับบ้านสวน ทำเกษตร ใช้ชีวิตเรียบง่าย', 'นักแสดง กตัญญู สร้างบ้านให้พ่อแม่', 'คนดัง บริจาคที่ดิน สร้างมูลนิธิ',
];

// ════════════════════════════════════════════════════
// ★ v4 (15 มิ.ย. คำสั่งทีม "ดาราเอาทุกแนว ยกเว้นกฎเหล็ก"): เรดาร์ดาราทุกประเภท + ย้อนสัมภาษณ์
//   เดิมค้นแต่ "ความดี" → ข่าวดารากระแส (รัก/เลิก/ครอบครัว/เงิน/ดราม่าวงการ/สัมภาษณ์) ไม่เคยถูกค้น
//   ดราม่า "นุ่ม" เล่นเป็นข่าวได้ — กันเฉพาะกฎเหล็ก (ฆ่า/เหล้า/พนัน/ยา/ทารุณ) ที่ด่านชั้น 0
// ════════════════════════════════════════════════════
// คำกว้าง "ข่าวดาราทุกแนว" — ดูดวอลุ่มเยอะ ครอบทุกประเภทที่เพจเล่นได้
const CELEB_RADAR_BROAD = [
  'ดารา เปิดใจ ล่าสุด', 'คนดัง สัมภาษณ์ ล่าสุด', 'ดารา ความรัก เลิกรา ล่าสุด',
  'ดารา ปัญหาครอบครัว ล่าสุด', 'ดารา เป็นหนี้ ปัญหาการเงิน ล่าสุด', 'ดารา ดราม่าวงการ ล่าสุด',
  'ดารา คัมแบ็ก กลับวงการ ล่าสุด', 'นักแสดง เคลียร์ใจ เปิดใจ ล่าสุด', 'ดารา ชีวิตพลิกผัน เปิดใจ',
  'คนดัง โดนโกง ถูกหลอก ล่าสุด', 'ดารา แต่งงาน สมรัก ล่าสุด', 'ดารา เลี้ยงลูก ครอบครัว ล่าสุด',
];

// ★ ทองคำ (15 มิ.ย. ทีมยกตัวอย่าง "เบสท์ออกรถให้น้องชาย / น้องอินเตอร์ออกรถให้พ่อแม่"):
//   ดารา "ให้ของขวัญ/ดูแลครอบครัว" — มีตัวละครชัด (ใครให้อะไรใคร) อารมณ์ร่วมสูง คนรักสุด
const CELEB_FAMILY_GIFT_BROAD = [
  'ดารา ออกรถให้ พ่อแม่', 'ดารา ซื้อบ้าน ปลูกบ้าน ให้พ่อแม่', 'คนดัง ของขวัญวันเกิด ให้ครอบครัว',
  'ดารา ออกรถ ให้น้อง ให้ลูก ของขวัญ', 'นักร้อง ซื้อรถ ซื้อทอง ให้แม่', 'ดารา พาครอบครัว เที่ยว ฉลอง',
  'ดารา ส่งน้องเรียน ดูแลน้อง', 'คนดัง เซอร์ไพรส์ ของขวัญ ครอบครัว', 'ดารา ซื้อของขวัญ ตอบแทน พ่อแม่',
  'ดารา สร้างบ้าน ซื้อบ้าน ให้แม่', 'คนดัง ฉลอง รับปริญญา ครอบครัวภูมิใจ', 'ดารา ดูแลครอบครัว กตัญญู ล่าสุด',
];
// คำคู่ "ของขวัญครอบครัว" สำหรับค้นด้วยชื่อ
const CELEB_GIFT_DEEDS = ['ออกรถให้', 'ซื้อบ้านให้', 'ของขวัญให้ครอบครัว', 'พาครอบครัวเที่ยว', 'ซื้อรถให้แม่', 'ดูแลพ่อแม่'];

// คำคู่ "แนวข่าวดารา" สำหรับค้นด้วยชื่อ — กว้าง ไม่เจาะจงเกิน (ค้นชื่อ×คำนี้เจอเยอะกว่าชื่อ×ความดียาว)
const CELEB_NEWS_DEEDS = ['ล่าสุด', 'เปิดใจ', 'สัมภาษณ์ ล่าสุด', 'ความรัก ล่าสุด', 'ข่าว ล่าสุด', 'ชีวิต ล่าสุด'];

// ★ ย้อนสัมภาษณ์ (throwback): สัมภาษณ์เก่าหยิบมาเล่าใหม่ — ตอนเลิกกัน/อกหัก/ช่วงตกต่ำ (ค้นย้อนทั้งปี)
const THROWBACK_BROAD = [
  'ดารา ย้อนสัมภาษณ์ ความรัก เลิกรา', 'คนดัง เปิดใจ อกหัก ช่วงนั้น', 'ดารา สัมภาษณ์ ช่วงตกต่ำ ชีวิตพลิก',
  'นักร้อง เปิดใจ เรื่องในอดีต', 'ดารา เคยพูดไว้ สัมภาษณ์เก่า ย้อน', 'คนดัง บทเรียนชีวิต เปิดใจ',
];
const THROWBACK_DEEDS = ['สัมภาษณ์ เลิกกับ', 'เปิดใจ อกหัก', 'ย้อนสัมภาษณ์ ความรัก', 'เปิดใจ ช่วงตกต่ำ', 'สัมภาษณ์ เรื่องในอดีต'];

/** ★ เรดาร์ดาราทุกแนว (15 มิ.ย.) — คำกว้าง 3 + ชื่อ×แนวข่าว 3 (qdr:m) lane='celeb' ผ่านด่าน soft-drama */
export function generateCelebRadarQueries(count = 6) {
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < 3; i++) out.push(CELEB_RADAR_BROAD[(hour * 3 + i) % CELEB_RADAR_BROAD.length]);
  for (let i = 0; i < count - 3; i++) {
    const name = CELEB_REGISTRY[(hour * 2 + i + 5) % CELEB_REGISTRY.length];
    const deed = CELEB_NEWS_DEEDS[(hour + i) % CELEB_NEWS_DEEDS.length];
    out.push(`${name} ${deed}`);
  }
  return out.slice(0, count).map(q => ({ q, genre: 'ดาราทุกแนว' }));
}

/**
 * ★ เรดาร์ "ดาราให้ของขวัญ-ดูแลครอบครัว" (15 มิ.ย.) — แนวทองที่ทีมรักสุด
 *   คำกว้าง 4 + ชื่อ×ของขวัญ 2 (qdr:m) → คัด AI ตีหมวด กตัญญู/ครอบครัวอบอุ่น (positive) lane='good'
 *   มีตัวละครชัด ใครให้อะไรใคร = อารมณ์ร่วมสูง
 */
export function generateCelebFamilyQueries(count = 6) {
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < 4; i++) out.push(CELEB_FAMILY_GIFT_BROAD[(hour * 4 + i) % CELEB_FAMILY_GIFT_BROAD.length]);
  for (let i = 0; i < count - 4; i++) {
    const name = CELEB_REGISTRY[(hour * 3 + i + 1) % CELEB_REGISTRY.length];
    const deed = CELEB_GIFT_DEEDS[(hour + i) % CELEB_GIFT_DEEDS.length];
    out.push(`${name} ${deed}`);
  }
  return out.slice(0, count).map(q => ({ q, genre: 'ดาราให้ของขวัญครอบครัว' }));
}

/** ★ ย้อนสัมภาษณ์ (15 มิ.ย.) — สัมภาษณ์เก่า qdr:y: คำกว้าง 2 + ชื่อ×แนว 2 lane='throwback' ยกเว้นด่านตัดของเก่า */
export function generateThrowbackQueries(count = 4) {
  const day = Math.floor(Date.now() / 864e5);
  const out = [];
  out.push(THROWBACK_BROAD[(day * 2) % THROWBACK_BROAD.length]);
  out.push(THROWBACK_BROAD[(day * 2 + 1) % THROWBACK_BROAD.length]);
  for (let i = 0; i < count - 2; i++) {
    const name = CELEB_REGISTRY[(day * 2 + i + 3) % CELEB_REGISTRY.length];
    const deed = THROWBACK_DEEDS[(day + i) % THROWBACK_DEEDS.length];
    out.push(`${name} ${deed}`);
  }
  return out.slice(0, count).map(q => ({ q, genre: 'ย้อนสัมภาษณ์' }));
}

// คำค้นกว้าง "ดาราทำดี" — ไม่ระบุชื่อ ดูดได้เยอะ (Serper คืน ~10/คำ) จับว่าดาราไหนก็ตามที่เพิ่งทำดี
const CELEB_BROAD_TERMS = [
  'คนดัง สร้างบ้าน มอบ ยกที่ดิน', 'ดารา บริจาค ช่วยเหลือ ล่าสุด', 'นักร้อง นักแสดง ทำบุญ การกุศล',
  'ดาราติดดิน ใจดี น้ำใจ', 'คนดัง ช่วยน้ำท่วม ผู้ประสบภัย', 'ดารา ดูแลพ่อแม่ กตัญญู ซื้อบ้าน',
  'เซเลบ บริจาคโรงพยาบาล มูลนิธิ', 'ดารา เปิดตัวช่วยสังคม โครงการ',
];

/** คำค้นดาราทำดี: คำกว้าง 2 (เยอะ) + ชื่อเฉพาะ 1 (แม่น) — หมุนตามชั่วโมง */
function pickRotatingCelebs(count = 3) {
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  // 2 คำกว้าง (ดูดวอลุ่ม)
  out.push(CELEB_BROAD_TERMS[(hour * 2) % CELEB_BROAD_TERMS.length]);
  out.push(CELEB_BROAD_TERMS[(hour * 2 + 1) % CELEB_BROAD_TERMS.length]);
  // 1 ชื่อเฉพาะ (เจาะดารา A-list — วนครบทะเบียนใน ~40 ชม.)
  const name = CELEB_REGISTRY[hour % CELEB_REGISTRY.length];
  const deed = GOOD_DEED_TERMS[hour % GOOD_DEED_TERMS.length];
  out.push(`${name} ${deed}`);
  return out.slice(0, count);
}

/**
 * ★ คำค้น "ดาราดีอมตะ" (14 มิ.ย.) — ค้นย้อนทั้งปี (qdr:y) ของรีเมคได้ ไม่ผูกเวลา
 *   คำกว้าง 2 + ชื่อ×ความดีเฉพาะ 2 (เจาะ พลอยสร้างบ้าน/อั้มหมาแมว/บี้อยู่วัด/ไต๋บ้านสวน)
 *   ★ ติด tag เพื่อให้ harvester ยกเว้นจากด่านตัด "กระแสอดีต" (เพราะความดีอมตะเก่าได้)
 * @returns {Array<{q, genre}>} genre = 'ดาราดีอมตะ'
 */
export function generateEvergreenCelebQueries(count = 4) {
  const day = Math.floor(Date.now() / 864e5); // หมุนตามวัน (ของอมตะไม่ต้องเปลี่ยนทุกชั่วโมง)
  const out = [];
  out.push(EVERGREEN_BROAD[(day * 2) % EVERGREEN_BROAD.length]);
  out.push(EVERGREEN_BROAD[(day * 2 + 1) % EVERGREEN_BROAD.length]);
  for (let i = 0; i < count - 2; i++) {
    const name = CELEB_REGISTRY[(day * 2 + i) % CELEB_REGISTRY.length];
    const deed = EVERGREEN_CELEB_DEEDS[(day + i) % EVERGREEN_CELEB_DEEDS.length];
    out.push(`${name} ${deed}`);
  }
  return out.slice(0, count).map(q => ({ q, genre: 'ดาราดีอมตะ' }));
}

// ★ v5 (15 มิ.ย. ทีมยก "เปิดบ้านดารา/รับหมาจร/พลอยสร้างบ้าน"): ไลฟ์สไตล์ดารา — เปิดบ้าน/รับสัตว์จร/สร้างบ้าน/ชีวิตวัยเด็ก
//   มักอยู่บนเว็บบันเทิง/ยูทูป (ค้นผ่าน /search, /videos) ที่ /news มองข้าม
const CELEB_LIFESTYLE_BROAD = [
  'เปิดบ้านดารา หรูหรา พาทัวร์', 'ดารา รับเลี้ยงหมาจร แมวจร ใจบุญ', 'ดารา สร้างบ้านใหม่ บ้านในฝัน',
  'ดารา เปิดใจ ชีวิตวัยเด็ก ลำบาก', 'ดารา จุดเปลี่ยนชีวิต สู้ชีวิต', 'ดารา รีโนเวทบ้าน แต่งบ้านใหม่',
  'ดารา พาเที่ยวบ้านเกิด ครอบครัว', 'คนดัง เปิดบ้านรับสัตว์จร เลี้ยงหมาแมว', 'ดารา ใช้ชีวิตบ้านสวน เรียบง่าย',
];

/** ★ ไลฟ์สไตล์ดารา (15 มิ.ย.) — เปิดบ้าน/รับสัตว์/สร้างบ้าน/วัยเด็ก: คำกว้าง count คำ (ใช้กับ /search หรือ /videos) */
export function generateCelebLifestyleQueries(count = 6) {
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < count; i++) out.push(CELEB_LIFESTYLE_BROAD[(hour * count + i) % CELEB_LIFESTYLE_BROAD.length]);
  return out.map(q => ({ q, genre: 'ไลฟ์สไตล์ดารา' }));
}

// ★ v5.1 (15 มิ.ย. ทีมขอ "โฟกัสคลิป/เพจมากขึ้น"): ไฮไลท์สัมภาษณ์ + ดราม่าตามเพจ/รีลส์ (อยู่บน FB/ยูทูปเยอะ)
//   ค้นผ่าน /search (คืนลิงก์ FB เพจ/รีลส์ + เว็บ) — เป็นเลน video (ดิสคัฟเวอรี ทีมเอาไปถอดคลิป/เขียนเอง)
const SOCIAL_CLIP_BROAD = [
  'ดารา สัมภาษณ์ ไฮไลท์ คลิป', 'ดารา เปิดใจ คลิปไวรัล ล่าสุด', 'ดารา ดราม่า คลิป เพจดัง',
  'คนดัง ตอบโต้ ดราม่า ล่าสุด', 'สัมภาษณ์ดารา ประเด็นร้อน เปิดใจ', 'ดารา ไลฟ์สด เปิดใจ ไวรัล',
  'ดารา เคลียร์ดราม่า คลิป', 'ไฮไลท์รายการ ดารา เปิดใจ น้ำตา',
];

/** ★ คลิป/เพจดารา (15 มิ.ย.) — ไฮไลท์สัมภาษณ์+ดราม่าจากเพจ/รีลส์: คำกว้าง count คำ (ใช้กับ /search ให้คืนลิงก์ FB) */
export function generateSocialClipQueries(count = 6) {
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < count; i++) out.push(SOCIAL_CLIP_BROAD[(hour * count + i) % SOCIAL_CLIP_BROAD.length]);
  return out.map(q => ({ q, genre: 'คลิป/เพจดารา' }));
}

// ════════════════════════════════════════════════════
// ★ สั่งหาข่าว "เฉพาะแนว" (15 มิ.ย. คำสั่งทีม): เลือกโฟกัส → ค้นเฉพาะแนวนั้น (เติมช่องว่างของวันได้ตรงจุด)
// ════════════════════════════════════════════════════
const FOCUS_FIXED = {
  animal: ['ช่วยหมาแมวจร น้ำใจ ไวรัล', 'หนุ่มสาวเลี้ยงหมาแมวจร ใจบุญ', 'ช่วยชีวิตสัตว์ ซึ้ง ไวรัล', 'หมาแมว ผูกพันเจ้าของ ซึ้ง ไวรัล', 'สุนัขแสนรู้ ช่วยคน ไวรัล', 'รับเลี้ยงสัตว์พิการ ดูแล ไวรัล', 'สร้างบ้านให้หมาแมวจร ใจบุญ', 'ช้าง สัตว์ป่า ได้รับการช่วยเหลือ'],
  good_deed: ['น้ำใจคนไทย ช่วยเหลือ ไวรัล', 'พลเมืองดี คืนเงิน คืนของ เจ้าของ', 'ช่วยชีวิต นาทีชีวิต ไวรัล', 'คนใจบุญ ช่วยคนเดือดร้อน ล่าสุด', 'วินมอเตอร์ไซค์ แท็กซี่ น้ำใจ คืนของ', 'กู้ภัย ช่วยชีวิต ประทับใจ', 'แจกอาหารฟรี ช่วยคนตกงาน', 'รวมเงินช่วย เพื่อนบ้าน ไวรัล'],
  fighter: ['สู้ชีวิต ไม่ยอมแพ้ ไวรัล', 'คนพิการ สู้ชีวิต ทำธุรกิจ สำเร็จ', 'เด็กยากจน สอบติด ทุนการศึกษา', 'แม่ค้า สู้ชีวิต ส่งลูกเรียนจบ', 'ลุงป้า สู้ชีวิต ขายของ ไวรัล', 'พลิกชีวิตจากศูนย์ สำเร็จ ไวรัล', 'หาบเร่ แผงลอย สู้ชีวิต ไวรัล', 'คนสูงวัย สู้ชีวิต อาชีพน่าทึ่ง'],
  trend: ['แห่ชื่นชม น้ำใจ ล่าสุด', 'คลิปไวรัล ประทับใจ ล่าสุด', 'สุดซึ้ง ชาวเน็ต ล่าสุด', 'ดราม่าร้านดัง ล่าสุด', 'เปิดใจทั้งน้ำตา ล่าสุด', 'สะเทือนใจ ชาวเน็ตแห่แชร์', 'คลิปกล้องวงจรปิด ช่วยเหลือ', 'ขอความเป็นธรรม ดราม่า ล่าสุด'],
};

/** รายการแนวที่สั่งได้ (ให้ UI ใช้ทำปุ่ม) — key ต้องตรงกับ generateFocusQueries */
export const FOCUS_OPTIONS = [
  { key: 'celeb_family', label: '🎁 ดาราให้ของขวัญครอบครัว' },
  { key: 'celeb_lifestyle', label: '🏡 เปิดบ้าน/รับสัตว์/ไลฟ์สไตล์ดารา' },
  { key: 'celeb_drama', label: '🎬 ดราม่า/ความรักดารา' },
  { key: 'throwback', label: '⏪ ย้อนสัมภาษณ์เก่า' },
  { key: 'celeb_good', label: '⭐ ดาราทำดี/อมตะ' },
  { key: 'video', label: '📺 วิดีโอดารา (ยูทูป)' },
  { key: 'social', label: '📘 เพจ/รีลส์ (สัมภาษณ์+ดราม่า)' },
  { key: 'animal', label: '🐶 รักสัตว์' },
  { key: 'good_deed', label: '🙏 น้ำใจ/พลเมืองดี' },
  { key: 'fighter', label: '💪 สู้ชีวิต' },
  { key: 'trend', label: '🔥 กระแสไวรัล' },
];

/**
 * ★ สร้างคำค้นตามแนวที่สั่ง → [{q, lane, timeRange, endpoint}] (ใช้เป็น extraQueries ใน runHarvest)
 *   endpoint: undefined=/news | 'search'=เว็บกว้าง | 'videos'=ยูทูป
 * @param {string} focus - key จาก FOCUS_OPTIONS
 */
export function generateFocusQueries(focus, count = 8) {
  const wrap = (arr, lane, timeRange, endpoint) => arr.map(x => ({ q: (x && x.q) || x, lane, timeRange, endpoint })).filter(o => o.q && o.q.length >= 4);
  switch (focus) {
    case 'celeb_family': return wrap(generateCelebFamilyQueries(count), 'good', 'qdr:m');
    case 'celeb_lifestyle': return wrap(generateCelebLifestyleQueries(count), 'good', 'qdr:y', 'search'); // เว็บกว้าง + ย้อนทั้งปี
    case 'celeb_drama': return wrap(generateCelebRadarQueries(count), 'celeb', 'qdr:m');
    case 'throwback': return wrap(generateThrowbackQueries(count), 'throwback', 'qdr:y');
    case 'celeb_good': return wrap(generateEvergreenCelebQueries(count), 'evergreen-celeb', 'qdr:y');
    case 'video': return wrap(generateCelebLifestyleQueries(count), 'video', '', 'videos'); // ยูทูป (ดิสคัฟเวอรี ไม่ auto-เขียน)
    case 'social': return wrap(generateSocialClipQueries(count), 'video', '', 'search'); // เพจ/รีลส์ FB ไฮไลท์สัมภาษณ์+ดราม่า (ดิสคัฟเวอรี)
    case 'animal': return wrap((FOCUS_FIXED.animal || []).slice(0, count), 'good', 'qdr:w');
    case 'good_deed': return wrap((FOCUS_FIXED.good_deed || []).slice(0, count), 'good', 'qdr:w');
    case 'fighter': return wrap((FOCUS_FIXED.fighter || []).slice(0, count), 'good', 'qdr:w');
    case 'trend': return wrap((FOCUS_FIXED.trend || []).slice(0, count), 'trend', 'qdr:d');
    default: return [];
  }
}

/** หมุนเวรเลือกแนวตามชั่วโมง (celeb แยกเป็นเครื่องค้นชื่อ + พัก thai_abroad เพราะตัดต่างประเทศแล้ว) */
export function pickRotatingGenres(count = 1) {
  // celeb_good → เครื่องค้นชื่อ (ทุกรอบ) | thai_abroad → พักไว้ (ติดด่านตัดต่างประเทศ 13 มิ.ย., ปลุกคืนเฟส 2)
  const others = SCOUT_GENRES.filter(g => g.key !== 'celeb_good' && g.key !== 'thai_abroad');
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < count; i++) out.push(others[(hour * count + i) % others.length]);
  return out;
}

const MEMORY_ID = 'scout-keyword-log';

/** อ่านคำค้นที่เพิ่งใช้ใน 3 วัน (เพื่อบอก AI ห้ามคิดซ้ำ) */
async function loadRecentKeywords() {
  try {
    const store = createStore('scout-memory');
    const all = await store.getAll();
    const doc = all.find(d => d.id === MEMORY_ID);
    if (!doc || !Array.isArray(doc.keywords)) return [];
    const cutoff = Date.now() - 3 * 864e5;
    return doc.keywords.filter(k => new Date(k.at).getTime() > cutoff).map(k => k.q);
  } catch { return []; }
}

/** บันทึกคำค้นที่เพิ่งใช้ (เก็บล่าสุด 120 คำ) */
async function saveUsedKeywords(queries) {
  try {
    const store = createStore('scout-memory');
    const all = await store.getAll();
    const doc = all.find(d => d.id === MEMORY_ID);
    const now = new Date().toISOString();
    const fresh = queries.map(q => ({ q, at: now }));
    if (doc) {
      const merged = [...fresh, ...(doc.keywords || [])].slice(0, 120);
      await store.update(MEMORY_ID, (ex) => ({ ...ex, keywords: merged }));
    } else {
      await store.add({ id: MEMORY_ID, keywords: fresh });
    }
  } catch (e) { console.log('[Scout] บันทึกความจำล้ม:', e.message?.slice(0, 40)); }
}

/**
 * สร้างคำค้นข่าวน้ำดีสด ๆ จากสมองสืบ 2 แนวที่เวรอยู่ชั่วโมงนี้
 * @returns {Promise<Array<{q:string, genre:string}>>} — [] ถ้าล่ม (ให้ caller fallback)
 */
export async function generateScoutQueries(total = 6) {
  // ★ ค้นดาราดังด้วยชื่อทุกรอบ (3 ชื่อ) — ของที่ดันเพจสุด คำกว้างหาไม่เจอ
  const celebQs = pickRotatingCelebs(3).map(q => ({ q, genre: 'ดาราดังทำดี' }));

  // + 1 แนวหมุนเวร (AI คิดคำค้นสด 3 คำ)
  const genres = pickRotatingGenres(1);
  const recent = await loadRecentKeywords();

  const prompt = `คุณคือกองสืบข่าว "น้ำดี" ของเพจข่าวไวรัลไทย หน้าที่: คิดคำค้น Google News ที่จะไปเจอข่าวน้ำดีที่ "ทำได้จริงและคนไทยรัก" แต่คนอื่นไม่ค่อยขุด

แนวที่ต้องล่าชั่วโมงนี้:
${genres.map((g, i) => `${i + 1}. [${g.name}] ${g.brief}\n   แนวตัวอย่าง: ${g.seed}`).join('\n')}

กติกาคิดคำค้น:
- คิดคำค้นเฉพาะเจาะจง ลึก หลากหลายสถานการณ์ (ไม่ใช่คำกว้างๆ ที่ทุกคนค้น) — นึกถึงเรื่องจริงที่คนจะใจฟู
- ต้องเป็น "คนไทย" หรือเรื่องที่คนไทยอินได้ (เว็บข่าวไทย)
- เลี่ยงคำที่เคยใช้ไปแล้ว (ห้ามซ้ำลิสต์นี้): ${recent.slice(0, 40).join(' | ') || '(ยังไม่มี)'}
- คำค้นละ 2-6 คำ เป็นภาษาไทย กระชับ

ตอบ JSON เท่านั้น: {"queries":[{"genre":"ชื่อแนว","q":"คำค้น"}]} รวม 3 คำ`;

  let genreQs = [];
  try {
    const res = await callAI({ model: 'gpt-4o-mini', temperature: 0.8, maxTokens: 600, prompt });
    const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    genreQs = (parsed.queries || [])
      .map(x => ({ q: String(x.q || '').trim(), genre: String(x.genre || '') }))
      .filter(x => x.q.length >= 4 && x.q.length <= 60)
      .slice(0, 3);
  } catch (e) {
    console.log('[Scout] สมองสืบคิดคำแนวล่ม (ยังมีคำค้นดารา):', e.message?.slice(0, 50));
  }

  const all = [...celebQs, ...genreQs].slice(0, total);
  await saveUsedKeywords(all.map(x => x.q)).catch(() => {});
  console.log(`[Scout] 🕵️ กองสืบ: ดารา ${celebQs.length} คำ + แนว ${genres[0]?.name || '-'} ${genreQs.length} คำ`);
  return all;
}

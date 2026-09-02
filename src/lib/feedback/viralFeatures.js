// ============================================================
// 🎯 src/lib/feedback/viralFeatures.js — ฟีเจอร์ "โอกาสปัง" จากข้อความล้วน (2 ก.ย. 69)
// ------------------------------------------------------------
// ที่มา: วิเคราะห์ 70 โพสต์จริง (TOP 40 / MID 15 / LOW 15 — C:\tmp\news-r233-run\technique-analysis.json)
//   เทคนิค T1–T11 + anti-pattern 8 ข้อ → แปลงเป็นตัวเลขที่นับได้จากข้อความ ไม่ใช้ AI ไม่สุ่ม
// กติกา: ไฟล์นี้ "ไม่มี import" — ยืนเดี่ยว เทสยิงตรงได้ · deterministic (ข้อความเดิม = ตัวเลขเดิมทุกครั้ง)
//   ตัดคำไทยด้วย Intl.Segmenter (global ของ V8 ไม่ต้อง import) วิธีเดียวกับที่นับ `words` ใน fb-posts.json
//   (สำรอง: ตัดตามช่วงอักษรถ้า Intl.Segmenter ไม่มี — ตัวเลขจะหยาบลงแต่ไม่ล้ม)
// ผลลัพธ์: extractFeatures(text) → object ตัวเลขล้วน (0/1 · จำนวน · ความหนาแน่นต่อ 100 คำ · สัดส่วน 0–1)
//   MODEL_FEATURES = คีย์ที่โมเดลใช้ (ลำดับคงที่ — สคริปต์เทรนกับตัวให้คะแนนต้องอ่านลำดับเดียวกัน)
//   คีย์นอกโมเดล: openingTypeIndex (0–6) · lengthBand (0–5) — เอาไว้แสดงผล ไม่ใส่ในสมการเชิงเส้น
// ============================================================

export const OPENING_TYPES = ['contrast', 'name_action', 'quote', 'number', 'praise', 'question', 'other'];
export const OPENING_LABELS_TH = {
  contrast: 'ความต่าง (แม้…แต่ / ไม่ใช่…แต่ / จาก X สู่ Y)',
  name_action: 'ชื่อคน+การกระทำ',
  quote: 'คำพูดจริง',
  number: 'ตัวเลขนำ',
  praise: 'ชื่นชม/ไม่แปลกใจ',
  question: 'คำถาม',
  other: 'อื่นๆ',
};

// โซนความยาว (คำ) — จากวิจัยโซนหวาน 1,928 โพสต์: 160–169 ปังสุด · 270 = กำแพง · พื้น 146
export const LENGTH_BANDS = [
  { key: 'band_lt146', min: 0, max: 146, label: 'ต่ำกว่า 146 คำ' },
  { key: 'band_146_169', min: 146, max: 170, label: '146–169 คำ' },
  { key: 'band_170_199', min: 170, max: 200, label: '170–199 คำ' },
  { key: 'band_200_229', min: 200, max: 230, label: '200–229 คำ' },
  { key: 'band_230_269', min: 230, max: 270, label: '230–269 คำ' },
  { key: 'band_ge270', min: 270, max: Infinity, label: '270 คำขึ้นไป' },
];

export const MODEL_FEATURES = [
  'words', 'paragraphs', 'threeParagraphs', 'firstParaWords',
  'quoteCount', 'quotedNames', 'hasDirectQuoteToReceiver',
  'numberCount', 'hardshipNumber', 'moneyNumber', 'ageNumber', 'giftAmount', 'giveWords',
  'kinshipNameInFirst30', 'kinshipNameInFirst120', 'kinshipWordCount',
  'orgGiverInFirst60', 'orgGiverInFirstPara', 'orgWordCount', 'titleHonorificFirst',
  'open_contrast', 'open_name_action', 'open_quote', 'open_number', 'open_praise', 'open_question', 'open_other',
  'abstractNounDensity', 'closingEchoesOpening', 'genericClosing',
  'stakeWords', 'hasStake', 'secondTurn', 'closingTearsHug', 'bodyImageWords',
  'narratorVerdict', 'friendlyTone', 'comfortToReceiver', 'causeOpening2', 'dashOrPoemFormat',
  'band_lt146', 'band_146_169', 'band_170_199', 'band_200_229', 'band_230_269', 'band_ge270',
  'hashtagCount', 'emojiCount', 'exclamationCount', 'questionCount', 'ellipsisCount',
  'royalWords', 'celebWords',
];

// ---------- ตัดคำ ----------
let _segmenter = null;
let _segmenterTried = false;
function getSegmenter() {
  if (_segmenterTried) return _segmenter;
  _segmenterTried = true;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      _segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    }
  } catch { _segmenter = null; }
  return _segmenter;
}

/** คืนรายการคำ (เฉพาะ isWordLike) — วิธีเดียวกับตัวนับ words ของ fb-posts.json */
export function segmentWords(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return [];
  const seg = getSegmenter();
  if (seg) {
    const out = [];
    for (const part of seg.segment(s)) if (part.isWordLike) out.push(part.segment);
    return out;
  }
  // สำรองหยาบ: ช่วงอักษรไทย/ละติน/ตัวเลข = 1 คำ
  return s.match(/[\u0E00-\u0E7F]+|[A-Za-z]+|\d[\d,]*(?:\.\d+)?/g) || [];
}

// ---------- พจนานุกรมย่อย ----------
const KINSHIP = new Set([
  'พี่', 'น้อง', 'ยาย', 'ตา', 'ลุง', 'ป้า', 'น้า', 'อา', 'หมอ', 'ครู', 'พ่อ', 'แม่', 'ปู่', 'ย่า',
  'เจ๊', 'เฮีย', 'หมู่', 'จ่า', 'เสี่ย', 'คุณ', 'หลวงพ่อ', 'หลวงปู่', 'หลวงตา', 'หลวงพี่', 'ผู้กอง', 'ผู้การ',
]);
// คำที่ตามหลังคำเครือญาติแล้ว "ไม่ใช่ชื่อ" (คำเชื่อม/คำทั่วไป/คำเครือญาติซ้อน เช่น พี่น้อง คุณแม่ พ่อคนหนึ่ง)
const NOT_NAME_AFTER_KINSHIP = new Set([
  'คน', 'ที่', 'ของ', 'กับ', 'และ', 'ก็', 'ไม่', 'ไม่มี', 'ไม่รู้', 'ไม่ได้', 'ไม่เคย', 'จะ', 'ได้', 'เป็น', 'ใน', 'ให้', 'ยัง',
  'เขา', 'เธอ', 'วัย', 'ทุก', 'ผู้', 'หลาย', 'บาง', 'สาว', 'ชาย', 'หญิง', 'ๆ', 'เอง', 'ตัว', 'กัน', 'ก่อน', 'หลัง', 'จึง',
  'เลย', 'แท้', 'มา', 'ไป', 'อยู่', 'ต้อง', 'ซึ่ง', 'บอก', 'พูด', 'ตอบ', 'ถาม', 'เล่า', 'ฝึก', 'สอน', 'ใหญ่', 'เล็ก',
  'แก่', 'เฒ่า', 'ชรา', 'สู้', 'ยื่น', 'ช่วย', 'มอบ', 'รับ', 'ขอ', 'เห็น', 'ดู', 'ทำ', 'มี', 'พา', 'เดิน', 'วิ่ง', 'นั่ง',
  'ยืน', 'ร้องไห้', 'กอด', 'ตัดสิน', 'จาก', 'หรือ', 'แต่', 'แล้ว', 'ว่า', 'นี้', 'นั้น', 'ใคร', 'อีก', 'เพียง', 'แค่',
  'จน', 'เพราะ', 'เมื่อ', 'ตอน', 'ครั้ง', 'เดียว', 'ท่าน', 'ทั้ง', 'เอา', 'ใช้', 'ซื้อ', 'ขาย', 'ส่ง', 'กิน', 'นอน',
  'ตาย', 'ป่วย', 'จำ', 'รู้', 'คิด', 'รัก', 'ห่วง', 'เลี้ยง', 'ดูแล', 'หา', 'เก็บ', 'สอง', 'สาม', 'สี่', 'ห้า', 'แรก',
  'บ้าน', 'เมือง', 'บุญ', 'ค้า', 'ครัว', 'เฒ่า', 'แก้ว', 'ทัพ', 'ไทย', 'ไป', 'ใจ', 'หนึ่ง', 'นึง', 'พวก',
  ...KINSHIP,
]);
// หลวง + พ่อ/ปู่/ตา/พี่ = คำเครือญาติเดียว (ICU ตัด "หลวงพ่อพงษ์" เป็น หลวง|พ่อ|พงษ์)
const KINSHIP_PREFIX = new Set(['หลวง']);

const STOPWORDS = new Set([
  'ที่', 'ของ', 'และ', 'กับ', 'ให้', 'ได้', 'เป็น', 'ใน', 'ไม่', 'จะ', 'ก็', 'ว่า', 'มี', 'แต่', 'จาก', 'เพื่อ', 'ถึง',
  'แล้ว', 'ยัง', 'อยู่', 'คน', 'นี้', 'นั้น', 'เขา', 'เธอ', 'ก่อน', 'หลัง', 'ทั้ง', 'กว่า', 'ไป', 'มา', 'เลย', 'จน',
  'ต้อง', 'ซึ่ง', 'โดย', 'อย่าง', 'เมื่อ', 'วัน', 'ครั้ง', 'ตัว', 'เอง', 'กัน', 'คือ', 'นี่', 'ใคร', 'อีก', 'เพียง', 'แค่',
  'เพราะ', 'ตอน', 'เดียว', 'ทุก', 'หลาย', 'บาง', 'ผู้', 'ๆ', 'จึง', 'ถ้า', 'หรือ', 'เคย', 'ทำ', 'การ', 'ความ', 'สิ่ง',
  'เรื่อง', 'อะไร', 'ไหน', 'นะ', 'ค่ะ', 'ครับ', 'ด้วย', 'ออก', 'เข้า', 'ขึ้น', 'ลง', 'ไว้', 'เอา', 'ใช้', 'ดู', 'เห็น',
  'พวก', 'เรา', 'พอ', 'จริง', 'มาก', 'ทาง', 'ขณะ', 'กำลัง', 'ช่วง', 'เวลา', 'ล่าสุด', 'วันนี้', 'นี้', 'ตั้งแต่',
]);
const THAI_NUM_WORDS = { หนึ่ง: '1', สอง: '2', สาม: '3', สี่: '4', ห้า: '5', หก: '6', เจ็ด: '7', แปด: '8', เก้า: '9', สิบ: '10' };

const RE_NUMBER = /\d[\d,]*(?:\.\d+)?|[\u0E50-\u0E59]+/g;
const RE_HARDSHIP_NUM = /(?:\d[\d,]*(?:\.\d+)?|(?:หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)+)\s*(?:ล้าน|แสน|หมื่น|พัน|ร้อย)?\s*(?:บาท|กิโล|กม\.?|เมตร|วัน|เดือน|ปี|ชั่วโมง|ชม\.?|นาที|คืน)/g;
const RE_MONEY_NUM = /(?:\d[\d,]*(?:\.\d+)?|(?:หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)+)\s*(?:ล้าน|แสน|หมื่น|พัน|ร้อย)?\s*บาท/g;
const RE_AGE_NUM = /(?:วัย|อายุ)\s*\d[\d,]*|\d+\s*ขวบ/g;
const RE_GIVE = /มอบ|บริจาค|ช่วยเหลือ|ยื่นมือ|ควักเงิน|รับปาก|อุปการะ|ส่งเสีย|เยียวยา|ซื้อให้|สร้างให้|ออกให้|จ่ายให้|ให้เงิน|ให้ทุน|สนับสนุน|หยิบยื่น|แบ่งปัน|ระดม/g;
const RE_GIFT_AMOUNT = /(?:มอบ|บริจาค|ช่วยเหลือ|ควักเงิน|เยียวยา|ให้ทุน|ทุนการศึกษา|เงินก้อน|เงินช่วยเหลือ|มูลค่า|สมทบ|ระดม)[^\n]{0,40}?\d[\d,]*(?:\.\d+)?\s*(?:ล้าน|แสน|หมื่น|พัน)?\s*บาท/;
// กรม = หน่วยงาน (กรมป่าไม้/กรมการแพทย์) แต่ "กรมสมเด็จ/กรมหลวง/กรมพระ" = พระราชวงศ์ ไม่ใช่องค์กร
const RE_ORG = /มูลนิธิ|บริษัท|กรม(?!สมเด็จ|หลวง|พระ)|สำนักงาน|องค์กร|สมาคม|หน่วยงาน|กระทรวง|เทศบาล|อบต\.?|ธนาคาร|แบรนด์|ทีมงาน|เจ้าหน้าที่|โครงการ/g;
const RE_ORG_GIVER = /มูลนิธิ|บริษัท|กรม(?!สมเด็จ|หลวง|พระ)|สำนักงาน|องค์กร|สมาคม|หน่วยงาน|กระทรวง|เทศบาล|อบต\.?|ธนาคาร|แบรนด์/;
const RE_TITLE_FIRST = /^["“‘']?\s*(?:นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.)[ก-๙]/;
const RE_STAKE = /เสียชีวิต|ตาย(?![าิีุู])|จากไป|สูญเสีย|หนี้|ป่วย|โรค|มะเร็ง|ยากจน|ความจน|คนจน|ขัดสน|ไม่มีเงิน|ไม่มีจะกิน|อดมื้อ|ลำบาก|พิการ|ติดเตียง|ไฟไหม้|น้ำท่วม|ประสบเหตุ|บาดเจ็บ|กำพร้า|ตกงาน|ล้มละลาย|เร่ร่อน|ไร้บ้าน|ถล่ม|ระเบิด|อุบัติเหตุ|สิ้นใจ|ศพ|เคสดำ|สังขาร|ผู้สูญเสีย|โศกนาฏกรรม|ทุกข์/g;
const RE_SECOND_TURN = /แต่สุดท้าย|ทว่า|แต่แล้ว|แต่ข่าวร้าย|แต่กลับ|แต่วันนี้|แต่สิ่งที่|น่าเศร้าที่|ไปไม่ถึง|แต่[^\n]{0,40}(?:ไม่ทัน|ไม่มีโอกาส|จากไป|เสียชีวิต)/;
const RE_TEARS_HUG = /น้ำตา|กอด|ร้องไห้|ตื้นตัน|จุกอก|สะอื้น|ยกมือไหว้|กราบ/;
const RE_BODY_IMAGE = /มือ(?![ถ])|น้ำตา|กอด|ร้องไห้|เดินเท้า|วิ่ง|กวาด|แบก|ก้ม|รถเข็น|ยืน(?![ย])|นั่ง|สะพาย|ถือ|กำ(?![ลไหแ])|ไหว้|กราบ|หอบ|ลาก|ปั่น|เข็น|ขุด|ปีน|หาบ/g;
const RE_VERDICT = /ไม่แปลกใจ|นี่สิ|ตัวจริง|สมควรได้รับ|น่ายกย่อง|ชื่นชม|ดีใจแทน|ปรบมือ|นับถือ|ยกนิ้ว|สุดยอด|ต้องยกให้|คือแบบอย่าง|ไม่ใช่เรื่องง่าย|น่าทึ่ง/g;
const RE_FRIENDLY = /นึง(?![ก-๙])|หรอก|เด้อ|แหละ|ล่ะ|เนอะ|จริงๆ|มั้ย|ซะ(?![ก-๙])|นะ(?![ก-๙])|นะครับ|นะคะ|ค่ะ|ครับ|โคตร|เว้ย|จ้า|จ้ะ/g;
const RE_COMFORT = /ไม่ต้องห่วง|ไม่ต้องกังวล|ไม่ต้องสู้(?:ลำพัง|คนเดียว)|ไม่ต้องกลัว|หมดห่วง|สบายใจได้/;
const RE_CAUSE_OPEN2 = /^(?:เพราะ|แม้|ย้อนกลับไป|ย้อนไป|ก่อนหน้านี้|เรื่องนี้ต้องย้อน|ทั้งหมดเริ่ม|จุดเริ่มต้น|ที่มา|เบื้องหลัง|ปกติ|แต่)/;
const RE_GENERIC_CLOSING = /อายุเป็นเพียงตัวเลข|ความดี[^\n]{0,12}(?:ตลอดไป|ไม่มีวัน)|ขอให้|ขอแสดงความ|อนุโมทนา|สาธุ|ขอบคุณ[^\n]{0,40}(?:ที่|ทุกคน|ทุกท่าน)|เป็นกำลังใจ|ส่งกำลังใจ|สู้ๆ|ปิดทองหลังพระ|แสงสว่างและความหวัง|ตัวอย่างที่ดี|แบบอย่างที่ดี|แรงบันดาลใจ|โลกนี้ยังมี|คนดียังมี|อยู่ในใจ[^\n]{0,20}ตลอดไป|หลับให้สบาย|สู่สุคติ|ขอส่ง/;
const RE_ABSTRACT = /ความ[ก-๙]{2,}/g;
const RE_ROYAL = /พระองค์|ทรง(?!ผม)|เสด็จ|สมเด็จ|พระราช|ในหลวง|พระบรม/g;
const RE_CELEB = /ดารา|นักแสดง|นักร้อง|พระเอก|นางเอก|ซุปตาร์|ศิลปิน|เซเลบ|คนบันเทิง|วงการบันเทิง|ไอดอล|นางงาม|นักมวย|นักฟุตบอล|ยูทูบเบอร์|อินฟลู/g;
const RE_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu;
const RE_ELLIPSIS = /\.{2,}|…/g;
const RE_PRAISE_OPEN = /ชื่นชม|ไม่แปลกใจ|น่ารัก|น่ายกย่อง|สุดยอด|ยินดี|ดีใจแทน|ขอบคุณ|นับถือ|ซึ้ง|สาธุ|ปรบมือ|ยกนิ้ว|ตัวจริง|น่าทึ่ง|เก่ง/;
const RE_QUESTION_OPEN = /^\s*(?:ใครจะคิด|ใครจะ(?:ไป)?รู้|รู้(?:ไหม|มั้ย)|ทำไม|เคย(?:ไหม|มั้ย)|จะมีสักกี่คน)/;
const RE_CONTRAST_OPEN = /(?:แม้|ไม่|ทั้งๆ?ที่|ถึงจะ|ถึงแม้)[^\n]{1,90}แต่|จาก[^\n]{2,60}(?:สู่|กลายเป็น|วันนี้)/;
// คำพูดที่ผู้ให้พูดกับผู้รับตรงๆ (สั้น + มีคำเรียก/คำสั่ง/คำปลอบ) — T11
const RE_RECEIVER_QUOTE = /ไม่ต้องห่วง|ไม่ต้องกังวล|ไม่ต้องกลัว|มาเอาที่|ให้มา|เดี๋ยว(?:พี่|ผม|ฉัน|หนู|เรา)|(?:พี่|ผม|ฉัน|เรา|หนู)จะ|ขึ้น(?:หลัง|รถ)|ไปกับ(?:พี่|ผม|เรา)|ไว้ให้แล้ว|ได้เลย|เลย$|นะ$|เด้อ|นะครับ$|นะคะ$|ครับ$|ค่ะ$|จ้ะ$|จ้า$/;

function countMatches(re, s) {
  if (!s) return 0;
  const m = s.match(re);
  return m ? m.length : 0;
}

function findQuotes(text) {
  const out = [];
  const reDouble = /[“"]([^“”"\n]{1,300})[”"]/g;
  const reSingle = /[‘']([^‘’'\n]{1,300})[’']/g;
  let m;
  while ((m = reDouble.exec(text))) out.push(m[1].trim());
  while ((m = reSingle.exec(text))) out.push(m[1].trim());
  return out.filter(Boolean);
}

/** คำเครือญาติ+ชื่อ ในช่วงข้อความที่กำหนด (ตัดคำแล้วดูคู่คำ) */
function hasKinshipName(prefix) {
  const toks = segmentWords(prefix);
  for (let i = 0; i < toks.length; i++) {
    let kin = toks[i];
    let j = i + 1;
    if (KINSHIP_PREFIX.has(kin) && j < toks.length && KINSHIP.has(toks[j])) { kin = kin + toks[j]; j++; }
    if (!KINSHIP.has(kin)) continue;
    const next = toks[j];
    if (!next) continue;
    if (NOT_NAME_AFTER_KINSHIP.has(next)) continue;
    if (/^\d/.test(next)) continue;
    if (!/^[ก-๙A-Za-z]+$/.test(next)) continue;
    return 1;
  }
  return 0;
}

function countKinshipWords(tokens) {
  let n = 0;
  for (const t of tokens) if (KINSHIP.has(t) && t !== 'คุณ') n++;
  return n;
}

function contentWordSet(tokens) {
  const set = new Set();
  for (const raw of tokens) {
    const t = THAI_NUM_WORDS[raw] || raw;
    if (STOPWORDS.has(t)) continue;
    if (/^\d/.test(t)) { set.add(t.replace(/,/g, '')); continue; }
    if (t.length < 2) continue;
    set.add(t);
  }
  return set;
}

function lengthBandIndex(words) {
  for (let i = 0; i < LENGTH_BANDS.length; i++) {
    if (words >= LENGTH_BANDS[i].min && words < LENGTH_BANDS[i].max) return i;
  }
  return LENGTH_BANDS.length - 1;
}

function normalizeText(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

export function emptyFeatures() {
  const f = {};
  for (const k of MODEL_FEATURES) f[k] = 0;
  f.openingTypeIndex = OPENING_TYPES.indexOf('other');
  f.lengthBand = 0;
  return f;
}

function detectOpeningType(text, firstPara, quotes) {
  if (!text) return 'other';
  const head30 = text.slice(0, 30);
  const head150 = firstPara.slice(0, 150);
  // คำพูดจริงนำ: เปิดด้วยเครื่องหมายคำพูด และปิดคำพูดห่างออกไป ≥ 15 ตัวอักษร (ถ้าสั้นกว่านั้น = ชื่อคนในเครื่องหมาย)
  const openQuote = text.match(/^["“‘']([^"”’'\n]{15,300})["”’']/);
  if (openQuote) return 'quote';
  if (RE_PRAISE_OPEN.test(text.slice(0, 20))) return 'praise';
  if (RE_QUESTION_OPEN.test(text) || /\?/.test(firstPara)) return 'question';
  if (RE_CONTRAST_OPEN.test(head150)) return 'contrast';
  if (/^[^\n]{0,20}\d/.test(text)) return 'number';
  const quotedNameAtStart = /^["“‘']([^"”’'\n]{1,14})["”’']/.test(text);
  if (quotedNameAtStart || hasKinshipName(head30)) return 'name_action';
  return 'other';
}

/**
 * ดึงฟีเจอร์ตัวเลขล้วนจากข้อความโพสต์ — deterministic ไม่มี AI
 * @param {string} input ข้อความโพสต์ (ย่อหน้าคั่นด้วยบรรทัดว่าง)
 * @returns {Record<string, number>}
 */
export function extractFeatures(input) {
  const text = normalizeText(input);
  if (!text) return emptyFeatures();

  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const tokens = segmentWords(text);
  const words = tokens.length;
  const per100 = words > 0 ? 100 / words : 0;
  const firstPara = lines[0] || '';
  const secondPara = lines[1] || '';
  const lastPara = lines[lines.length - 1] || '';
  const firstParaTokens = segmentWords(firstPara);
  const lastParaTokens = segmentWords(lastPara);

  // --- คำพูด ---
  const quotes = findQuotes(text);
  const speechQuotes = quotes.filter(q => segmentWords(q).length >= 4);
  const quotedNames = quotes.length - speechQuotes.length;
  const hasDirectQuoteToReceiver = speechQuotes.some(q => q.length <= 70 && RE_RECEIVER_QUOTE.test(q)) ? 1 : 0;

  // --- ตัวเลข ---
  const numberCount = countMatches(RE_NUMBER, text);
  const hardshipNumber = countMatches(RE_HARDSHIP_NUM, text);
  const moneyNumber = countMatches(RE_MONEY_NUM, text);
  const ageNumber = countMatches(RE_AGE_NUM, text);
  const giftAmount = RE_GIFT_AMOUNT.test(text) ? 1 : 0;
  const giveWords = countMatches(RE_GIVE, text);

  // --- ตัวละคร / ผู้ให้ ---
  const kinshipNameInFirst30 = hasKinshipName(text.slice(0, 30));
  const kinshipNameInFirst120 = hasKinshipName(text.slice(0, 120));
  const kinshipWordCount = countKinshipWords(tokens);
  const orgGiverInFirst60 = RE_ORG_GIVER.test(text.slice(0, 60)) ? 1 : 0;
  const orgGiverInFirstPara = RE_ORG_GIVER.test(firstPara) ? 1 : 0;
  const orgWordCount = countMatches(RE_ORG, text);
  const titleHonorificFirst = RE_TITLE_FIRST.test(text) ? 1 : 0;

  // --- ประเภทประโยคเปิด ---
  const openingType = detectOpeningType(text, firstPara, quotes);
  const openingTypeIndex = OPENING_TYPES.indexOf(openingType);

  // --- ภาษา ---
  const abstractNounDensity = +(countMatches(RE_ABSTRACT, text) * per100).toFixed(4);
  const friendlyTone = +(countMatches(RE_FRIENDLY, text) * per100).toFixed(4);

  // --- ปิดสะท้อนเปิด: สัดส่วนคำเนื้อหาในท้ายเรื่อง (30 คำสุดท้าย) ที่โผล่ในประโยคเปิด (40 คำแรก) ---
  const openSet = contentWordSet(firstParaTokens.slice(0, 40));
  const closeTail = lastParaTokens.slice(Math.max(0, lastParaTokens.length - 30));
  const closeSet = contentWordSet(closeTail);
  let echo = 0;
  if (closeSet.size > 0) {
    let hit = 0;
    for (const w of closeSet) if (openSet.has(w)) hit++;
    echo = +(hit / closeSet.size).toFixed(4);
  }
  const genericClosing = RE_GENERIC_CLOSING.test(lastPara.slice(-160)) ? 1 : 0;

  // --- เดิมพัน / หักครั้งที่ 2 / ภาพ ---
  const stakeWords = countMatches(RE_STAKE, text);
  const secondTurn = lines.length >= 2 && RE_SECOND_TURN.test(lastPara) ? 1 : 0;
  const closingTearsHug = RE_TEARS_HUG.test(lastPara) ? 1 : 0;
  const bodyImageWords = countMatches(RE_BODY_IMAGE, text);
  const narratorVerdict = countMatches(RE_VERDICT, text);
  const comfortToReceiver = RE_COMFORT.test(text) ? 1 : 0;
  const causeOpening2 = secondPara && RE_CAUSE_OPEN2.test(secondPara) ? 1 : 0;

  // --- รูปแบบ ---
  const shortLines = lines.filter(l => segmentWords(l).length <= 8).length;
  const dashOrPoemFormat = /[—–]/.test(text) || shortLines >= 5 ? 1 : 0;
  const bandIdx = lengthBandIndex(words);

  const f = {
    words,
    paragraphs: lines.length,
    threeParagraphs: lines.length === 3 ? 1 : 0,
    firstParaWords: firstParaTokens.length,
    quoteCount: speechQuotes.length,
    quotedNames,
    hasDirectQuoteToReceiver,
    numberCount,
    hardshipNumber,
    moneyNumber,
    ageNumber,
    giftAmount,
    giveWords,
    kinshipNameInFirst30,
    kinshipNameInFirst120,
    kinshipWordCount,
    orgGiverInFirst60,
    orgGiverInFirstPara,
    orgWordCount,
    titleHonorificFirst,
    open_contrast: 0, open_name_action: 0, open_quote: 0, open_number: 0, open_praise: 0, open_question: 0, open_other: 0,
    abstractNounDensity,
    closingEchoesOpening: echo,
    genericClosing,
    stakeWords,
    hasStake: stakeWords > 0 ? 1 : 0,
    secondTurn,
    closingTearsHug,
    bodyImageWords,
    narratorVerdict,
    friendlyTone,
    comfortToReceiver,
    causeOpening2,
    dashOrPoemFormat,
    band_lt146: 0, band_146_169: 0, band_170_199: 0, band_200_229: 0, band_230_269: 0, band_ge270: 0,
    hashtagCount: countMatches(/#/g, text),
    emojiCount: countMatches(RE_EMOJI, text),
    exclamationCount: countMatches(/!/g, text),
    questionCount: countMatches(/\?/g, text),
    ellipsisCount: countMatches(RE_ELLIPSIS, text),
    royalWords: countMatches(RE_ROYAL, text),
    celebWords: countMatches(RE_CELEB, text),
    openingTypeIndex,
    lengthBand: bandIdx,
  };
  f[`open_${openingType}`] = 1;
  f[LENGTH_BANDS[bandIdx].key] = 1;
  return f;
}

/** เวกเตอร์ตามลำดับ MODEL_FEATURES (ใช้ตอนเทรน/ให้คะแนน) */
export function featureVector(features, names = MODEL_FEATURES) {
  return names.map(k => {
    const v = features ? Number(features[k]) : 0;
    return Number.isFinite(v) ? v : 0;
  });
}

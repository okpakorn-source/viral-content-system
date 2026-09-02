/**
 * L4.5 — ล้างชื่อสถานที่หลอน (ย้ายออกจาก correctionPipeline เพื่อให้เทสได้)
 *
 * ★ 1 ก.ย. 69 — บั๊กที่พิสูจน์แล้ว: regex เดิม `([ก-๙a-zA-Z]+)` กินตัวอักษรไทยยาวไม่จำกัด
 *   (ภาษาไทยไม่เว้นวรรค) → "โรงพยาบาลใกล้บ้านทันทีที่รู้ว่าอาการหนัก" ถูกมองเป็น "ชื่อสถานที่"
 *   ไม่พบในต้นฉบับ → ลบทั้งท่อนเหลือ "โรงพยาบาล" = เนื้อข่าวจริงหายโดยไม่มีใครรู้
 *
 * แก้: ชื่อต้องยาว 4–15 ตัว และต้องถูกปิดด้วยช่องว่าง/เครื่องหมาย/จบบรรทัด
 *   ท่อนยาวที่ไม่มีขอบเขต = ไม่ใช่ชื่อเฉพาะ → ไม่แตะ (fail-safe ทิศ "ไม่ลบ")
 */

export const PLACE_PREFIX = '(จ\\.|อ\\.|ต\\.|ซ\\.|ถ\\.|จังหวัด|อำเภอ|ตำบล|ซอย|ถนน|โรงพยาบาล|สถานี|วัด|โรงเรียน|มหาวิทยาลัย|สนามบิน)';
export const PLACE_NAME_MAX = 15;
export const PLACE_REGEX_SOURCE = `${PLACE_PREFIX}\\s*([ก-๙a-zA-Z]{2,${PLACE_NAME_MAX}})(?=\\s|$|[,.)!?"'”’])`;

const TYPE_REPLACEMENT = {
  'จ.': 'ในพื้นที่', 'จังหวัด': 'ในพื้นที่', 'อ.': 'ในพื้นที่', 'อำเภอ': 'ในพื้นที่',
  'ต.': 'ในพื้นที่', 'ตำบล': 'ในพื้นที่', 'ซ.': 'ในซอย', 'ซอย': 'ในซอย', 'ถ.': 'บนถนน', 'ถนน': 'บนถนน',
  'โรงพยาบาล': 'โรงพยาบาล', 'สถานี': 'สถานี', 'วัด': 'วัด', 'โรงเรียน': 'โรงเรียน',
  'มหาวิทยาลัย': 'มหาวิทยาลัย', 'สนามบิน': 'สนามบิน',
};

/**
 * @param {string} content เนื้อที่จะล้าง
 * @param {string} sourceBody ต้นฉบับข่าว (ใช้ตัดสินว่าชื่อมีจริงไหม)
 * @param {(msg: string) => void} [log]
 * @returns {{ content: string, scrubbed: Array<{ place: string, replacement: string }> }}
 */
export function scrubHallucinatedPlaces(content, sourceBody, log = () => {}) {
  let out = String(content ?? '');
  const scrubbed = [];
  if (!sourceBody) return { content: out, scrubbed };

  const placeRegex = new RegExp(PLACE_REGEX_SOURCE, 'g');
  const places = new Map();
  let m;
  while ((m = placeRegex.exec(out)) !== null) {
    places.set(m[0].trim(), { prefix: m[1], name: m[2] });
  }
  const src = String(sourceBody).replace(/\s+/g, '');
  for (const [place, info] of places) {
    // ชื่อ ≥4 ตัวอักษรเท่านั้น (สั้นกว่านี้เสี่ยงจับคำทั่วไป) + ไม่อยู่ในต้นฉบับจริง
    if (info.name.length >= 4 && !src.includes(info.name)) {
      const replacement = TYPE_REPLACEMENT[info.prefix] || 'ในพื้นที่';
      log(`  L4.5 Hallucination Scrub: "${place}" -> "${replacement}" (รักษาชนิดสถานที่)`);
      out = out.split(place).join(replacement);
      scrubbed.push({ place, replacement });
    }
  }
  return { content: out, scrubbed };
}

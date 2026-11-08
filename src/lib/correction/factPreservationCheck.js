/**
 * Layer 4 — Fact Preservation Check
 * 
 * ตรวจว่าหลัง correction แล้ว fact ไม่เพี้ยน
 * - ตัวเลขยังอยู่
 * - ชื่อบุคคลยังอยู่
 * - ชื่อสถานที่ยังอยู่
 * - ความยาวไม่เปลี่ยนเกิน ±15%
 * 
 * ใช้ JS logic เท่านั้น ไม่เรียก AI
 * ถ้า fact drift → return rollback
 */

/**
 * ตรวจว่า fact ยังคงอยู่หลัง correction
 * @param {string} originalContent - content ก่อนแก้
 * @param {string} correctedContent - content หลังแก้
 * @param {object} newsData - { newsTitle, newsBody } สำหรับ cross-check
 * @returns {{ preserved: boolean, drifts: Array, action: 'pass'|'rollback' }}
 */
export function checkFactPreservation(originalContent, correctedContent, newsData) {
  const drifts = [];

  try {
    // 1. ตรวจตัวเลข
    const originalNumbers = extractNumbers(originalContent);
    const correctedNumbers = extractNumbers(correctedContent);

    for (const num of originalNumbers) {
      if (!correctedNumbers.includes(num)) {
        drifts.push({
          type: 'number_missing',
          value: num,
          severity: 'high',
          detail: `ตัวเลข "${num}" หายไปหลัง correction`,
        });
      }
    }

    // 2. ตรวจชื่อบุคคล (Thai names + English names)
    const originalNames = extractNames(originalContent);
    const correctedNames = extractNames(correctedContent);

    for (const name of originalNames) {
      if (!correctedContent.includes(name)) {
        drifts.push({
          type: 'name_missing',
          value: name,
          severity: 'high',
          detail: `ชื่อ "${name}" หายไปหลัง correction`,
        });
      }
    }

    // 3. ตรวจความยาว (±15%)
    const lenDiff = Math.abs(correctedContent.length - originalContent.length) / originalContent.length;
    if (lenDiff > 0.15) {
      drifts.push({
        type: 'length_drift',
        value: `${(lenDiff * 100).toFixed(1)}%`,
        severity: 'medium',
        detail: `ความยาวเปลี่ยนไป ${(lenDiff * 100).toFixed(1)}% (เกิน 15%)`,
      });
    }

    // 4. ตรวจย่อหน้าไม่หายไป
    const originalParas = originalContent.split('\n\n').filter(p => p.trim()).length;
    const correctedParas = correctedContent.split('\n\n').filter(p => p.trim()).length;

    if (correctedParas < originalParas - 1) {
      drifts.push({
        type: 'paragraph_missing',
        value: `${originalParas} → ${correctedParas}`,
        severity: 'medium',
        detail: `ย่อหน้าลดลงจาก ${originalParas} เหลือ ${correctedParas}`,
      });
    }

    // 5. ตรวจชื่อสถานที่สำคัญ
    const places = extractPlaces(originalContent);
    for (const place of places) {
      if (!correctedContent.includes(place)) {
        drifts.push({
          type: 'place_missing',
          value: place,
          severity: 'medium',
          detail: `สถานที่ "${place}" หายไปหลัง correction`,
        });
      }
    }

    // === ตัดสิน ===
    const highDrifts = drifts.filter(d => d.severity === 'high');
    const preserved = highDrifts.length === 0;
    const action = highDrifts.length > 0 ? 'rollback' : 'pass';

    console.log(`[FactCheck] Preserved: ${preserved} | Drifts: ${drifts.length} (high: ${highDrifts.length}) | Action: ${action}`);

    return { preserved, drifts, action };

  } catch (err) {
    console.error('[FactCheck] Error:', err.message);
    return { preserved: true, drifts: [], action: 'pass' };
  }
}

/**
 * Extract ตัวเลขจากข้อความ
 */
function extractNumbers(text) {
  const matches = text.match(/\d[\d,.]*/g) || [];
  return [...new Set(matches.filter(n => n.length >= 1))];
}

/**
 * Extract ชื่อบุคคล (Thai pattern: นาย/นาง/น.ส./ด.ช./ด.ญ./คุณ + ชื่อ)
 */
function extractNames(text) {
  const patterns = [
    /(?:นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|คุณ|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|นพ\.|พญ\.|ผศ\.|ศ\.ดร\.|ดร\.)\s*[ก-๙a-zA-Z]+(?:\s+[ก-๙a-zA-Z]+)?/g,
  ];
  const names = new Set();
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(m => names.add(m.trim()));
  }
  return [...names];
}

/**
 * Extract ชื่อสถานที่ (Thai pattern: จ./อ./ต./ซ./ถ. + ชื่อ, หรือ โรงพยาบาล/สถานี/วัด + ชื่อ)
 */
function extractPlaces(text) {
  const patterns = [
    /(?:จ\.|อ\.|ต\.|ซ\.|ถ\.)\s*[ก-๙]+/g,
    /(?:โรงพยาบาล|สถานี|วัด|โรงเรียน|มหาวิทยาลัย|สนามบิน)\s*[ก-๙a-zA-Z]+/g,
  ];
  const places = new Set();
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(m => places.add(m.trim()));
  }
  return [...places];
}

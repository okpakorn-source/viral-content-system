/**
 * Layer 5 — Editorial Polish
 * 
 * เกลาสุดท้าย:
 * - ลบ whitespace ซ้ำ
 * - ลบ emoji ซ้ำ
 * - ตรวจ spacing ย่อหน้า
 * - mobile readability
 * 
 * ใช้ JS logic เท่านั้น ไม่เรียก AI
 */

/**
 * เกลา content สุดท้าย
 * @param {string} content
 * @returns {{ polishedContent: string, changes: Array }}
 */
export function editorialPolish(content) {
  const changes = [];
  let polished = content;

  try {
    // 1. ลบ whitespace ซ้ำ (ยกเว้น newline)
    const before1 = polished;
    polished = polished.replace(/ {2,}/g, ' ');
    if (polished !== before1) changes.push('ลบ whitespace ซ้ำ');

    // 2. ลบ emoji ซ้ำติดกัน (🔥🔥🔥 → 🔥)
    const before2 = polished;
    polished = polished.replace(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])\1{2,}/gu, '$1');
    if (polished !== before2) changes.push('ลบ emoji ซ้ำ');

    // 3. ตรวจว่ามี \n\n คั่นย่อหน้า (ไม่ใช่แค่ \n เดี่ยว)
    const before3 = polished;
    // แต่ไม่แปลง \n เดี่ยวทั้งหมด — เฉพาะที่เป็นย่อหน้ายาวๆ ติดกัน
    polished = polished.replace(/([^\n])\n([^\n])/g, (match, p1, p2) => {
      // ถ้าบรรทัดก่อนหน้ายาวกว่า 40 chars และบรรทัดถัดไปก็ยาว → น่าจะเป็นย่อหน้าใหม่
      return match; // ไม่แก้ — เสี่ยงพังโครงสร้าง
    });

    // 4. ลบ trailing spaces
    const before4 = polished;
    polished = polished.replace(/[ \t]+$/gm, '');
    if (polished !== before4) changes.push('ลบ trailing spaces');

    // 5. ลบ newline เกิน 3 ตัว → แค่ 2
    const before5 = polished;
    polished = polished.replace(/\n{3,}/g, '\n\n');
    if (polished !== before5) changes.push('ลด newlines ซ้ำ');

    // 6. ลบ hashtag เกิน 5 ตัว
    const hashtags = polished.match(/#[ก-๙a-zA-Z\w]+/g) || [];
    if (hashtags.length > 5) {
      const excessCount = hashtags.length - 5;
      // ลบ hashtag ท้ายๆ ออก
      for (let i = hashtags.length - 1; i >= 5; i--) {
        polished = polished.replace(hashtags[i], '');
      }
      polished = polished.replace(/  +/g, ' ').trim();
      changes.push(`ลด hashtag จาก ${hashtags.length} เหลือ 5`);
    }

    // 7. Trim
    const before7 = polished;
    polished = polished.trim();
    if (polished !== before7) changes.push('trim');

    console.log(`[EditorialPolish] ${changes.length} changes: ${changes.join(', ') || 'none'}`);

    return { polishedContent: polished, changes };

  } catch (err) {
    console.error('[EditorialPolish] Error:', err.message);
    return { polishedContent: content, changes: [] };
  }
}

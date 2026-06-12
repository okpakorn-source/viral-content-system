/**
 * Content Screen — ด่านคัดกรองกลาง 6 เกณฑ์ (12 มิ.ย. 69 — มาตรฐานทีม)
 * ─────────────────────────────────────────────────────────────
 * ใช้คัด: เนื้อหาก่อนเข้าหอสมุดไวรัล + พร้อมท์ที่ระบบสร้างก่อนบันทึก
 * มาตรฐานที่ผ่าน: อ่านลื่น แง่บวก กระชับ สำนวนมีลูกเล่นแต่เข้าใจง่าย
 *                คนอ่านมีอิสรภาพทางความคิด ไม่ถูกลากเวลา
 * ตก 6 ข่าย: slow (ยืดเยื้อเกริ่นยาว) / overdrama (กระชากอารมณ์ขึ้นสุดลงสุด) /
 *           toxic (เหน็บสถานะ-โจมตี-ทำให้เสียหาย) / manipulate (ชี้นำบงการคนอ่าน) /
 *           padding (ท้ายอวยยืดไร้ใจความ) / forced_emotion (เปิดบังคับเศร้า/ลุ้นเกิน)
 * fail-safe: AI ล่ม → ผ่านแบบติดธง needsReview (ไม่บล็อกงานทีม)
 */
import { callAI } from '@/lib/ai/openai';

export const SCREEN_CRITERIA_TEXT = `มาตรฐานที่ผ่าน (clean): อ่านลื่น แง่บวก กระชับ สำนวนมีลูกเล่นแต่เข้าใจง่าย ไม่ลากเวลาคนอ่าน คนอ่านมีอิสรภาพทางความคิด
(ตัวอย่างแนวถูก: "เจอชมพู่ทานก๋วยเตี๋ยวข้างทาง นั่งโต๊ะใกล้กัน นิสัยดีมาก เป็นกันเองสุดๆ" = อวยตรงๆ ธรรมชาติ)

ตกถ้าเข้าข่าย (เลือกข่ายหนักสุด):
- "slow" ยืดเยื้อ เกริ่นยาว กว่าจะเข้าเรื่อง
- "overdrama" กระชากอารมณ์คนอ่านขึ้นสุดลงสุด ดราม่าหนักสลับซึ้ง
- "toxic" เหน็บ/ย้อนแย้งสถานะ ("แม้รวยหมื่นล้านแต่ยังกินข้างทาง") / โจมตี / ทำให้ใครเสียหาย / ชวนทัวร์ลง
- "manipulate" ชี้นำบงการคนอ่าน ("ลองนึกภาพถ้าคุณเป็นเขา" "ถ้าเป็นคุณจะทำยังไง" สั่งให้คนอ่านรู้สึก/คิดตาม)
- "padding" เนื้อจบแล้วแต่ท้ายยังอวยต่อยาวๆ ไร้ใจความ
- "forced_emotion" เปิดบังคับเศร้า/ลุ้นระทึกเกินจริง`;

/**
 * คัดกรองข้อความ 1 ชิ้น
 * @param {string} text - เนื้อหาหรือพร้อมท์ที่จะคัด
 * @param {string} kind - 'content' (โพสต์ไวรัล) | 'prompt' (คำสั่งเขียน)
 * @returns {{ pass: boolean, verdict: string, why: string, offending: string, needsReview?: boolean }}
 */
export async function screenContent(text, kind = 'content') {
  const subject = kind === 'prompt'
    ? 'พร้อมท์คำสั่งเขียนข่าว (ดูว่ามันจะ "สอน" ให้นักเขียนทำผิดเกณฑ์ไหม)'
    : 'โพสต์/เนื้อหาไวรัลที่จะเก็บเป็นแม่พิมพ์ของเพจ';
  try {
    const raw = await callAI({
      model: 'gpt-5.5',
      temperature: 0.1,
      maxTokens: 1200,
      prompt: `คุณคือ บก.คัดกรองของเพจข่าวไวรัลไทย ตรวจ${subject}

${SCREEN_CRITERIA_TEXT}

=== สิ่งที่ต้องตรวจ ===
${String(text).slice(0, 4000)}
=== จบ ===

ตอบ JSON เท่านั้น: {"verdict":"clean|slow|overdrama|toxic|manipulate|padding|forced_emotion","why":"เหตุผลสั้นๆ","offending":"วลีที่เป็นปัญหา (ถ้ามี)"}`,
    });
    const parsed = typeof raw === 'object' ? raw : JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const verdict = String(parsed.verdict || 'clean');
    return {
      pass: verdict === 'clean',
      verdict,
      why: String(parsed.why || '').slice(0, 200),
      offending: String(parsed.offending || '').slice(0, 150),
    };
  } catch (e) {
    // AI ล่ม → ปล่อยผ่านแบบติดธง ไม่บล็อกงานทีม (ไปคัดมือทีหลังได้)
    console.warn('[ContentScreen] ล่ม — ปล่อยผ่านติดธง:', e.message?.slice(0, 50));
    return { pass: true, verdict: 'clean', why: 'ตรวจอัตโนมัติไม่สำเร็จ — ควรตรวจมือ', offending: '', needsReview: true };
  }
}

export const VERDICT_LABELS = {
  slow: 'ยืดเยื้อ เกริ่นยาว',
  overdrama: 'กระชากอารมณ์เกิน',
  toxic: 'เหน็บ/โจมตี/ท็อกซิก',
  manipulate: 'ชี้นำบงการคนอ่าน',
  padding: 'ท้ายอวยยืดไร้ใจความ',
  forced_emotion: 'บังคับอารมณ์',
};

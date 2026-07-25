/**
 * Viral Polish — บก.ขัดเงาขั้นสุดท้าย (12 มิ.ย. 69 — ลูปคุณภาพรอบ 4)
 * ─────────────────────────────────────────────────────────────
 * ปัญหาที่ชั้นนี้แก้: ระบบมีแต่ชั้น "ซ่อมที่พัง" (audit/correct/scrub/flagfix)
 * ไม่มีชั้น "ขัดให้เงา" — คะแนนเทียบหอสมุดไวรัลเลยตันที่ ~6/10 (ดี แต่ไม่ถึง "พร้อมโพสต์ไม่แก้สักคำ")
 *
 * วิธี: เกลาทีละเวอร์ชันด้วย gpt-5.5 โดยมีตัวอย่างไวรัลจริงหมวดเดียวกันวางข้างๆ
 * โจทย์: เสียงแอดมินเพจ + กระชับลง + จังหวะโพสต์เฟซบุ๊ก — ห้ามแตะข้อเท็จจริง
 * ด่านรับผลแก้ (บทเรียนจาก FlagFixer leak): JSON เท่านั้น + ความยาวสมเหตุผล +
 * คำสั่งห้ามรั่ว + ตัวเลขจากต้นฉบับต้องอยู่ครบ — ไม่ผ่านด่านไหน = ใช้ของเดิม
 */

import { callAI } from '@/lib/ai/openai';

const MODEL_POLISH = 'gpt-5.5'; // ขัดเงา = งานภาษาละเอียด ใช้ตัวเก่งสุด

function numbersIn(text) {
  return [...new Set((String(text).match(/\d[\d,]{1,}/g) || []).map(n => n.replace(/,/g, '')))];
}

export async function viralPolish(versions, newsData, breakdownData) {
  if (!versions?.length) return { versions, polished: 0 };

  // ตัวอย่างไวรัลจริงหมวดเดียวกัน (ใช้ block เดียวกับที่ writer เห็น — เสียงเดียวกันทั้งไลน์)
  let examples = '';
  try {
    const { getViralFewshotBlock } = await import('@/lib/services/viralFewshot');
    examples = await getViralFewshotBlock({
      category: breakdownData?.primaryCategory || '',
      emotionalTags: breakdownData?.emotionalTags || [],
      archetype: breakdownData?.narrativeArchetype || '',
    });
  } catch { /* ไม่มีตัวอย่าง = เกลาด้วยกฎอย่างเดียว */ }

  const tasks = versions.map(async (v, i) => {
    const content = String(v.content || '');
    if (content.length < 200) return v;
    try {
      const result = await callAI({
        model: MODEL_POLISH,
        temperature: 0.4,
        maxTokens: 4000,
        prompt: `คุณคือ บก.ขัดเงาคนสุดท้ายของเพจข่าวไวรัลไทย — งานเขียนชิ้นนี้ "ผ่านแล้ว" แค่ต้องขัดให้ถึงระดับโพสต์ 9,000 แชร์

${examples}
=== งานที่ต้องขัด ===
${content}
=== จบ ===

ขัดตามนี้เท่านั้น:
1. เสียง = แอดมินเพจเล่าให้แฟนเพจฟัง อบอุ่นจริงใจ (ดูตัวอย่างข้างบน) — ไม่ใช่นักข่าว/นิยาย
2. ★ ต้องสั้นลงจริง 10-25% (ห้ามยาวขึ้นเด็ดขาด): ตัดประโยคน้ำ/ซ้ำความ/พรรณนาเกิน — ทุกประโยคที่เหลือต้องทำงาน
3. จังหวะโพสต์เฟซบุ๊ก: บรรทัดสั้นสลับยาว ประโยคทุบอยู่บรรทัดของมันเอง
4. ★ ห้ามเด็ดขาด: เปลี่ยน/เพิ่ม/ลดข้อเท็จจริง ตัวเลข ชื่อคน คำพูดในเครื่องหมายคำพูด — ทุกอย่างต้องตรงต้นฉบับ
5. ★ ห้ามเพิ่มดราม่า/อารมณ์ที่ต้นฉบับไม่มี — ถ้าลังเลระหว่างสองสำนวน เลือกอันที่เรียบและจริงใจกว่าเสมอ (บทเรียน: ฉบับที่บิ้วเกินแพ้ฉบับเรียบในการเทียบตาบอด)
6. ถ้าเรื่องเป็นบวก/สู้ชีวิต ปิดท้ายส่งกำลังใจสั้นๆ ได้ 1 ประโยค

ตอบ JSON เท่านั้น: {"fixedContent":"งานฉบับขัดเงาแล้วทั้งหมด"}`,
      });
      const polished = String((typeof result === 'object' ? result?.fixedContent : result) || '').trim();
      // ── ด่านรับผล: ยาวสมเหตุผล + ไม่มีคำสั่งรั่ว + ตัวเลขต้นฉบับอยู่ครบ ──
      const okLength = polished.length > content.length * 0.55 && polished.length <= content.length * 1.0; // ★ ห้ามยาวขึ้น (ฉบับยาวขึ้นแพ้เทียบตาบอด)
      const noLeak = !/^(เปิดด้วย|มุม(มอง)?\s*[:：]|แนวเปิด|สไตล์เปิด|ขัดตาม|เสียง\s*=)/.test(polished);
      const srcNums = numbersIn(content);
      const numsKept = srcNums.every(n => polished.replace(/,/g, '').includes(n));
      if (polished && okLength && noLeak && numsKept) {
        console.log(`  L6 ViralPolish: ✨ V${i + 1} ขัดแล้ว (${content.length}→${polished.length}ch)`);
        return { ...v, content: polished, _viralPolished: true };
      }
      console.log(`  L6 ViralPolish: ⏭️ V${i + 1} ผลขัดไม่ผ่านด่าน (len:${okLength} leak:${!noLeak} nums:${numsKept}) — ใช้ของเดิม`);
      return v;
    } catch (e) {
      console.log(`  L6 ViralPolish: ⏭️ V${i + 1} ขัดไม่สำเร็จ (${e.message?.slice(0, 40)}) — ใช้ของเดิม`);
      return v;
    }
  });

  const settled = await Promise.allSettled(tasks);
  const out = settled.map((r, i) => (r.status === 'fulfilled' ? r.value : versions[i]));
  return { versions: out, polished: out.filter(v => v._viralPolished).length };
}

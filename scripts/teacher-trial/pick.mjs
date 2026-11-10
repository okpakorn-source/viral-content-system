// ขั้น 2.5 ของชุดทดลอง: "บรรณารักษ์" เลือกครูให้แต่ละข่าว
//   โค้ดคัดผู้เข้ารอบ (คะแนนหมวด/อารมณ์ + ตัดครูที่ใช้กับข่าวนี้ไม่ได้ + ตัดใบที่เพิ่งใช้) → AI อ่านเนื้อข่าวกับรายชื่อ แล้วจัดลำดับครูที่ "รูปเรื่องเดียวกัน"
//   → โค้ดหยิบ 3 ใบตามลำดับ โดยให้วิธีเปิดเรื่องไม่ซ้ำกันก่อน
// เหตุที่ต้องมีขั้นนี้ (ผลรอบนำร่อง 10 พ.ย. 69): จับคู่ด้วยหมวดอย่างเดียวหยาบเกิน — ข่าวคนดังขยายธุรกิจได้ครูเรื่อง "รับร่างผู้จากไปกลับบ้าน" เพราะอยู่หมวดอบอุ่นใจเหมือนกัน
// รัน: node scripts/teacher-trial/pick.mjs        ผล: scratch/teacher-trial/picks.json
import OpenAI from 'openai';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, outPath, readJson, writeJson, loadEnvKeys } from './common.mjs';
import { loadTeacherLibrary, shortlistTeachers, chooseRankedTeachers, pickTeachers } from '../../src/lib/services/teacherLibrary.js';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      let p = path.join(ROOT, 'src', specifier.slice(2));
      if (!path.extname(p)) p += '.js';
      return nextResolve(pathToFileURL(p).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { scoreLibraryPrompts } = await import('../../src/lib/services/promptMatcher.js');

loadEnvKeys(['OPENAI_API_KEY']);
const MODEL = process.env.TEACHER_TRIAL_PICKER_MODEL || 'gpt-5.4-mini';
const SHORTLIST = parseInt(process.env.TEACHER_TRIAL_SHORTLIST || '60', 10);
const client = new OpenAI();

export const librarianPrompt = (rawText, shortlist) => `คุณเป็นบรรณารักษ์ของเพจข่าว หน้าที่คือเลือก "โพสต์ต้นแบบ" ให้นักเขียนใช้เลียนวิธีเขียน สำหรับข่าว 1 ข่าว

=== เนื้อข่าว ===
${rawText}
=== จบเนื้อข่าว ===

=== โพสต์ต้นแบบที่เลือกได้ (รหัส | แนวเรื่องและวิธีเขียน | ประโยคเปิดจริงของโพสต์) ===
${shortlist.map((t) => `${t.id} | ${t.name} | ${t.post.split('\n')[0].slice(0, 110)}`).join('\n')}
=== จบรายการ ===

เลือก 6 โพสต์ที่ "รูปเรื่อง" ใกล้กับข่าวนี้ที่สุด เรียงจากเหมาะที่สุดไปน้อยกว่า โดยดู:
1. คนในเรื่องและสถานการณ์เป็นแบบเดียวกันไหม (เช่น คนดังทำธุรกิจ / ลูกดูแลพ่อแม่ / คนธรรมดาช่วยคนแปลกหน้า / การสูญเสีย / ความสำเร็จหลังลำบาก)
2. น้ำหนักอารมณ์ของเรื่องตรงกันไหม ห้ามเลือกต้นแบบเรื่องการสูญเสียหรือไว้อาลัยให้ข่าวที่ไม่มีการสูญเสีย และห้ามเลือกต้นแบบเรื่องสนุกสดใสให้ข่าวการสูญเสีย
3. วิธีเขียนของต้นแบบใช้กับวัตถุดิบของข่าวนี้ได้จริงไหม (ต้นแบบที่เปิดด้วยตัวเลขต้องมีตัวเลขเด่นในข่าว ต้นแบบที่เล่าการกระทำเป็นขั้นๆ ต้องมีลำดับการกระทำในข่าว)
4. ใน 6 โพสต์ ให้มีวิธีเปิดเรื่องต่างกันอย่างน้อย 3 แบบ

ตอบเป็น JSON เท่านั้น:
{"picks": [{"id": "รหัสโพสต์", "reason": "เหตุผลสั้นๆ ว่ารูปเรื่องตรงกันตรงไหน"}]}`;

const teachers = loadTeacherLibrary();
const analyses = readJson(outPath('analyses.json'));
const cases = readJson(outPath('cases.json')).filter((c) => analyses[c.caseId]);
const picks = {};
const recent = [];
const seededRand = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

// ทีละข่าวตามลำดับ — ต้องรู้ว่าข่าวก่อนหน้าใช้ครูใบไหนไปแล้ว (เลี่ยง 30 ใบล่าสุด)
for (const c of cases) {
  const scored = scoreLibraryPrompts(analyses[c.caseId], teachers, { mismatchPenalty: false });
  const shortlist = shortlistTeachers({ teachers, scored, rawText: c.rawText, size: SHORTLIST, avoidIds: recent });
  let ranked = [];
  let source = 'librarian';
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: librarianPrompt(c.rawText, shortlist) }],
      max_completion_tokens: 1500,
      response_format: { type: 'json_object' },
    });
    ranked = (JSON.parse(res.choices[0]?.message?.content || '{}').picks || []).filter((p) => p && p.id);
  } catch (e) {
    console.error(`#${c.caseId} บรรณารักษ์ล้ม: ${e?.status || ''} ${String(e?.message || e).slice(0, 120)}`);
  }
  let chosen = chooseRankedTeachers({ shortlist, rankedIds: ranked.map((p) => p.id), count: 3 });
  if (chosen.length < 3) {
    // ทางสำรอง: บรรณารักษ์ล้ม/ตอบไม่ครบ → เติมด้วยตัวเลือกแบบโค้ดล้วน (ไม่ทิ้งเวอร์ชัน)
    source = chosen.length ? 'librarian+code' : 'code';
    const fill = pickTeachers({ teachers, scored, count: 3, rand: seededRand(Number(c.caseId) || 1), avoidIds: [...recent, ...chosen.map((t) => t.id)] });
    for (const t of fill) if (chosen.length < 3 && !chosen.some((x) => x.id === t.id)) chosen.push(t);
  }
  for (const t of chosen) { recent.push(t.id); if (recent.length > 30) recent.shift(); }
  picks[c.caseId] = {
    source,
    shortlistSize: shortlist.length,
    ranked,
    chosen: chosen.map((t) => t.id),
  };
  console.log(`#${c.caseId} [${analyses[c.caseId].primaryCategory}] ${String(c.newsTitle || '').slice(0, 44)}`);
  for (const t of chosen) {
    const why = ranked.find((p) => p.id === t.id)?.reason || '(ทางสำรอง)';
    console.log(`   → ${t.name.slice(0, 70)} (${t.openingType}) — ${why.slice(0, 90)}`);
  }
}
writeJson(outPath('picks.json'), picks);
const used = Object.values(picks).flatMap((p) => p.chosen);
console.log(`\nเลือกครูให้ ${Object.keys(picks).length} ข่าว · ใช้ครูไม่ซ้ำ ${new Set(used).size}/${used.length} · ทางสำรอง ${Object.values(picks).filter((p) => p.source !== 'librarian').length} ข่าว`);

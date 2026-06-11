/**
 * Quality Loop — ลูปตรวจคุณภาพข่าวเทียบหอสมุดไวรัล (12 มิ.ย. 69)
 * ─────────────────────────────────────────────────────────────
 * ใช้: node scripts/quality-loop.mjs [minCaseId]
 * ① ดึงเคสใหม่จาก generation_logs (ตั้งแต่ minCaseId, default 00192)
 * ② จับคู่ตัวอย่างไวรัลจริงหมวดใกล้กันจากหอสมุด (viral_examples)
 * ③ gpt-5.5 ตัดสินแบบ บก.เข้มงวด: คะแนน + ข้อดี + ข้อเสีย + ต้องปรับ
 *    เช็คเฉพาะจุดตามคำสั่งทีม: คำงง/คำเพี้ยน/คำผิด, เปิดประเด็นซ้ำ, พาดหัวซ้ำ,
 *    คำถามซ้ำๆ, พรรณนาเวอร์เกิน, เทียบมาตรฐานไวรัลจริง
 * ④ เช็คข้ามเคส (โปรแกรม): เปิดเรื่องซ้ำ pattern กันทั้งคลังไหม
 * ⑤ สรุปปัญหาที่เกิดซ้ำ → รายการสิ่งที่ต้องปรับใน prompt
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const minCase = process.argv[2] || '00192';

// หมวดโต๊ะข่าว → หมวดหอสมุดไวรัลที่ใกล้กัน
const CAT_MAP = {
  'น้ำใจ/ช่วยเหลือ': ['ช่วยเหลือกัน', 'ข่าวชาวบ้าน', 'ข่าวเตือนใจ'],
  'กตัญญู/ครอบครัวอบอุ่น': ['ช่วยเหลือกัน', 'สู้ชีวิต', 'ดราม่าครอบครัว'],
  'สู้ชีวิต': ['สู้ชีวิต', 'พลิกชีวิต'],
  'คนดังทำดี/ติดดิน': ['ข่าวบันเทิง', 'ช่วยเหลือกัน'],
  'บันเทิงกระแส': ['ข่าวบันเทิง'],
  'ดราม่าสังคม': ['ดราม่าครอบครัว', 'moral conflict'],
  'เตือนภัย/อุทาหรณ์': ['ข่าวเตือนใจ'],
};

async function gpt(prompt, maxTokens = 6000) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.5', max_completion_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await res.json();
  if (!j.choices?.[0]?.message?.content) throw new Error('AI ตอบว่าง: ' + JSON.stringify(j.error || {}).slice(0, 120));
  const m = j.choices[0].message.content.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

(async () => {
  // ① เคสใหม่
  const { data: cases } = await sb.from('generation_logs')
    .select('case_id, news_title, versions, pipeline_info, source_text')
    .gte('case_id', minCase).order('case_id');
  if (!cases?.length) { console.log('ยังไม่มีเคสตั้งแต่ #' + minCase); process.exit(0); }

  // ② หอสมุดไวรัล
  const { data: lib } = await sb.from('viral_examples').select('category, title, content, engagement_shares');

  const report = { perCase: [], crossCase: {}, at: new Date().toISOString() };

  // ④ เช็คข้ามเคสแบบโปรแกรม: เปิดเรื่อง/พาดหัวซ้ำ pattern
  const allOpenings = [];
  for (const c of cases) (c.versions || []).forEach((v, i) => allOpenings.push({ id: c.case_id + ' V' + (i + 1), open: String(v.content || '').slice(0, 45).replace(/\s+/g, '') }));
  const dupOpen = [];
  for (let i = 0; i < allOpenings.length; i++)
    for (let j = i + 1; j < allOpenings.length; j++)
      if (allOpenings[i].open.slice(0, 25) === allOpenings[j].open.slice(0, 25)) dupOpen.push(allOpenings[i].id + ' = ' + allOpenings[j].id);
  report.crossCase.duplicateOpenings = dupOpen;

  // ③ ตัดสินรายเคส
  for (const c of cases) {
    const cat = c.pipeline_info?.desk?.category || '';
    const libCats = CAT_MAP[cat] || ['ช่วยเหลือกัน', 'สู้ชีวิต'];
    const examples = (lib || [])
      .filter(e => libCats.includes(e.category))
      .sort((a, b) => (b.engagement_shares || 0) - (a.engagement_shares || 0))
      .slice(0, 2);
    const exText = examples.map((e, i) => `── ตัวอย่างไวรัลจริง ${i + 1} (${e.category}, ${e.engagement_shares || '?'} แชร์) ──\n${String(e.content).slice(0, 1200)}`).join('\n\n');
    const vText = (c.versions || []).map((v, i) => `── เวอร์ชัน ${i + 1} ──\n${String(v.content || '').slice(0, 1500)}`).join('\n\n');

    try {
      const r = await gpt(`คุณคือ บก.ตรวจคุณภาพที่เข้มงวดที่สุดของเพจข่าวไวรัลไทย เทียบงานเขียนของทีมกับตัวอย่างไวรัลจริงที่เคยปังของเพจ

${exText}

=== งานเขียนของทีม (ข่าว: ${String(c.news_title).slice(0, 80)}) ===
${vText}

ตรวจเข้มเฉพาะจุดเหล่านี้ (คำสั่งหัวหน้าทีม):
1. คำงง/คำเพี้ยน/คำผิด/ประโยคอ่านไม่รู้เรื่อง — ยกตัวอย่างประโยคจริงถ้าเจอ
2. เวอร์ชันเปิดประเด็น/พาดหัวซ้ำกันเองไหม (รวมถึง "ภาพ/มุมเดียวกันแม้คำต่างกัน")
3. ตั้งคำถามหรือใช้คำเดิมซ้ำๆ จำเจไหม
4. พรรณนาเวอร์เกินจริง/ดราม่าเกินเนื้อ (เทียบกับตัวอย่างจริงที่เล่าแบบธรรมชาติ)
5. เทียบกับตัวอย่างไวรัลจริง: ขาดอะไรที่ตัวอย่างมี (เช่น จังหวะเล่า รายละเอียดเจาะใจ ความ "คนเล่าให้ฟัง")
6. ★ กระชับไหม — ยาวเกินจำเป็น/น้ำเยอะ = หัก | ★ โทนบวก นำเสนอด้านดี ไม่ toxic ไม่เสี้ยมดราม่า = มาตรฐานเพจ
7. คะแนน 9-10 = คุณภาพเทียบเท่าหรือดีกว่าตัวอย่างไวรัลจริง พร้อมโพสต์โดยไม่ต้องแก้สักคำ — ให้คะแนนแบบเข้มงวดจริง อย่าใจดี

ตอบ JSON เท่านั้น:
{"score": 0-10, "verdict": "สั้นๆ ผ่าน/ต้องแก้",
"pros": ["ข้อดี 1-3 ข้อ"],
"cons": ["ข้อเสียพร้อมตัวอย่างประโยคจริง 0-4 ข้อ"],
"vsLibrary": "ต่างจากตัวอย่างไวรัลจริงยังไง 1-2 ประโยค",
"mustFix": ["สิ่งที่ต้องปรับใน prompt/ระบบ 0-3 ข้อ"]}`, 6000);
      report.perCase.push({ caseId: c.case_id, title: String(c.news_title).slice(0, 60), category: cat, ...r });
      console.log(`#${c.case_id} [${r.score}/10] ${r.verdict} | ${String(c.news_title).slice(0, 40)}`);
      (r.cons || []).forEach(x => console.log('   ❌', String(x).slice(0, 110)));
    } catch (e) {
      console.log(`#${c.case_id} ตัดสินไม่สำเร็จ: ${e.message.slice(0, 80)}`);
    }
  }

  // ⑤ สรุปปัญหาซ้ำ
  if (dupOpen.length) console.log('\n⚠️ เปิดเรื่องซ้ำข้ามเคส/เวอร์ชัน:', dupOpen.join(' | '));
  const allFix = report.perCase.flatMap(p => p.mustFix || []);
  console.log('\n=== สิ่งที่ระบบควรปรับ (รวมทุกเคส) ===');
  allFix.forEach(f => console.log('•', f));
  const avg = report.perCase.length ? (report.perCase.reduce((s, p) => s + (p.score || 0), 0) / report.perCase.length).toFixed(1) : '-';
  console.log(`\nคะแนนเฉลี่ย: ${avg}/10 จาก ${report.perCase.length} เคส`);
  fs.writeFileSync('quality-report.json', JSON.stringify(report, null, 1));
  console.log('บันทึก quality-report.json แล้ว');
})();

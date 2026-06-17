/**
 * ★ หาข้อมูลเสริมตามแกนมุม (17 มิ.ย. 69) — เฉพาะ "คนดัง" ที่ค้นข้อมูลได้
 *   หลังเลือกแกนมุมแล้ว → ค้น Google (Serper) ตามคีย์ที่ตรงแกน → คัดข้อเท็จจริงที่ "มีแหล่งยืนยัน"
 *   + สร้าง "ข้อมูลเทียบเคียงเชิงภาพรวมที่จริง/รู้กันกว้าง" เป็นสำรองเมื่อไม่มีตัวเลขเป๊ะ
 *   ⛔ บนความจริงเท่านั้น: ตัวเลขเฉพาะต้องมีแหล่ง · เทียบเคียงห้ามมีตัวเลขเจาะจง · แง่บวกล้วน ไม่ทำใครเสียหาย
 *   ★ กดเองผ่านปุ่ม (คุมค่า Serper/OpenAI) · graceful fallback: ค้นไม่ได้ → เนื้อหาดิบเดิมใช้ได้ปกติ
 *   ★ แยกจากระบบทำข่าวอัตโนมัติ 100%
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST, MODEL_PRIMARY } from '@/lib/ai/modelConfig';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

async function serperSearch(query, num = 4) {
  if (!SERPER_API_KEY) return [];
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.organic || []).slice(0, num).map(r => ({ title: r.title || '', snippet: r.snippet || '', link: r.link || '' }));
  } catch { return []; }
}

const HAS_SPECIFIC_NUMBER = /\d/;            // มีตัวเลขใดๆ = ข้อเท็จจริงเฉพาะ ต้องมีแหล่ง
const HAS_HARD_NUMBER = /\d{2,}|ล้าน|แสน|พัน|หมื่น|เปอร์เซ็น|%/; // เทียบเคียงห้ามมีตัวเลขเจาะจง

/**
 * @param {object} a  { personHint, sourceTitle, sourceSnippet, angleType, angleFocus }
 * @returns {{ok, person?, facts?, comparables?, sources?, at?, reason?}}
 */
export async function enrichCelebAngle(a) {
  if (!SERPER_API_KEY) return { ok: false, reason: 'ยังไม่ได้ตั้งค่าเครื่องค้น (SERPER_API_KEY) — เพิ่ม key ก่อนใช้ได้' };

  // 1) ระบุบุคคลคนดัง + ตั้งคีย์ค้นตามแกน
  const qPrompt = `ข่าวกำลังจะเล่นแกนมุม "${a.angleType}" (โฟกัส: ${a.angleFocus || '-'})
หัวข้อข่าว: ${a.sourceTitle}
${a.sourceSnippet ? 'เนื้อ: ' + String(a.sourceSnippet).slice(0, 300) : ''}

หา "บุคคลคนดังหลัก" ในข่าวนี้ แล้วตั้งคีย์ค้น Google 3-4 คีย์ (ภาษาไทย) ที่จะได้ "ข้อมูลเสริมตรงแกนนี้":
- แกนความสำเร็จ/รวย → คีย์เรื่อง รายได้/ค่าตัว/ผลงานเด่น/บริษัทธุรกิจ
- แกนทำดี/น้ำใจ → คีย์เรื่อง บริจาค/ช่วยเหลือ/การกุศล
- แกนสู้ชีวิต → คีย์เรื่อง จุดเริ่มต้น/ชีวิตก่อนดัง
ถ้าไม่ใช่ "บุคคลคนดังที่ค้นข้อมูลสาธารณะได้จริง" (เช่น คนทั่วไป/ร้านค้า/ไม่มีชื่อชัด) ให้ celeb=false
ตอบ JSON: {"celeb":true/false,"person":"ชื่อบุคคล","queries":["...","..."]}`;
  let person = a.personHint || '', queries = [];
  try {
    const r = await callAI({ prompt: qPrompt, model: MODEL_FAST, temperature: 0.2, maxTokens: 300 });
    const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (p.celeb === false) return { ok: false, reason: 'ไม่ใช่บุคคลคนดังที่ค้นข้อมูลได้ — ข้ามการหาข้อมูลเสริม (ใช้เนื้อหาดิบเดิมได้เลย)' };
    person = String(p.person || person).slice(0, 60);
    queries = (p.queries || []).slice(0, 4).map(q => String(q).slice(0, 80)).filter(Boolean);
  } catch {}
  if (!queries.length && person) queries = [`${person} ผลงาน ความสำเร็จ`];
  if (!queries.length) return { ok: false, reason: 'ตั้งคีย์ค้นไม่ได้ (ข้อมูลข่าวน้อยเกินไป)' };

  // 2) ค้น Serper ขนาน + รวม/กันซ้ำ
  const found = (await Promise.all(queries.map(q => serperSearch(q, 4)))).flat();
  const uniq = [...new Map(found.filter(r => r.link).map(r => [r.link, r])).values()].slice(0, 10);
  if (!uniq.length) return { ok: false, reason: 'ค้นไม่พบข้อมูลสาธารณะของบุคคลนี้ (ใช้เนื้อหาดิบเดิมได้เลย)' };

  // 3) คัดข้อเท็จจริงที่มีแหล่ง + สร้างเทียบเคียงเชิงภาพรวม (ปลอดภัยสุด)
  const srcList = uniq.map((r, i) => `[${i + 1}] ${r.title} — ${r.snippet} (${r.link})`).join('\n');
  const exPrompt = `บุคคล: ${person} · แกนที่จะเล่น: ${a.angleType} (${a.angleFocus || '-'})
ผลค้นจากเว็บ (ใช้เป็นแหล่งยืนยันเท่านั้น):
${srcList}

ดึง "ข้อมูลเสริม" หนุนแกนนี้ + สร้าง "ข้อมูลเทียบเคียง" สำรอง — ตามกฎเหล็กนี้:
1. "facts" = ข้อเท็จจริงเฉพาะ (ตัวเลข/ชื่อผลงาน/รางวัล/ธุรกิจ) — ใส่ได้ "เฉพาะที่มีในผลค้นข้างบน" พร้อมระบุ src=เลขแหล่ง [n] ที่ยืนยัน ⛔ ห้ามแต่งตัวเลข/ข้อมูลที่ไม่มีในแหล่ง
2. "comparables" = ข้อเท็จจริงเทียบเคียง "เชิงภาพรวมที่เป็นจริงและรู้กันกว้าง" (เช่น "เป็นพิธีกรรายการข่าวยอดนิยม มีงานต่อเนื่อง หลายแบรนด์สนใจ") ⛔ ห้ามมีตัวเลขเจาะจง ห้ามแต่ง ห้ามคาดเดาเกินจริง — เอาเฉพาะที่คนทั่วไปรู้และเป็นจริงแน่ๆ
3. ทุกอย่าง "แง่บวกล้วน" ไม่ทำให้ใครเสียหาย ไม่มีด้านลบ
4. ถ้าผลค้นไม่มีข้อมูลที่ใช้ได้ → facts=[] ได้ (อย่าฝืนแต่ง)
ตอบ JSON: {"facts":[{"text":"...","src":1}],"comparables":["...","..."]}`;
  let facts = [], comparables = [];
  try {
    const r = await callAI({ prompt: exPrompt, model: MODEL_PRIMARY, temperature: 0.3, maxTokens: 800 });
    const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
    facts = (p.facts || [])
      .map(f => ({ text: String(f.text || '').slice(0, 220), sourceUrl: uniq[(Number(f.src) || 0) - 1]?.link || '' }))
      // ⛔ ความปลอดภัย: ข้อเท็จจริงที่มีตัวเลข ต้องมีแหล่งยืนยัน ไม่งั้นทิ้ง (กันแต่งตัวเลข)
      .filter(f => f.text && (!HAS_SPECIFIC_NUMBER.test(f.text) || f.sourceUrl))
      .slice(0, 6);
    comparables = (p.comparables || [])
      .map(c => String(c).slice(0, 200))
      // ⛔ ความปลอดภัย: เทียบเคียงต้องไม่มีตัวเลขเจาะจง (คงความเป็นภาพรวม)
      .filter(c => c && !HAS_HARD_NUMBER.test(c))
      .slice(0, 5);
  } catch {}

  if (!facts.length && !comparables.length) return { ok: false, reason: 'ค้นเจอแต่ไม่มีข้อมูลที่ผ่านเกณฑ์ความจริง (ใช้เนื้อหาดิบเดิมได้เลย)' };
  const sources = uniq.filter(r => facts.some(f => f.sourceUrl === r.link)).map(r => ({ type: 'แหล่งรีเสิร์ช', url: r.link, title: String(r.title || '').slice(0, 120) }));
  return { ok: true, person, facts, comparables, sources, at: new Date().toISOString() };
}

/**
 * =====================================================
 * Research Agent — เจาะลึกข่าวให้ "พร้อมเขียน" (News Desk)
 * =====================================================
 * โจทย์ผู้ใช้: "ข่าวที่มีอยู่ใช้งานไม่ค่อยได้ → ค้นคว้าเพิ่มได้ไหม"
 * ทำงาน: หาแหล่งข่าวเรื่องเดียวกันเพิ่ม 2-3 แหล่ง → อ่านเนื้อจริง → gpt-5.5 สังเคราะห์
 *        ตัวเลข/คำพูดตรง/ไทม์ไลน์ → การ์ดอัปเกรดเป็น "เนื้อพร้อมเขียน" ส่งเข้า workflow ได้เนื้อแน่น
 * เรียกได้ 2 ทาง: อัตโนมัติหลัง harvest (ตัวท็อป) + ปุ่ม 🔬 เจาะลึก บนการ์ด
 */

import { callAI } from '@/lib/ai/openai';

async function serperSearch(endpoint, query, num = 6) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('ไม่มี SERPER_API_KEY');
  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  return res.json();
}

/** ดึงเนื้อหน้าเว็บด้วย scraper เดิมของระบบ — fail คืน null ไม่พังงาน */
async function readPage(url) {
  try {
    const { extractContent } = await import('@/lib/scraper/index.js');
    const r = await Promise.race([
      extractContent({ url }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45_000)),
    ]);
    const text = (r?.text || '').trim();
    return text.length > 200 ? text.slice(0, 4000) : null;
  } catch { return null; }
}

/**
 * เจาะลึกข่าว 1 ใบ — คืน research object (ไม่แตะ store, ให้ caller จัดการ)
 */
export async function deepResearch(item) {
  const t0 = Date.now();
  const title = String(item.title || '').slice(0, 100);
  console.log(`[ResearchAgent] 🔬 ${title.slice(0, 60)}`);

  // ① หาแหล่งเพิ่มของเรื่องเดียวกัน (ตัด URL เดิมทิ้ง)
  const cleanTitle = title.replace(/["'“”]/g, '').split('|')[0].trim();
  const [newsRes, webRes] = await Promise.all([
    serperSearch('news', cleanTitle, 8).catch(() => ({})),
    serperSearch('search', `${cleanTitle} รายละเอียด`, 6).catch(() => ({})),
  ]);
  const candidates = [
    ...(newsRes.news || []).map(n => ({ url: n.link, title: n.title, snippet: n.snippet || '' })),
    ...(webRes.organic || []).map(o => ({ url: o.link, title: o.title, snippet: o.snippet || '' })),
  ].filter(c => c.url && c.url !== item.url && !/facebook\.com|youtube\.com|tiktok\.com/.test(c.url));
  const unique = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 5);

  // ② อ่านเนื้อจริง 2 แหล่งแรกที่อ่านได้ (+ ต้นทางถ้าอ่านได้)
  const pages = [];
  for (const c of [{ url: item.url, title: item.title, snippet: item.snippet }, ...unique]) {
    if (pages.length >= 3) break;
    const text = await readPage(c.url);
    if (text) pages.push({ url: c.url, title: c.title, text });
  }

  const material = pages.length
    ? pages.map((p, i) => `── แหล่ง ${i + 1}: ${p.title}\n${p.text.slice(0, 2500)}`).join('\n\n')
    : unique.map((c, i) => `── แหล่ง ${i + 1}: ${c.title}\n${c.snippet}`).join('\n');

  if (!material || material.length < 150) {
    return { ok: false, reason: 'หาแหล่งเพิ่มไม่ได้ — ข่าวนี้ข้อมูลในเน็ตน้อยจริง' };
  }

  // ③ สังเคราะห์เป็น "เนื้อพร้อมเขียน"
  const res = await callAI({
    prompt: `คุณคือนักข่าวเจาะลึกของเพจไวรัลไทย รวบข้อมูลจากหลายแหล่งให้เป็น "วัตถุดิบพร้อมเขียน"
ข่าว: ${title}
ข้อมูลตั้งต้น: ${String(item.snippet || '').slice(0, 200)}

=== แหล่งที่หามาได้ ===
${material.slice(0, 8000)}
=== จบแหล่ง ===

ตอบ JSON เท่านั้น:
{"keyFacts":["ข้อเท็จจริงสำคัญพร้อมตัวเลข/ชื่อ/สถานที่ (เอาเฉพาะที่อยู่ในแหล่งจริง)"],
"quotes":["คำพูดตรงจากบุคคลในข่าว ถ้ามี"],
"timeline":"ลำดับเหตุการณ์สั้นๆ ถ้าเรื่องมีพัฒนาการ (ไม่มีใส่ '')",
"enrichedSummary":"สรุปเนื้อข่าวฉบับเต็ม 3-5 ประโยค รวมทุกแหล่ง — นี่จะเป็นวัตถุดิบหลักของนักเขียน",
"readyScore":0-10,
"stillMissing":"ยังขาดอะไรถ้าจะให้สมบูรณ์ (ไม่ขาดใส่ '')"}
- readyScore: 9-10=ตัวเลข+คำพูด+เรื่องครบ | 5-6=พอเขียนได้ | 0-3=ข้อมูลบางมาก
- ห้ามแต่งข้อเท็จจริงที่ไม่อยู่ในแหล่ง`,
    model: 'gpt-5.5',
    temperature: 0.2,
    maxTokens: 8000,
  });

  const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
  if (!parsed?.enrichedSummary) return { ok: false, reason: 'AI สังเคราะห์ไม่สำเร็จ' };

  console.log(`[ResearchAgent] ✅ ready ${parsed.readyScore}/10 | facts ${parsed.keyFacts?.length} | sources ${pages.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return {
    ok: true,
    keyFacts: (parsed.keyFacts || []).slice(0, 6).map(f => String(f).slice(0, 160)),
    quotes: (parsed.quotes || []).slice(0, 3).map(q => String(q).slice(0, 180)),
    timeline: String(parsed.timeline || '').slice(0, 300),
    enrichedSummary: String(parsed.enrichedSummary).slice(0, 1200),
    readyScore: Math.min(10, Math.max(0, Number(parsed.readyScore) || 5)),
    stillMissing: String(parsed.stillMissing || '').slice(0, 120),
    sources: pages.map(p => p.url).concat(unique.slice(0, 3).map(u => u.url)).slice(0, 5),
    researchedAt: new Date().toISOString(),
  };
}

/** ประกอบ "เนื้อเต็มสำหรับ workflow" จากการ์ดที่เจาะลึกแล้ว */
export function buildEnrichedInput(item) {
  const r = item.research;
  if (!r?.enrichedSummary) return null;
  return [
    `${item.title}`,
    '',
    // ★ ข่าวต่างประเทศ: ใส่ประเทศเป็นข้อเท็จจริงนำ — นักเขียนต้องระบุตั้งแต่ย่อหน้าแรก (เคส #00194/00198 เวียดนามไม่ถูกระบุ)
    item.foreignCountry ? `ข้อเท็จจริงสำคัญที่สุด: เหตุการณ์นี้เกิดที่ประเทศ${item.foreignCountry} (ไม่ใช่ประเทศไทย) — ต้องระบุประเทศชัดเจนตั้งแต่ย่อหน้าแรกของโพสต์ ห้ามเขียนให้คนอ่านเข้าใจผิดว่าเกิดในไทย` : '',
    r.enrichedSummary,
    '',
    r.keyFacts?.length ? 'ข้อเท็จจริงสำคัญ:\n' + r.keyFacts.map(f => `- ${f}`).join('\n') : '',
    r.quotes?.length ? 'คำพูดตรง:\n' + r.quotes.map(q => `- "${q}"`).join('\n') : '',
    r.timeline ? `ไทม์ไลน์: ${r.timeline}` : '',
    `(รวบรวมจาก ${r.sources?.length || 1} แหล่ง)`,
  ].filter(Boolean).join('\n');
}

/**
 * =====================================================
 * 🧬 News DNA Extractor — สกัด "ดีเอ็นเอแนวข่าว" จากโพสต์จริงของเพจ (4 ก.ค. 69)
 * =====================================================
 * โจทย์ผู้ใช้: ให้ AI อ่านข่าวทุกโพสต์ในเพจแบบเจาะ DNA → สกัดเป็น "คลังคำค้น" ที่ทุกเลน
 *   (ลิงก์/คลิป/ทุกแพลตฟอร์ม) ใช้ค้นเหมือนกันหมด เพื่อได้คอนเทนต์ตรงแนวทำเงินเยอะสุด
 * วิธี: อ่าน CSV (Meta export) → เรียงตามรีแอกชัน → ส่งท็อป N โพสต์เข้า gpt-4o เป็นก้อน
 *   → AI จัดกลุ่มเป็น "แนว (theme)" + สกัด DNA + สร้างคำค้น 2 ชุด (newsQueries=บทความ / clipQueries=คลิป)
 *   → รวม/ถ่วงน้ำหนักด้วยรีแอกชันจริง → เก็บ store 'desk-dna' (id 'latest')
 * → dnaQueries.js อ่านคลังนี้ป้อนทุกเลนใน harvester
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง
 */

import { createStore } from '@/lib/persistStore';

const STORE = 'desk-dna';

async function openaiJSON({ model = 'gpt-4o', messages, maxTokens = 3000, temperature = 0.3 }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return JSON.parse((await res.json()).choices?.[0]?.message?.content || '{}');
}

// CSV parser (quoted fields)
function parseCSV(s) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function readPostsFromCsv(raw) {
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const rows = parseCSV(raw);
  const header = rows[0] || [];
  const idxExact = (n) => header.findIndex(h => String(h).trim() === n);
  const idxInc = (n) => header.findIndex(h => String(h).includes(n));
  const iTitle = idxExact('ชื่อ') >= 0 ? idxExact('ชื่อ') : idxInc('ชื่อ');
  const iReact = idxExact('ความรู้สึก') >= 0 ? idxExact('ความรู้สึก') : idxInc('ความรู้สึก');
  if (iTitle < 0 || iReact < 0) throw new Error('ไม่พบคอลัมน์ ชื่อ/ความรู้สึก — ต้องเป็น Meta export');
  return rows.slice(1)
    .filter(r => r.length > Math.max(iTitle, iReact))
    .map(r => ({ t: String(r[iTitle] || '').replace(/\s+/g, ' ').trim(), react: Number(r[iReact]) || 0 }))
    .filter(p => p.t.length > 15)
    .sort((a, b) => b.react - a.react);
}

const DNA_PROMPT = `คุณคือนักวิเคราะห์คอนเทนต์ไวรัลไทยระดับ DNA วิเคราะห์ "พาดหัวโพสต์จริง" ของเพจข่าวน้ำดี/คนดัง (พร้อมยอดรีแอกชันจริง)
งาน: แยกโพสต์เป็น "แนวข่าวย่อยเฉพาะเจาะจง (theme)" + สกัด DNA + สร้างคำค้นไปหาคอนเทนต์แบบเดียวกันมาทำใหม่

★★ กติกาคำค้น (สำคัญสุด): ต้อง "เจาะจงตามจุดที่ทำให้ปัง" ห้ามกว้างลอยๆ
  ❌ ห้าม: "สู้ชีวิต", "ความรัก", "ครอบครัวอบอุ่น" (กว้างเกิน ได้ขยะ)
  ✅ ต้อง: "เด็กยากจนสอบติดหมอ", "เด็กเก็บขยะได้ทุนเรียน", "ลูกซื้อบ้านให้แม่กตัญญู", "วินคืนเงินแสนผู้โดยสาร", "แม่ทัพเกษียณบวชกวาดลานวัด"
  = ใส่ "ตัวละคร + การกระทำ + จุดหักมุม" ในคำค้น (เหมือนพาดหัวย่อ)

แยกให้ละเอียด (ยิ่งเจาะจงยิ่งดี) เช่นแทนที่จะรวม "สู้ชีวิต" ก้อนเดียว ให้แตกเป็น: เด็กยากจนเรียนเก่ง / คนแก่สู้ชีวิตขายของ / คนพิการไม่ยอมแพ้ / แม่เลี้ยงเดี่ยวสู้เพื่อลูก
ต่อแนว: {"name":"ชื่อแนวเฉพาะ","dna":"จุดที่ทำให้ปัง 1 ประโยค","category":"กตัญญู/ครอบครัวอบอุ่น|น้ำใจ/ช่วยเหลือ|สู้ชีวิต|คนดังทำดี/ติดดิน|สัมภาษณ์/บทสนทนาดี|คนดัง/ดราม่าบันเทิง|บันเทิงกระแส|ความรัก/แต่งงาน|กระแสรายวัน|อื่นๆ","newsQueries":["คำค้นเจาะจง 4-6 คำ หาบทความ"],"clipQueries":["คำค้นเจาะจง 4-6 คำ หาคลิป YouTube/TikTok/FB"],"exampleReact":123456}
ครอบทุกวงการ (ชาวบ้าน/เด็ก/คนแก่/ดารา/เครื่องแบบ/พระ) · ห้ามใส่ชื่อเฉพาะบุคคล (reusable) · เอาเฉพาะแนวยอดสูงจริง
ตอบ JSON: {"themes":[...]}`;

/**
 * สกัด DNA จาก CSV — คืน { themes: [...], analyzedAt, posts, medianReactions }
 * @param {string} rawCsv - เนื้อไฟล์ CSV
 * @param {object} opts - { topN?: 250, batch?: 25, onLog?: fn }
 */
export async function extractDna(rawCsv, { topN = 250, batch = 25, onLog = () => {} } = {}) {
  const all = readPostsFromCsv(rawCsv);
  const median = all[Math.floor(all.length / 2)]?.react || 0;
  const top = all.slice(0, topN);
  onLog(`อ่าน ${all.length} โพสต์ · median ${median.toLocaleString()} · ส่งท็อป ${top.length} เข้า AI`);

  // ── ก้อนละ 25 โพสต์ → AI จัดแนว+สกัด DNA (ยิงขนานทีละ 3 ก้อน) ──
  const chunks = [];
  for (let i = 0; i < top.length; i += batch) chunks.push(top.slice(i, i + batch));
  const rawThemes = [];
  const runChunk = async (chunk, ci) => {
    const list = chunk.map(p => `[${p.react}] ${p.t.slice(0, 130)}`).join('\n');
    try {
      const r = await openaiJSON({ model: 'gpt-4o', temperature: 0.3, maxTokens: 3500, messages: [{ role: 'user', content: `${DNA_PROMPT}\n\nโพสต์ (รูปแบบ: [รีแอกชัน] พาดหัว):\n${list}` }] });
      for (const th of (r.themes || [])) if (th.name) rawThemes.push(th);
    } catch (e) { onLog(`ก้อน ${ci} ล่ม: ${e.message.slice(0, 40)}`); }
  };
  for (let i = 0; i < chunks.length; i += 3) await Promise.all(chunks.slice(i, i + 3).map((c, j) => runChunk(c, i + j)));
  onLog(`AI จัดแนวดิบได้ ${rawThemes.length} แนว (จาก ${chunks.length} ก้อน) → รวบเป็นแนวหลัก`);

  // ── รวบแนวซ้ำ (AI ตัวสุดท้าย consolidate เป็น ~18-24 แนวหลัก ไม่ซ้ำ) ──
  let themes = rawThemes;
  try {
    const merged = await openaiJSON({
      model: 'gpt-4o', temperature: 0.2, maxTokens: 4000,
      messages: [{ role: 'user', content: `รวบ "แนวข่าว" ที่ซ้ำกันเป๊ะเท่านั้น — เหลือ 18-25 แนว (อย่ารวบจนกว้าง! เก็บความเจาะจงไว้)
★ คำค้นต้องเจาะจงตามจุดหักมุม (เช่น "เด็กยากจนสอบติดหมอ" ไม่ใช่ "สู้ชีวิต") — ตัดคำค้นกว้างลอยๆ ทิ้ง
แนวดิบ: ${JSON.stringify(rawThemes.map(t => ({ n: t.name, c: t.category, nq: t.newsQueries, cq: t.clipQueries, r: t.exampleReact }))).slice(0, 13000)}
ต่อแนว: {"name","dna","category","newsQueries":["เจาะจง 5-7 คำ"],"clipQueries":["เจาะจง 5-7 คำ"],"weight":1-10}
weight: 10=ปังสุด (เด็กลำบาก/กตัญญูซื้อบ้าน/พลเมืองดีคืนเงิน/เครื่องแบบเสียสละ/ดาราให้เงินมีตัวเลข)
ตอบ JSON: {"themes":[...]}` }],
    });
    if (merged.themes?.length) themes = merged.themes;
  } catch (e) { onLog(`รวบแนวล่ม (ใช้แนวดิบ): ${e.message.slice(0, 40)}`); }

  // clean
  themes = themes.filter(t => t.name && (t.newsQueries?.length || t.clipQueries?.length)).map(t => ({
    name: String(t.name).slice(0, 60),
    dna: String(t.dna || '').slice(0, 200),
    category: String(t.category || 'อื่นๆ').slice(0, 40),
    newsQueries: (t.newsQueries || []).map(q => String(q).slice(0, 70)).filter(Boolean).slice(0, 8),
    clipQueries: (t.clipQueries || []).map(q => String(q).slice(0, 70)).filter(Boolean).slice(0, 8),
    weight: Math.min(10, Math.max(1, Number(t.weight) || 5)),
  }));

  const record = {
    id: 'dna_latest', analyzedAt: new Date().toISOString(),
    posts: all.length, medianReactions: median, themeCount: themes.length,
    totalNewsQueries: themes.reduce((s, t) => s + t.newsQueries.length, 0),
    totalClipQueries: themes.reduce((s, t) => s + t.clipQueries.length, 0),
    themes,
  };
  const store = createStore(STORE);
  const ex = (await store.getAll()).find(x => x.id === 'dna_latest');
  if (ex) await store.update('dna_latest', () => record); else await store.add(record);
  onLog(`✅ เก็บ DNA: ${themes.length} แนว · newsQ ${record.totalNewsQueries} · clipQ ${record.totalClipQueries}`);
  return record;
}

export async function getDna() {
  try { return (await createStore(STORE).getAll()).find(x => x.id === 'dna_latest') || null; } catch { return null; }
}

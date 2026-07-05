// ============================================================
// 👁️ ตาค้นภาพ — Gemini คัดขยะ + แยกอารมณ์ (สำหรับคลัง /image-search)
// ------------------------------------------------------------
// ★ 5 ก.ค. 2026 พอร์ตจากโปรเจกต์ระบบทำปกออโต้ (src/lib/gemini.js + imageBuffer.js)
//   ตามคำสั่งผู้ใช้ "เอามาทุกสมองทุกส่วน" (ยกเว้นประกอบปก)
// คีย์: GEMINI_API_KEY (หรือ GOOGLE_API_KEY)
// 🔴 แยกเดี่ยวจากท่อทำข่าว/ปกอัตโนมัติ 100%
// ============================================================

import { withRetry } from './imageSearchBrain';

const DEFAULT_MODEL = 'gemini-2.5-flash';

function getKey() {
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!k) {
    const e = new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY');
    e.errorType = 'NO_GEMINI_KEY';
    throw e;
  }
  return k;
}

async function callGemini(body) {
  const key = getKey();
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  return withRetry(async () => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      const busy = res.status >= 500 || res.status === 429;
      const e = new Error(busy ? `Gemini ไม่ว่างชั่วคราว (${res.status})` : 'Gemini error ' + res.status + ': ' + JSON.stringify(d.error || d).slice(0, 200));
      e.status = res.status;
      e.errorType = busy ? 'AI_BUSY' : 'PROVIDER_ERROR';
      throw e;
    }
    return d;
  }, { retries: 8 });
}

const geminiText = (data) => (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();

function safeParse(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {
    const s = t.indexOf('{'); const e = t.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; } }
    return null;
  }
}

const CATALOG_SOURCE_HINTS =
  'Dot Property, AP (Thai), แสนสิริ/Sansiri, SHERA/เฌอร่า, NaiBann, CheckRaka, homethaidd, homenayoo, บ้าน-Kapook, Home.co.th, พฤกษา/Pruksa, ศุภาลัย, อนันดา, ศูนย์รวมแบบบ้าน, รับสร้างบ้าน, แบบบ้าน';

function subjectsBlock(subjects) {
  const list = (subjects || [])
    .map((s) => {
      const nm = s.name || '';
      if (!nm) return '';
      const bits = [s.gender, s.role].filter(Boolean);
      const hint = bits.length ? ` (${bits.join(' — ')})` : '';
      return `• ${nm}${hint}`;
    })
    .filter(Boolean)
    .join('\n');
  return list || '• บุคคลในข่าว';
}

const OWNERSHIP_RULES = `🎯 กฎ "ความเป็นเจ้าของ" ภาพวัตถุ (บ้าน/รถ/สิ่งของ/ทรัพย์สิน) — จุดที่ระบบเคยพลาดหนัก:
ภาพบ้าน/รถ/สิ่งของ จะ "ใช้ได้" เฉพาะเมื่อเป็น "ของคนในข่าวจริงๆ" เท่านั้น (เช่น บ้านของเบิ้ล ไม่ใช่บ้านสองชั้นของใครก็ไม่รู้)
- ✅ ของคนในข่าว (เก็บไว้): มีคนในข่าวอยู่ในภาพ/คู่กับวัตถุ, เป็นภาพข่าว/แคนดิดจริง, ที่มาเป็นสำนักข่าว/เพจ/โซเชียลของบุคคลนั้นที่รายงานเรื่องนี้
- ❌ วัตถุมั่ว ไม่ใช่ของคนในข่าว (ตัดทิ้ง):
   • มาจากเว็บอสังหา/รับสร้างบ้าน/แคตตาล็อก/โฆษณาโครงการ (เช่น ${CATALOG_SOURCE_HINTS})
   • เป็นภาพเรนเดอร์/โบรชัวร์/โฆษณา, มีสเปค "x ห้องนอน / พื้นที่ใช้สอย ตร.ม. / ราคา", โลโก้บริษัทรับสร้างบ้าน
   • บ้าน/รถ สวยแบบสต็อก/สตูดิโอ ที่แค่ "ตรงคีย์เวิร์ด" แต่ไม่มีอะไรโยงกับคนในข่าว
- 🏛️ ข้อยกเว้น "สถานที่สาธารณะที่ข่าวเอ่ยชื่อ": ป้าย/อาคาร/รั้วของสถาบันที่อยู่ในแก่นข่าว (เช่น มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน/มูลนิธิ ที่ข่าวระบุชื่อ) = ✅ ใช้ได้ ไม่ใช่วัตถุมั่ว แม้ไม่มีคนในภาพ — เป็นภาพบริบท/ปลายทางของเรื่อง (ชื่อเฉพาะระบุตัวตนสถานที่แล้ว)
ใช้ "ที่มา (source)" + "หัวข้อ (title)" ที่กำกับหน้าแต่ละรูป ประกอบการตัดสินเสมอ`;

function frameLabel(f) {
  const src = f.source ? ` [ที่มา: ${f.source}]` : '';
  const ttl = f.title ? ` “${String(f.title).slice(0, 80)}”` : '';
  return `รูปที่ ${f.index}:${src}${ttl}`;
}

// สแกน "ภาพขยะ" → [{index, junk, reason}]
export async function geminiJunkScan({ frames, subjects, newsGist }) {
  const promptText = `คุณคือ "บรรณาธิการภาพข่าว" มืออาชีพ ใช้ "ตา" ส่องภาพแต่ละรูปอย่างละเอียด (กำกับ "รูปที่ N:")
แล้วใช้ "ตรรกะ" ตัดสินว่าเป็น "ภาพขยะ" (junk=true) หรือ "ภาพใช้ได้" (junk=false)
เพื่อคัดคลังรูปให้เหลือเฉพาะภาพที่ "เกี่ยวกับข่าวนี้จริงๆ"

บุคคล/สิ่งของหลักในข่าว:
${subjectsBlock(subjects)}${newsGist ? `\nแก่นข่าว: ${newsGist}` : ''}

นิยาม "ภาพใช้ได้" (junk=false) — เก็บไว้:
- ภาพถ่ายจริง "บุคคลในข่าว" เด่น สะอาด เห็นหน้าชัด ไม่มีตัวหนังสือ/ลายน้ำ/กราฟิกมาทับ
- ภาพ "วัตถุของคนในข่าว" (บ้าน/รถ/สิ่งของ) ที่เป็น "ของคนในข่าวจริงๆ" (ดูกฎความเป็นเจ้าของด้านล่าง)
- เอกสาร/หลักฐานที่เกี่ยวกับข่าวนี้โดยตรง (จดหมาย/เช็ค/ป้าย — ตัวหนังสือบนหลักฐานคือของที่ต้องการ ไม่ใช่ขยะ)
- 🏛️ "สถานที่สาธารณะที่ข่าวเอ่ยชื่อ" (ป้าย/อาคาร/รั้ว มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน ที่อยู่ในแก่นข่าว) = เก็บไว้ แม้ไม่มีคนในภาพ (เฉพาะ "ภาพถ่ายจริง" — โลโก้/ตราสัญลักษณ์/กราฟิกล้วนของสถาบัน = ขยะเหมือนเดิม)
- เอาไป "รีทัช/ครอปทำปกได้ทันที" ไม่ติดนู่นติดนี่

นิยาม "ภาพขยะ" (junk=true) — ต้องลบทิ้ง (มองด้วยตาให้ครบ):
1. มี "ตัวหนังสือ/แคปชั่น/ข้อความ" ทับบนภาพหรือ "ทับใบหน้า" — โดยเฉพาะพาดหัวตัวใหญ่ → รีทัชไม่ได้ = ขยะ
2. ปกข่าว/ปกคลิป/thumbnail คลิกเบต ที่มีข้อความพาดหัว (เช่น "อึ้ง!!", "เผยคำพูดลับ")
3. ลายน้ำ/โลโก้/ตราสำนักข่าว/ชื่อช่อง/เว็บไซต์ ประทับบนภาพ
4. ภาพคอลลาจหลายช่อง / การ์ดกราฟิก / quote card / การ์ดวันเกิด
5. การ์ดไตเติล/อินโทรรายการ, กราฟิกล้วน, ปุ่มเล่น ▶, หน้าจอ UI, จอดำ/ขาวเปล่า
6. เบลอหนัก/มัว/มืด/เฟรมเปลี่ยนฉาก จนใช้ไม่ได้
7. ไม่ใช่บุคคลเป้าหมาย/ไม่เกี่ยวข่าว — คนอื่น, มีม, ภาพสุ่มมั่ว, ภาพไม่เหมาะสม/โป๊/ล่อแหลม
8. 🎯 "วัตถุมั่ว" (บ้าน/รถ/สิ่งของ ที่ "ไม่ใช่ของคนในข่าว") — บ้าน/รถทั่วไปจากแคตตาล็อก/โฆษณา/อสังหา ที่แค่ตรงคีย์เวิร์ด (ดูกฎด้านล่าง)

${OWNERSHIP_RULES}

หลักคิด: "เก็บไว้เฉพาะภาพที่เป็นคน/ของ ของคนในข่าวจริงๆ และสะอาดรีทัชได้" — สงสัยว่าเป็นบ้าน/รถมั่วที่ไม่ใช่ของคนในข่าว = ตัดทิ้ง
ตอบเป็น JSON เท่านั้น: { "items": [ { "index": <เลขรูป>, "junk": true/false, "reason": "สั้นๆ (เช่น 'บ้านแคตตาล็อกไม่ใช่ของคนในข่าว', 'มีข้อความทับหน้า', 'ลายน้ำสำนักข่าว')" } ] }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const data = await callGemini({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } });
  const parsed = safeParse(geminiText(data));
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.items || [];
  return list.filter((x) => x && typeof x.index === 'number');
}

// แยก "อารมณ์ภาพ" → [{index, emotion}]
export async function geminiEmotionScan({ frames, subjects }) {
  const names = (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';
  const promptText = `คุณคือ "ผู้กำกับภาพ" ใช้ "ตา" ส่องสีหน้า/อารมณ์ในแต่ละรูป (กำกับ "รูปที่ N:")
แล้วใช้ "ตรรกะ" จัดแต่ละรูปเข้า "หมวดอารมณ์" 1 หมวด (บุคคลเป้าหมาย: ${names})

หมวดอารมณ์ (เลือก key เดียวต่อรูป) — เกณฑ์ชัดเจน:
- "happy"   = ยิ้ม สีหน้าเบิกบาน อารมณ์ดี มีความสุข (ยิ้มพอดี ไม่ถึงกับหัวเราะ)
- "laugh"   = หัวเราะ ปากเปิดกว้าง สนุกสุดๆ ขำ
- "sad"     = เศร้า ร้องไห้ น้ำตา ซึม โศกเศร้า ทุกข์
- "serious" = สีหน้านิ่ง จริงจัง เคร่งขรึม ไม่ยิ้ม มองตรง (neutral/สุขุม)
- "angry"   = โกรธ ขมวดคิ้ว ไม่พอใจ ตวาด หน้าบึ้ง
- "shock"   = ตกใจ ตาเบิกกว้าง ปากอ้า ประหลาดใจ ช็อก
- "warm"    = อบอุ่น ซาบซึ้ง อ่อนโยน กอด/สัมผัส โมเมนต์ครอบครัว-กำลังใจ
- "worried" = กังวล เครียด ครุ่นคิด เหนื่อยล้า วิตก
- "context" = ไม่เน้นสีหน้า — เป็นฉาก/แอ็คชัน/สถานที่/ชีวิตประจำวัน/ทำงาน
- "document"= เอกสาร/ตัวหนังสือ/กระดาษ (ไม่ใช่คน)
- "other"   = ไม่ชัด/อารมณ์ปนกันจนแยกไม่ได้/ไม่มีคน

หลักคิด: ดู "สีหน้า+ท่าทาง" เป็นหลัก แล้วเลือกหมวดที่ "เด่นสุด" ของรูปนั้น
ตอบเป็น JSON เท่านั้น: { "items": [ { "index": <เลขรูป>, "emotion": "<key>" } ] }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const data = await callGemini({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } });
  const parsed = safeParse(geminiText(data));
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.items || [];
  return list.filter((x) => x && typeof x.index === 'number' && x.emotion);
}

// ── โหลดรูปเป็น Buffer (fetch + timeout + fallback thumbnail) ──
async function fetchBuf(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; } finally { clearTimeout(t); }
}
async function oneUrl(url) {
  if (!url || !/^https?:/.test(url)) return null;
  return fetchBuf(url);
}
export async function loadImageBuffer(im) {
  if (!im) return null;
  return (await oneUrl(im.imageUrl)) || (await oneUrl(im.thumbnailUrl)) || null;
}

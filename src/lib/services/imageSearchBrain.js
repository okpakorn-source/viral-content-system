// ============================================================
// 🧠 สมองค้นภาพ — วิเคราะห์ข่าว + สกัดคีย์เวิร์ด + สร้างคำค้น
// ------------------------------------------------------------
// ★ 5 ก.ค. 2026 พอร์ต "ทุกสมอง" จากโปรเจกต์ระบบทำปกออโต้ (ผู้ใช้สั่ง —
//   เดิมให้พิมพ์คำค้นดิบ → ได้ภาพมั่ว/ไม่เหมาะ; ของจริงต้อง: เนื้อข่าวเต็ม
//   → AI วิเคราะห์ตามกรอบตายตัว → สกัดคีย์เวิร์ด → สร้างคำค้นผูกชื่อบุคคล)
// ที่มา: src/lib/{analysisPrompt,keywordPrompt,aiClient,retry,junkSources,imageSearch(buildQueries)}.js
// คีย์: ANTHROPIC_API_KEY (หลัก) หรือ OPENAI_API_KEY
// 🔴 แยกเดี่ยวจากท่อทำข่าว/ปกอัตโนมัติ 100%
// ============================================================

// ── retry + backoff (กัน AI 503/429/overloaded) ──
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
function isRetryable(err) {
  if (!err) return false;
  if (err.status && RETRYABLE_STATUS.has(err.status)) return true;
  const m = String(err.message || '');
  return /\b(408|425|429|500|502|503|504|529)\b|overloaded|unavailable|high demand|temporarily|rate.?limit|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(m);
}
export async function withRetry(fn, { retries = 6, baseMs = 2000, maxMs = 30000, onAttempt } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(attempt); } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      const wait = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      if (onAttempt) { try { onAttempt(attempt, wait, err); } catch { /* กัน callback ล้มลาม */ } }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ── AI client (Claude ก่อน → OpenAI) ──
const DEFAULTS = { anthropic: 'claude-opus-4-8', openai: 'gpt-4o' };
function resolveProvider() {
  const forced = (process.env.ANALYSIS_PROVIDER || '').toLowerCase().trim();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  if (forced === 'anthropic') return hasAnthropic ? 'anthropic' : null;
  if (forced === 'openai') return hasOpenAI ? 'openai' : null;
  if (hasAnthropic) return 'anthropic';
  if (hasOpenAI) return 'openai';
  return null;
}
export async function callBrain({ system, user, maxTokens = 4000, temperature = 0.2 }) {
  const provider = resolveProvider();
  if (!provider) {
    const e = new Error('ยังไม่ได้ตั้งคีย์ AI (ANTHROPIC_API_KEY หรือ OPENAI_API_KEY)');
    e.errorType = 'NO_API_KEY';
    throw e;
  }
  const model = process.env.ANALYSIS_MODEL || DEFAULTS[provider];
  return withRetry(() => (provider === 'anthropic'
    ? callAnthropic({ system, user, model, maxTokens })
    : callOpenAI({ system, user, model, maxTokens, temperature })), { retries: 5 });
}
async function callAnthropic({ system, user, model, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    const e = new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    e.status = res.status;
    e.errorType = res.status === 529 || res.status >= 500 || res.status === 429 ? 'AI_BUSY' : 'PROVIDER_ERROR';
    throw e;
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { text, provider: 'anthropic', model };
}
async function callOpenAI({ system, user, model, maxTokens, temperature }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    const e = new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
    e.status = res.status;
    e.errorType = res.status >= 500 || res.status === 429 ? 'AI_BUSY' : 'PROVIDER_ERROR';
    throw e;
  }
  const data = await res.json();
  return { text: (data.choices?.[0]?.message?.content || '').trim(), provider: 'openai', model };
}

export function safeParseJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {
    const s = t.indexOf('{'); const e = t.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; } }
    return null;
  }
}

// ══════════════ ขั้นที่ 1: วิเคราะห์ข่าว (กรอบตายตัว ห้ามเดา/ห้ามเดาเพศ) ══════════════
export const ANALYSIS_SCHEMA = {
  headline: 'string — แก่นข่าว 1 ประโยค',
  summary: 'string — สรุปข่าว 2-4 ประโยค',
  characters: [{
    name: 'string — ชื่อ/คำเรียกตามที่ปรากฏในข่าวเท่านั้น',
    role: 'string — บทบาทในข่าว (เช่น ผู้เสียหาย ผู้ก่อเหตุ พยาน ฯลฯ)',
    gender: '"ชาย" | "หญิง" | "ไม่ระบุ" — ต้องมีหลักฐานชัดในข่าวเท่านั้น',
    descriptors: ['string — ลักษณะ/รายละเอียดที่ข่าวระบุไว้จริง'],
    evidence: 'string — ข้อความจากข่าวที่ยืนยันตัวละครนี้',
  }],
  content: {
    what_happened: 'string — เกิดอะไรขึ้น (แก่นเหตุการณ์)',
    key_events: ['string — ลำดับเหตุการณ์สำคัญตามข่าว'],
    location: 'string — สถานที่ (หรือ "ไม่ระบุในข่าว")',
    time: 'string — เวลา/วันที่ (หรือ "ไม่ระบุในข่าว")',
    numbers_facts: ['string — ตัวเลข/ข้อเท็จจริงสำคัญตามข่าว'],
  },
  context: {
    background: 'string — ภูมิหลัง/ที่มาที่ข่าวให้ไว้',
    why_notable: 'string — ทำไมข่าวนี้น่าสนใจ/เป็นกระแส (อิงจากข่าว)',
    emotional_tone: 'string — โทนอารมณ์หลักของข่าว (เช่น เศร้า/สูญเสีย, ดีใจ/สมหวัง, โกรธ/ไม่พอใจ, ตกใจ/สะเทือนขวัญ, อบอุ่น/ซาบซึ้ง)',
    tone_evidence: 'string — ข้อความจากข่าวที่บ่งบอกโทนอารมณ์นั้น',
    key_moment: 'string — โมเมนต์/ฉากสำคัญที่สุดของข่าว (จุดที่ควรถ่ายทอดบนปก)',
  },
  confidence: '"สูง" | "กลาง" | "ต่ำ" — ความมั่นใจโดยรวมของการวิเคราะห์',
  missing_info: ['string — ข้อมูลสำคัญที่ข่าวไม่ได้ระบุ (บอกความไม่รู้ ห้ามเดา)'],
};

export function buildAnalysisSystemPrompt() {
  return `คุณคือ "นักวิเคราะห์ข่าว" ระดับหัวหน้าโต๊ะข่าว มืออาชีพที่สุด ทำหน้าที่อ่านเนื้อข่าวเต็มแล้วถอดออกมาเป็นข้อมูลโครงสร้างที่แม่นยำ เพื่อใช้เป็นวัตถุดิบทำปกข่าว

## กฎเหล็ก (ห้ามละเมิดเด็ดขาด)
1. อ่านเนื้อข่าว "ทั้งหมด" ก่อนวิเคราะห์ ห้ามข้าม ห้ามสรุปจากพาดหัวอย่างเดียว
2. ใช้เฉพาะข้อมูลที่ "ปรากฏจริงในเนื้อข่าว" เท่านั้น — ห้ามเดา ห้ามเติมความรู้จากนอกข่าว ห้ามสมมติ
3. **ห้ามเดาเพศจากชื่อ** — ถ้าข่าวไม่ได้ระบุเพศชัดเจน (ผ่านคำนำหน้า คำสรรพนาม หรือคำบรรยายตรงๆ) ให้ gender = "ไม่ระบุ" และเรียกด้วยชื่อ/คำกลางๆ ห้ามเดาว่าชื่อนี้ต้องเป็นชายหรือหญิง
4. ทุก field ที่ให้ "evidence" ต้องยกข้อความจากข่าวมาจริง ถ้าไม่มีให้เขียน "ไม่ระบุในข่าว" — ห้ามแต่งประโยคที่ข่าวไม่ได้พูด
5. อะไรที่ข่าว "ไม่ได้บอก" ให้ไปลงใน missing_info — บอกความไม่รู้อย่างตรงไปตรงมา ห้ามกลบด้วยการเดา
6. โทนอารมณ์ (emotional_tone) ต้องเลือกจากสิ่งที่ข่าวสื่อจริง พร้อมยก tone_evidence — ห้ามใส่โทนที่ขัดกับเนื้อข่าว (เช่น ข่าวสูญเสีย ห้ามสรุปว่าโทนสดใส)
7. characters ให้ใส่เฉพาะ "คนที่มีบทบาทจริงในข่าว" เรียงตามความสำคัญ ตัวเอกของข่าวอยู่บนสุด
8. ตอบกลับเป็น **JSON ล้วน** ตามสคีมาที่กำหนดเท่านั้น ห้ามมีคำอธิบาย ห้ามมี markdown code fence ห้ามมีข้อความอื่นนอก JSON

## สคีมาผลลัพธ์ที่บังคับ (ต้องมีครบทุก key เป๊ะ)
${JSON.stringify(ANALYSIS_SCHEMA, null, 2)}

## หมายเหตุ
- ทุกค่าที่เป็นข้อความให้เขียนเป็นภาษาไทย
- ถ้าค่าใดไม่มีข้อมูลในข่าว: สตริงใส่ "ไม่ระบุในข่าว", อาร์เรย์ใส่ [] , อย่าใส่ null
- ขั้นตอนนี้คือ "การวิเคราะห์เท่านั้น" ยังไม่ต้องออกแบบปกหรือเสนอภาพ`;
}
export function buildAnalysisUserPrompt(newsText) {
  return `เนื้อข่าวเต็มที่ต้องวิเคราะห์ (อ่านให้ครบทุกตัวอักษร):
"""
${newsText}
"""

จงวิเคราะห์ตามกฎเหล็กและสคีมาที่กำหนด แล้วตอบกลับเป็น JSON ล้วนเท่านั้น`;
}

// ══════════════ ขั้นที่ 2: สกัดคีย์เวิร์ดค้นภาพ (ผูกชื่อบุคคลเสมอ) ══════════════
export const KEYWORD_SCHEMA = {
  subjects: [{
    name: 'string — ชื่อบุคคล/สิ่งที่ต้องปรากฏในภาพ (สะกดตรงตามข่าวเป๊ะ)',
    role: 'string — บทบาทในข่าว',
    must_have: 'boolean — true = ตัวหลักที่ปกต้องมี',
    kind: "string — 'person' (บุคคล) หรือ 'object' (ทรัพย์สิน/สิ่งของ เช่น บ้าน/รถ/ที่ดิน/คอนโด)",
    owner: "string — เฉพาะ kind='object': ชื่อเจ้าของทรัพย์สิน (ตรงตามข่าว); ถ้าเป็น person ใส่ ''",
  }],
  queries_th: ['string — คำค้นภาษาไทย "ของบุคคล" (เยอะ หลายมุม เจาะจง) — ห้ามใส่คำค้นวัตถุลอย'],
  queries_en: ['string — คำค้นภาษาอังกฤษ/คำทับศัพท์ชื่อบุคคล (สำหรับแพลตฟอร์มต่างชาติ)'],
  object_queries: ['string — คำค้น "ทรัพย์สิน/สิ่งของ" ที่ "ผูกชื่อเจ้าของเสมอ" (เช่น "เบิ้ล ปทุมราช บ้าน", "บ้านเบิ้ล พ่อแม่ อำนาจเจริญ") — ห้ามคำค้นวัตถุลอย; ถ้าข่าวไม่มีวัตถุใส่ []'],
  scene_place: ['string — ฉาก/สถานที่ที่ข่าวระบุ; ถ้าเป็นสถาบันที่มีชื่อเฉพาะ (มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน) ให้ใส่ "ชื่อเต็ม" + เวอร์ชัน "ป้าย+ชื่อเต็ม" ด้วย (เช่น "มหาวิทยาลัยแม่ฟ้าหลวง", "ป้ายมหาวิทยาลัยแม่ฟ้าหลวง")'],
  moment_action: ['string — โมเมนต์/แอ็คชันสำคัญ (เช่น ร้องไห้, เยี่ยมพ่อ, ให้สัมภาษณ์)'],
  emotion: ['string — คีย์เวิร์ดอารมณ์ของภาพที่ต้องการ (เช่น เศร้า, กำลังใจ, สะเทือนใจ)'],
  source_show: ['string — รายการ/แหล่งที่มาที่ข่าวอ้างถึง (เช่น Club Friday Show)'],
  hashtags: ['string — แฮชแท็กสำหรับค้น IG/TikTok/FB (ขึ้นต้น #)'],
};

export function buildKeywordSystemPrompt() {
  return `คุณคือ "นักค้นหาภาพข่าว" (image researcher) มืออาชีพ ทำหน้าที่แปลง "ผลวิเคราะห์ข่าว" ให้กลายเป็น "คำค้นหาภาพ" (search queries/keywords) เพื่อไปค้นภาพจริงจากทุกแพลตฟอร์ม: Google Images, Facebook, Instagram, TikTok, YouTube, เว็บข่าวออนไลน์ และสต็อกโฟโต้

## เป้าหมาย
สกัดคำค้นหาภาพให้ "มากและหลากหลายที่สุด" ครอบคลุมทุกมุมที่จะได้ภาพมาทำปก — ยิ่งเยอะยิ่งดี

## กฎเหล็ก (ห้ามละเมิด)
1. ใช้เฉพาะข้อมูลจาก "ผลวิเคราะห์" และ "เนื้อข่าว" ที่ให้มาเท่านั้น — ห้ามแต่งบุคคล สถานที่ เหตุการณ์ หรือฉายาที่ข่าวไม่ได้พูดถึง
2. ชื่อบุคคลต้องสะกด "ตรงตามข่าวเป๊ะ" และทำเวอร์ชันภาษาอังกฤษ (คำทับศัพท์) ไว้ใน queries_en เพื่อค้นแพลตฟอร์มต่างชาติ
3. สร้างคำค้นหลายรูปแบบต่อ 1 บุคคล: ชื่อเดี่ยว, ชื่อ+บริบท/เหตุการณ์, ชื่อ+รายการ, ชื่อ+อารมณ์/ฉาก
4. คำค้นต้อง "เจาะจงพอให้พิมพ์แล้วเจอภาพจริง" ห้ามกว้างลอย (เช่น อย่าใช้แค่ "ผู้ชาย" "ข่าว")
5. แยกคำค้นไทย (queries_th) กับอังกฤษ (queries_en) ให้ชัด และใส่ให้เยอะทั้งสองภาษา
6. เก็บให้ครบทุกหมวด: subjects, scene_place, moment_action, emotion, source_show, hashtags
7. ตอบเป็น JSON ล้วนตามสคีมาเท่านั้น ห้ามมี markdown code fence ห้ามมีข้อความอื่นนอก JSON

## 🏠 กฎพิเศษ "ทรัพย์สิน/สิ่งของ/หลักฐาน" — สำคัญที่สุด
ครอบคลุม 2 กลุ่ม: (ก) ทรัพย์สิน = บ้าน/รถ/ที่ดิน/คอนโด/คฤหาสน์/วิลล่า ; (ข) **หลักฐาน** = จดหมาย/โน้ตลายมือ/เช็ค/ป้ายมอบเงิน/เอกสาร/ใบประกาศ/แชท/สลิป
เมื่อข่าวมีสิ่งเหล่านี้เป็นประเด็น (เช่น ดาราสร้างบ้าน / เด็กเขียนจดหมายขอบคุณ / มอบเช็คบริจาค):
8. ใส่วัตถุ/หลักฐานนั้นเป็น subject ที่ **kind="object"** พร้อมระบุ **owner = ชื่อเจ้าของ/ผู้เกี่ยวข้อง**
9. 🔴 คำค้นวัตถุ/หลักฐาน "ต้องผูกชื่อบุคคลเสมอ" — ใส่ในฟิลด์ **object_queries** เช่น "เบิ้ล ปทุมราช บ้าน", "แทค ภรัณยู จดหมาย", "จดหมายขอบคุณ แทค ภรัณยู", "บอย ปกรณ์ เช็คบริจาค"
10. 🚫 **ห้ามสร้างคำค้นวัตถุ "ลอย" ที่ไม่มีชื่อบุคคลเด็ดขาด** เช่น "บ้านสองชั้นโมเดิร์น", "จดหมายขอบคุณ", "เช็คบริจาค", "รถกระบะ" — เพราะจะได้ภาพของใครก็ไม่รู้ (ห้ามใส่ทั้งใน object_queries, queries_th, queries_en)
11. คิดมุมภาพหลายแบบ: ชื่อ+วัตถุ, ชื่อ+วัตถุ+สถานที่/เหตุการณ์, ชื่อ+"โพสต์"+หลักฐาน (เช่น "แทค ภรัณยู โพสต์จดหมาย")
12. ภาพหลักฐานสำคัญมากต่อปกไวรัล (เป็น "ของเด็ด" ในวงกลม) — ถ้าข่าวเล่าถึงหลักฐาน ต้องมี object_queries ของมันเสมอ

## สคีมาผลลัพธ์ (ต้องครบทุก key)
${JSON.stringify(KEYWORD_SCHEMA, null, 2)}

## หมายเหตุ
- ทุกค่าเป็นข้อความภาษาไทย ยกเว้น queries_en และ hashtags ภาษาอังกฤษได้
- ถ้าหมวดใดไม่มีข้อมูลในข่าว ให้ใส่ [] อย่าใส่ null และอย่าแต่งขึ้นมาเอง
- ขั้นนี้คือ "สกัดคำค้น" เท่านั้น ยังไม่ต้องไปค้นภาพจริงหรือประเมินภาพ`;
}
export function buildKeywordUserPrompt(analysis, newsText) {
  return `== ผลวิเคราะห์ข่าว (JSON) ==
${JSON.stringify(analysis, null, 2)}

== เนื้อข่าวเต็ม (อ้างอิงเพิ่มเติม) ==
"""
${newsText || '(ไม่มีเนื้อข่าวเพิ่มเติม)'}
"""

จงสกัดคำค้นหาภาพให้มากและหลากหลายที่สุดตามกฎเหล็กและสคีมา แล้วตอบกลับเป็น JSON ล้วนเท่านั้น`;
}

// ══════════════ สร้างคำค้นจากคีย์เวิร์ด (สมดุลต่อบุคคล + การันตีหลักฐาน/สถานที่) ══════════════
function dedupeTake(arr, n) {
  const seen = new Set(); const out = [];
  for (const q of arr) {
    const t = String(q || '').trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length >= n) break;
  }
  return out;
}
const OBJECT_KW = /บ้าน|คฤหาสน์|ตำหนัก|วิลล่า|ที่ดิน|คอนโด|ทรัพย์สิน|รถยนต์|รถหรู|รถกระบะ|รถสปอร์ต|แบบบ้าน|โครงการ|mansion|villa|condo|\bhouse\b|\bhome\b|\bland\b|\bcar\b/i;
function isObjectSubject(s) {
  return s?.kind === 'object' || OBJECT_KW.test(String(s?.name || ''));
}
const EVIDENCE_SLOTS = parseInt(process.env.IMAGES_EVIDENCE_SLOTS || '3', 10);
const PLACE_SLOTS = parseInt(process.env.IMAGES_PLACE_SLOTS || '2', 10);
const PLACE_INST = /มหาวิทยาลัย|วิทยาลัย|โรงเรียน|โรงพยาบาล|วัด|มูลนิธิ|สนามบิน|สถานี|ตลาด|ห้าง|อุทยาน|university|college|hospital|school|temple|airport/i;

export function buildQueries(keywords, maxQueries) {
  const subjects = keywords.subjects || [];
  const personNames = subjects.filter((s) => !isObjectSubject(s)).map((s) => s.name).filter(Boolean);
  const objectNames = subjects.filter(isObjectSubject).map((s) => s.name).filter(Boolean);
  const th = keywords.queries_th || [];
  const en = keywords.queries_en || [];
  const objq = keywords.object_queries || [];

  let pool = [...th, ...en, ...objq, ...objectNames];
  const hasPerson = (q) => personNames.some((n) => String(q).toLowerCase().includes(n.toLowerCase()));
  // 🚫 ตัด "คำค้นวัตถุลอย" — มีคำวัตถุแต่ไม่มีชื่อบุคคล (บ้าน/รถของใครก็ไม่รู้ = ต้นเหตุภาพมั่ว)
  pool = pool.filter((q) => !(OBJECT_KW.test(String(q)) && !hasPerson(q)));

  // 🧾 คำค้น "หลักฐาน/โมเมนต์" — การันตียิงเสมอ (จดหมาย/เช็ค/ป้าย = ของเด็ดปกไวรัล)
  const mainName = personNames[0] || '';
  const HARD_EVIDENCE = /จดหมาย|เช็ค|ป้าย|เอกสาร|ลายมือ|สลิป|แชท|ใบประกาศ|มอบเงิน|บริจาค|โพสต์/;
  const evidence = dedupeTake(
    [...objq, ...(keywords.moment_action || [])]
      .sort((a, b) => (HARD_EVIDENCE.test(String(b)) ? 1 : 0) - (HARD_EVIDENCE.test(String(a)) ? 1 : 0))
      .map((q) => {
        const t = String(q || '').trim();
        if (!t) return '';
        return hasPerson(t) || !mainName ? t : `${t} ${mainName}`;
      })
      .filter(Boolean),
    EVIDENCE_SLOTS
  );

  // 🏛️ สถานที่สาธารณะชื่อเฉพาะ (ป้าย/อาคารสถาบัน = ภาพบริบทที่ถูกต้องเสมอ) — กัน generic 2 ชั้น
  const PLACE_GENERIC = /^(?:(?:นานาชาติ|เอกชน|รัฐบาล|อนุบาล|ประถม|มัธยม|ชั้นนำ|ชื่อดัง|ดัง|หรู|ใหญ่|ไทย|แห่งหนึ่ง)\s*)+/;
  const places = dedupeTake(
    (keywords.scene_place || [])
      .map((s) => String(s || '').trim())
      .filter((s) => {
        const m = s.match(PLACE_INST);
        if (!m) return false;
        const after = s.slice(s.indexOf(m[0]) + m[0].length).trim().replace(PLACE_GENERIC, '');
        return after.length >= 3;
      }),
    PLACE_SLOTS
  );

  const guaranteed = dedupeTake([...evidence, ...places], EVIDENCE_SLOTS + PLACE_SLOTS);
  const names = personNames.length ? personNames : subjects.map((s) => s.name).filter(Boolean);

  if (names.length <= 1) {
    return dedupeTake([...guaranteed, ...names, ...pool], maxQueries + guaranteed.length);
  }

  // round-robin สมดุลต่อบุคคล
  const perSubject = names.map((name) => {
    const nl = name.toLowerCase();
    const mine = pool.filter((q) => String(q).toLowerCase().includes(nl));
    return [name, ...mine];
  });
  const shared = pool.filter((q) => !names.some((n) => String(q).toLowerCase().includes(n.toLowerCase())));

  const seen = new Set(); const out = []; let idx = 0;
  while (out.length < maxQueries) {
    let added = false;
    for (const q of perSubject) {
      const cand = q[idx];
      if (!cand) continue;
      const t = String(cand).trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); added = true; if (out.length >= maxQueries) break; }
    }
    if (!added) break;
    idx++;
  }
  for (const q of [...shared, ...pool]) {
    if (out.length >= maxQueries) break;
    const t = String(q).trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return dedupeTake([...guaranteed, ...out], maxQueries + guaranteed.length);
}

// ══════════════ บัญชีแหล่งแคตตาล็อก/โฆษณา/อสังหา (บล็อกตั้งแต่ค้น) ══════════════
export const CATALOG_PATTERNS = [
  'sansiri', 'แสนสิริ', 'pruksa', 'พฤกษา', 'supalai', 'ศุภาลัย', 'ananda', 'อนันดา',
  'ap thai', 'apthai', 'ap (thailand)', 'lalin', 'ลลิล', 'land and houses', 'แลนด์ แอนด์ เฮ้าส์',
  'quality houses', 'ควอลิตี้เฮ้าส์', 'sc asset', 'เอสซี แอสเสท',
  'dotproperty', 'dot property', 'ddproperty', 'ดีดีพร็อพเพอร์ตี้', 'livinginsider',
  'thinkofliving', 'baania', 'บาเนีย', 'home.co.th', 'yusabuy', 'ยูสะบายดี', 'propertyhub',
  'naibann', 'ในบ้าน', 'checkraka', 'เช็คราคา', 'homethaidd', 'homenayoo',
  'ศูนย์รวมแบบบ้าน', 'รับสร้างบ้าน', 'แบบบ้าน', 'แปลนบ้าน', 'ไอเดียบ้าน', 'แบบก่อสร้าง',
  'estate', 'เอสเตท', 'baan finder', 'baanfinder', 'lnwshop', 'ขายบ้าน', 'ขายที่ดิน',
  'ประกาศขาย', 'บ้านมือสอง', 'บ้านจัดสรร', 'หมู่บ้าน', 'realtor', 'พร็อพเพอร์ตี้', 'property',
  'shera', 'เฌอร่า', 'scg', 'เอสซีจี', 'cotto', 'ไทวัสดุ', 'thaiwatsadu', 'globalhouse',
  'โกลบอลเฮ้าส์', 'boonthavorn', 'บุญถาวร', 'megahome', 'เมกาโฮม', 'dohome', 'ดูโฮม',
  'trip.com', 'agoda', 'booking.com', 'airbnb', 'traveloka',
];
function isHouseSectionName(src) {
  const low = (src || '').trim().toLowerCase();
  return low.startsWith('บ้าน -') || low.startsWith('บ้าน-');
}
export function isCatalogSource(im) {
  if (!im) return false;
  if (isHouseSectionName(im.source)) return true;
  const hay = `${im.source || ''} ${im.sourceLink || ''}`.toLowerCase();
  return CATALOG_PATTERNS.some((p) => hay.includes(p));
}

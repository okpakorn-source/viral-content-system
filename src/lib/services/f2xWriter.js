// ============================================================
// ✍️ นักเขียน F2X — Fable 5.1 อ่านโพสต์จริงของแอดมินคนเดียวกัน (Nisada · ≥5 ล้าน) แล้วเขียนจากข่าวดิบ → ตรวจข้อเท็จจริง → แก้เฉพาะจุดเกินดิบ → ตรวจซ้ำ
// ★ 29 ต.ค. 69 เจ้าของสั่ง: "F2X สวยฉันอ่านแล้ว เขียนลงระบบจริงเลย"
//   ห้องทดลองในเครื่อง 28–29 ต.ค. (Max/Codex ไม่ใช้ API · 40+ วิธี 9 รอบ) — วัดด้วยการเทียบคู่ "ชิ้นไหนลงเพจแล้วเข้าถึงคนมากกว่า" กับโพสต์จริงของพนักงานบนข่าวดิบเดียวกัน:
//   ข้อสอบเก็บไว้ 12 เรื่อง (โพสต์จริง 5.3–8.5 ล้าน · ไม่เคยใช้ปรับวิธี): F2X ชนะ GPT 54% · Opus 50% · Gemini 50% · ร่างระบบเดิม ~18% ทั้ง 3 ค่าย
//   ข้อสอบ 20 เรื่อง (โพสต์จริง 3.6–4.9 ล้าน): F2X GPT 75% · Opus 68%
//   ตัวที่ทำงาน: ตัวอย่างจากแอดมินคนเดียว (เสียงนิ่ง) + นักเขียน Fable · ไม่มีกฎสไตล์/การ์ด/โครง · ตัดข้อมูลเกินดิบแล้วยังชนะ
// ทำอะไร (ต่อ 1 ฉบับ): จัดหมวดข่าว (GPT-5.6 Sol · ครั้งเดียวต่องาน) → เลือกตัวอย่าง 6 ชิ้น (หมวดเดียวกันยอดสูงสุด ≤4 + ที่เหลือตามยอด ·
//   ตัดโพสต์ที่มีชื่อเฉพาะเดียวกับข่าว · ฉบับที่ 2 ใช้ชุดถัดไปไม่ซ้ำฉบับแรก) → Fable 5.1 เขียน → GPT-5.6 Sol ตรวจข้อมูลที่ไม่มีในข่าวดิบ
//   → มีจุดที่ไม่ใช่ "เบา" = Fable แก้เฉพาะจุด → ตรวจซ้ำ (ยังเหลือ = โยน) → ตัวกรองคำเสี่ยง Facebook (sanitizeOutput เดียวกับนักเขียนหลัก)
//   คำสั่งเขียน/ตรวจ/แก้ทุกตัวอักษร = ตัวที่สอบผ่านในห้องทดลอง (scratchpad mass/methods.mjs · methods6.mjs · judges.mjs)
// ปลอดภัย: สวิตช์ F2X_WRITER=1 เท่านั้นที่เปิด (ค่าเริ่มต้นปิด = ไม่เรียก = ท่อเดิมทุกไบต์)
//   ล้ม/หมดเวลา/ตรวจไม่สำเร็จ/แก้แล้วยังเกินดิบ = โยน error → ผู้เรียก (autoFlowServiceText) ถอยไปนักเขียนเดิมของมุมนั้น
//   งบเวลารวมต่อฉบับ ≤170 วิ (เหลือเวลาให้นักเขียนเดิมในงบมุม 420 วิ) · ด่านหลังเขียนเดิมทำงานครบ (grounding · ความยาว · ป้ายเดาเพศ · ข้อมูลหาย · บก.จัดหน้า)
//   ★ ผู้ตรวจอิสระ 29 ต.ค. FAIL รอบ 1: ป้ายความหนักแปลก → นับเป็นเบา · ไม่ตรวจซ้ำหลังแก้ · ไม่ผ่านตัวกรองคำเสี่ยง · ตัวอย่างคนเดียวกับข่าว · งบเวลา → แก้ทั้งหมดในไฟล์นี้
// ============================================================
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai'; // สร้างตัวเรียกเองแบบเดียวกับ layoutEditor (ไม่ดึง openai.js ทั้งก้อน = กราฟ import ของท่อเพิ่มน้อยสุด)
import { logApiUsage } from '@/lib/ai/usageLogger';
import { sanitizeOutput } from '@/lib/ai/safetyFilter';

export const F2X_WRITER_MODEL = 'claude-fable-5-1';
export const F2X_CHECK_MODEL = 'gpt-5.6-sol';
export const F2X_PRESET_ID = 'f2x';
export const F2X_AUTHOR = 'Nisada Jaraket';
const CLASSIFY_TIMEOUT_MS = 30_000;
export const F2X_TIMEOUTS = Object.freeze({ total: 170_000, write: 90_000, check: 45_000, fix: 60_000, recheck: 45_000, minStep: 10_000 });

export function isF2xWriterEnabled() {
  return String(process.env.F2X_WRITER ?? '').trim().replace(/^["']|["']$/g, '') === '1';
}

// ── ข้อความคำสั่ง (ตรงกับห้องทดลองทุกตัวอักษร) ──
export const F2X_GENRES = ['น้ำดี/ทำความดี', 'สู้ชีวิต', 'อาลัย/สูญเสีย', 'ดราม่า/ขัดแย้ง', 'ความรัก/ครอบครัว', 'คนดัง/บันเทิง', 'ศาสนา/พระ', 'อาชญากรรม/ภัย', 'สัตว์', 'อื่นๆ'];
export const F2X_RULES = `กติกาข้อเท็จจริง (ห้ามละเมิด):
- ใช้ข้อเท็จจริงจากข่าวดิบเท่านั้น ห้ามเติมชื่อ ตัวเลข อายุ วันที่ สถานที่ เหตุการณ์ หรือความรู้สึกของคนในข่าวที่ดิบไม่ได้บอก
- คำพูดในเครื่องหมายคำพูดต้องยกจากดิบตรงตัว (ตัดให้สั้นลงได้ ห้ามแต่งใหม่)
- ถ้าดิบไม่บอกเพศ ห้ามเดาเพศจากชื่อ ใช้ชื่อหรือคำกลางๆ แทน
- ตอบเฉพาะตัวโพสต์ ไม่มีหัวข้อ คำอธิบาย หรือแฮชแท็ก`;
export const F2X_PERSONA = `คุณคือแอดมินเพจข่าวไวรัล "รวมไอจีดารา" ที่เขียนโพสต์เข้าถึงหลายล้านคนเป็นประจำ`;
export const F2X_FACT_SYS = `คุณคือบรรณาธิการตรวจข้อเท็จจริงที่เข้มงวด เทียบโพสต์กับข่าวดิบ
หา "ข้อมูลที่ไม่มีในข่าวดิบ" หรือ "ผิดจากข่าวดิบ": ชื่อ ตัวเลข อายุ วันที่ สถานที่ ความสัมพันธ์ เหตุการณ์/การกระทำที่ดิบไม่ได้บอก คำพูดในเครื่องหมายคำพูดที่ดิบไม่มี (ตัดสั้นลงได้ แต่ห้ามแต่งใหม่) ความรู้สึก/ความคิดของคนในข่าวที่ดิบไม่ได้บอก การเดาเพศที่ดิบไม่ได้บอก
ไม่นับ: ความเห็น/คำชม/คำอวยพรของแอดมินเพจที่เห็นชัดว่าเป็นความเห็น การเรียบเรียงใหม่ที่ความหมายเท่าเดิม
ตอบ JSON เท่านั้น: {"issues":[{"text":"ข้อความในโพสต์","why":"สั้นๆ","severity":"หนัก|เบา"}]} (ไม่มี = [])`;
export const F2X_FIX_SYS = `คุณคือบรรณาธิการตรวจข้อเท็จจริงของเพจ แก้โพสต์ให้ถูกตามข่าวดิบ
- แก้เฉพาะจุดที่ระบุ: ตัดออก หรือเปลี่ยนให้ตรงกับดิบ
- ห้ามแตะส่วนอื่นของโพสต์ ห้ามเพิ่มข้อมูลใหม่
- ตอบเฉพาะโพสต์ที่แก้แล้ว`;
const g0 = (s) => String(s || '').split(/[|/]/)[0].trim();
export const f2xFormatExemplars = (arr) => arr.map((p, i) => `--- ตัวอย่าง ${i + 1} (เข้าถึง ${(p.views / 1e6).toFixed(1)} ล้าน) ---\n${String(p.caption).trim()}`).join('\n\n');
export const f2xWriterSystem = (exemplars) => `${F2X_PERSONA}\nนี่คือโพสต์จริงของเพจที่เข้าถึงหลายล้านคน:\n\n${f2xFormatExemplars(exemplars)}\n\n${F2X_RULES}`;
export const f2xWriterUser = (raw) => `ข่าวดิบ:\n${raw}\n\nเขียนโพสต์ข่าวนี้ 1 ชิ้นสำหรับเพจ ให้อยู่ระดับเดียวกับตัวอย่าง (เข้าถึง 5–10 ล้าน) ความยาวใกล้เคียงตัวอย่าง`;
export const f2xClassifyUser = (raw) => `ข่าวดิบ:\n${raw}\n\nเลือก genre 1 อย่างจาก: ${F2X_GENRES.join(' | ')}\nและ emotion (อารมณ์หลักที่ข่าวนี้ทำให้คนอ่านรู้สึกได้แรงที่สุด 1 คำ)\nตอบ {"genre":"…","emotion":"…"}`;
export const f2xFactUser = (raw, post) => `=== ข่าวดิบ ===\n${raw}\n\n=== โพสต์ ===\n${post}\n=== จบ ===`;
// ข้อความของจุดที่ต้องแก้: ช่อง text ว่าง/ชื่อช่องอื่น = ใช้ช่องที่มี (ผู้ตรวจรอบ 2: {"text":"","why":"เติมอายุ"} เคยหลุด)
const issueText = (x) => String((x && typeof x === 'object' ? (x.text || x.claim || x.quote || x.why) : x) ?? '').trim();
export const f2xFixUser = (raw, post, issues) => `ข่าวดิบ:\n${raw}\n\nโพสต์:\n${post}\n\nจุดที่ไม่มีหรือไม่ตรงในข่าวดิบ:\n${issues.map((x) => `- "${issueText(x)}" (${String(x?.why ?? '').trim()})`).join('\n')}`;

/** แยกจุดที่ต้องแก้: ปลอดภัยไว้ก่อน — จุดไหนไม่ได้ติดป้าย "เบา" ชัดๆ (ป้ายแปลก/ว่าง/ข้อความเปล่า) = ถือว่าหนัก */
export function splitF2xIssues(issues) {
  const list = Array.isArray(issues) ? issues.filter((x) => x != null && (issueText(x) || (typeof x === 'object' && String(x.severity ?? '').trim()))) : [];
  const light = list.filter((x) => typeof x === 'object' && String(x.severity ?? '').trim() === 'เบา');
  return { heavy: list.filter((x) => !light.includes(x)), light };
}
/** ตัดคำนำ/ห่อที่โมเดลแถม ("นี่คือโพสต์ที่แก้แล้ว:" · code fence) — ไม่แตะเนื้อโพสต์ */
export function stripF2xWrapper(text) {
  let t = String(text || '').trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```$/, '').trim();
  const nl = t.indexOf('\n');
  const first = (nl < 0 ? t : t.slice(0, nl)).trim();
  // คำนำ = บรรทัดแรกสั้นที่ "บอกว่าแก้/ปรับแล้ว" และจบด้วยโคลอน · หรือคำนำภาษาอังกฤษ (ผู้ตรวจรอบ 2: ห้ามตัดชื่อคน "แก้วตา …:" / เนื้อข่าว "โพสต์ล่าสุดของ…:")
  if (nl > 0 && first.length <= 80 && ((/[:：]$/.test(first) && /(แก้แล้ว|แก้ไขแล้ว|ปรับแล้ว|ปรับปรุงแล้ว|ฉบับแก้|หลังแก้|ตัดจุดเกินดิบ)/.test(first)) || /^(here is|here's)\b/i.test(first))) t = t.slice(nl + 1).trim();
  return t;
}

// ── คลังตัวอย่าง: โพสต์จริงของแอดมิน Nisada ที่เข้าถึง ≥5 ล้าน (data/f2x-exemplars.json · อ่านด้วย fs → ต้องอยู่ใน outputFileTracingIncludes) ──
let _pool = null;
export function loadF2xPool() {
  if (_pool) return _pool;
  const list = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'f2x-exemplars.json'), 'utf8'));
  _pool = list.filter((p) => p && typeof p.caption === 'string' && p.caption.trim() && Number(p.views) > 0);
  if (_pool.length < 12) throw new Error(`คลังตัวอย่าง F2X มีแค่ ${_pool.length} ชิ้น`);
  return _pool;
}
// คำหายาก (ชื่อเฉพาะ) ในข่าวดิบที่โผล่ในโพสต์ตัวอย่าง = คนเดียวกัน → ไม่ใช้ (วิธีเดียวกับ adminVoiceEditor · ห้องทดลองตัดโพสต์เรื่องเดียวกันไว้แล้ว)
let _seg = null;
const segment = (t) => [...(_seg ||= new Intl.Segmenter('th', { granularity: 'word' })).segment(String(t || ''))];
const wordsOf = (t) => new Set(segment(t).filter((x) => x.isWordLike && x.segment.length >= 2 && !/^\d/.test(x.segment)).map((x) => x.segment));
const _postWords = new WeakMap();
const postWords = (p) => { if (!_postWords.has(p)) _postWords.set(p, wordsOf(p.caption)); return _postWords.get(p); };
const _dfCache = new WeakMap();
// ★ ผู้ตรวจรอบ 2: เกณฑ์ ≤3 โพสต์ของ adminVoice (คลัง 254) เข้มเกินกับคลัง 63 → คำธรรมดา/เศษคำโดนนับเป็นชื่อ ตัวอย่างหมวดเดียวกันหาย
//   ใหม่: คำที่เจอในคลังแค่ 1 โพสต์ และยาว ≥3 ตัวอักษร (ชื่อคน/ชื่อเฉพาะ) · ผู้เรียกมีขั้นต่ำตัวอย่างคงเหลือ (MIN_USABLE)
function rareWords(raw, pool) {
  if (!_dfCache.has(pool)) { const df = new Map(); for (const p of pool) for (const w of postWords(p)) df.set(w, (df.get(w) || 0) + 1); _dfCache.set(pool, df); }
  const df = _dfCache.get(pool);
  return [...wordsOf(raw)].filter((w) => w.length >= 3 && df.get(w) === 1);
}
const MIN_USABLE = 24; // ตัดแล้วเหลือน้อยกว่านี้ = ไม่ตัด (ห้องทดลองเลือกจากคลังเต็ม · กันคุณภาพตกเงียบๆ กับข่าวดิบยาวมาก)
/**
 * เลือกตัวอย่าง k ชิ้น: หมวดเดียวกันยอดสูงสุด ≤4 + ที่เหลือเรียงตามยอด (= oneAuthor ในห้องทดลอง)
 * ตัดโพสต์ที่มีคำหายากเดียวกับข่าว · variant 1 = ชุดถัดไป (ตัดชุดของ variant 0 ออกก่อนเลือก) ให้ 2 ฉบับไม่เขียนจากตัวอย่างชุดเดียวกัน
 */
export function pickF2xExemplars(genre, k = 6, pool = loadF2xPool(), { rawText = '', variant = 0, info = null } = {}) {
  const rare = rawText ? rareWords(rawText, pool) : [];
  const overlap = (p) => rare.reduce((n, w) => n + (postWords(p).has(w) ? 1 : 0), 0);
  const need = Math.min(MIN_USABLE, Math.ceil(pool.length / 2));
  let usable = pool.filter((p) => overlap(p) === 0);
  // ข่าวดิบยาวมาก (ตัดแล้วเหลือน้อย): ผ่อนทีละขั้น — แต่โพสต์ที่ชื่อซ้ำกับข่าวมากที่สุดถูกตัดเสมอ (ผู้ตรวจรอบ 3: เดิมเลิกตัดทั้งก้อน โพสต์คนเดียวกันกลับมา)
  const maxOverlap = rare.length ? Math.max(...pool.map(overlap)) : 0;
  let relaxedTo = 0;
  for (let step = 1; usable.length < need && step < maxOverlap; step++) { usable = pool.filter((p) => overlap(p) <= step); relaxedTo = step; }
  if (usable.length < k) { usable = pool.filter((p) => overlap(p) < maxOverlap); relaxedTo = relaxedTo || 1; } // ยังไม่ครบ k = ตัดแค่กลุ่มชื่อซ้ำมากสุด
  if (usable.length < k) usable = pool; // ทุกโพสต์ชื่อซ้ำเท่ากันหมด (แทบเป็นไปไม่ได้) = ไม่ตัด ดีกว่าเขียนโดยไม่มีตัวอย่าง
  if (info) { info.guardRelaxed = relaxedTo > 0; info.usable = usable.length; }
  const pick = (from) => {
    const key = g0(genre);
    const same = key ? from.filter((p) => g0(p.genre) === key).sort((a, b) => b.views - a.views) : [];
    const rest = from.filter((p) => !same.includes(p)).sort((a, b) => b.views - a.views);
    return [...same.slice(0, 4), ...rest].slice(0, k);
  };
  const first = pick(usable);
  if (!variant) return first;
  const second = pick(usable.filter((p) => !first.includes(p)));
  return second.length >= k ? second : first;
}

// ── ตัวเรียกโมเดล (ฉีดแทนได้ในข้อสอบ) ──
let _anthropic = null;
const anthropic = () => {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ไม่ได้ตั้งค่า');
    _anthropic = new Anthropic({ apiKey, maxRetries: 1 });
  }
  return _anthropic;
};
/** อ่านผล Fable: ตอบไม่จบ (ชนเพดาน/ปฏิเสธ) = โยน · เอาเฉพาะบล็อกข้อความ · ว่าง = โยน */
export function readF2xWriterResponse(res) {
  if (res?.stop_reason === 'refusal' || res?.stop_reason === 'max_tokens') throw new Error(`F2X นักเขียนไม่จบ (${res.stop_reason})`);
  const text = (res?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error('F2X นักเขียนตอบว่าง');
  return text;
}
export async function callF2xWriter({ system, user, signal, feature = 'f2xWrite' }) {
  const res = await anthropic().messages.create({
    model: F2X_WRITER_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], // ส่วนคงที่ไว้ต้น + แคช (กฎเจ้าของ 23 ก.ย. "แคชเสมอ")
    messages: [{ role: 'user', content: user }],
  }, signal ? { signal } : undefined);
  Promise.resolve(logApiUsage({ provider: 'anthropic', model: F2X_WRITER_MODEL, inputTokens: res.usage?.input_tokens || 0, outputTokens: res.usage?.output_tokens || 0, feature })).catch(() => {});
  return readF2xWriterResponse(res);
}
let _openai = null;
const openai = () => {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');
    _openai = new OpenAI({ apiKey, maxRetries: 1 });
  }
  return _openai;
};
export async function callF2xChecker({ system, user, effort = 'medium', signal, feature = 'f2xCheck' }) {
  const res = await openai().chat.completions.create({
    model: F2X_CHECK_MODEL,
    reasoning_effort: effort,
    max_completion_tokens: 8000,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }, signal ? { signal } : undefined);
  Promise.resolve(logApiUsage({ provider: 'openai', model: F2X_CHECK_MODEL, inputTokens: res.usage?.prompt_tokens || 0, outputTokens: res.usage?.completion_tokens || 0, feature })).catch(() => {});
  const t = String(res.choices?.[0]?.message?.content || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('F2X ตัวตรวจตอบไม่เป็น JSON');
  return JSON.parse(t.slice(a, b + 1));
}

// เวลาต่อขั้น: ยกเลิกเมื่อหมดเวลาของขั้น หรือเมื่อตัวแม่ถูกยกเลิก (เส้นตายท่อ) — ไม่จองงบเส้นตายซ้อน
//   รอผลแบบแข่งกับสัญญาณยกเลิก — ตัวเรียกที่ไม่ฟัง signal ก็ไม่ค้างเกินเวลา
async function withStageTimeout(ms, parentSignal, fn, label) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`F2X ${label} หมดเวลา ${Math.round(ms / 1000)} วิ`)), ms);
  const onAbort = () => ac.abort(parentSignal.reason ?? new Error(`F2X ${label} ถูกยกเลิก`));
  if (parentSignal) { if (parentSignal.aborted) onAbort(); else parentSignal.addEventListener('abort', onAbort, { once: true }); }
  let onStageAbort;
  const aborted = new Promise((_, reject) => {
    onStageAbort = () => reject(ac.signal.reason);
    if (ac.signal.aborted) onStageAbort(); else ac.signal.addEventListener('abort', onStageAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => fn(ac.signal)), aborted]); }
  finally {
    clearTimeout(timer);
    ac.signal.removeEventListener('abort', onStageAbort);
    if (parentSignal) parentSignal.removeEventListener('abort', onAbort);
    aborted.catch(() => {});
  }
}

/** จัดหมวดข่าว 1 ครั้งต่องาน (ล้ม = หมวดว่าง = ตัวอย่างยอดสูงสุดแทน · ไม่ทำให้งานล้ม · ตัวแม่ยกเลิก = โยน) */
export async function classifyF2xGenre({ rawText, signal, callChecker = callF2xChecker, timeoutMs = CLASSIFY_TIMEOUT_MS }) {
  try {
    const j = await withStageTimeout(timeoutMs, signal, (s) => callChecker({ system: 'จัดหมวดข่าว ตอบ JSON เท่านั้น', user: f2xClassifyUser(rawText), effort: 'low', signal: s, feature: 'f2xClassify' }), 'จัดหมวด');
    return { genre: String(j?.genre || ''), emotion: String(j?.emotion || ''), ok: true };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { genre: '', emotion: '', ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}

/**
 * เขียน 1 ฉบับแบบ F2X · คืน { text, model, genre, variant, exemplarIds, fixed, heavyIssues, lightIssues, sanitized }
 * โยน error เมื่อเขียน/ตรวจ/แก้ไม่สำเร็จ · แก้แล้วตรวจซ้ำยังเกินดิบ · งบเวลาหมด (ผู้เรียกถอยไปนักเขียนเดิม) — ห้ามส่งฉบับที่ยังไม่ผ่านการตรวจ
 */
export async function writeF2xVersion({ rawText, genreInfo, variant = 0, signal, callWriter = callF2xWriter, callChecker = callF2xChecker, pool, timeouts = {}, now = Date.now }) {
  const T = { ...F2X_TIMEOUTS, ...timeouts };
  const until = now() + T.total;
  const step = (cap, label) => {
    const left = until - now();
    if (left < T.minStep) throw new Error(`F2X งบเวลาหมดก่อนขั้น${label} (เหลือ ${Math.max(0, Math.round(left / 1000))} วิ)`);
    return Math.min(cap, left);
  };
  const raw = String(rawText || '').trim();
  if (raw.length < 20) throw new Error('F2X: ข่าวดิบสั้นเกินไป');
  const pickInfo = {};
  const exemplars = pickF2xExemplars(genreInfo?.genre || '', 6, pool || loadF2xPool(), { rawText: raw, variant, info: pickInfo });
  const check = async (post, label, cap) => {
    const j = await withStageTimeout(step(cap, label), signal, (s) => callChecker({ system: F2X_FACT_SYS, user: f2xFactUser(raw, post), effort: 'medium', signal: s, feature: 'f2xFactCheck' }), label);
    if (!j || !Array.isArray(j.issues)) throw new Error(`F2X: ผล${label}ไม่ครบ`);
    return splitF2xIssues(j.issues);
  };
  const draft = stripF2xWrapper(await withStageTimeout(step(T.write, 'เขียน'), signal, (s) => callWriter({ system: f2xWriterSystem(exemplars), user: f2xWriterUser(raw), signal: s, feature: 'f2xWrite' }), 'เขียน'));
  if (!draft) throw new Error('F2X: ได้โพสต์ว่าง');
  const first = await check(draft, 'ตรวจข้อเท็จจริง', T.check);
  let text = draft;
  if (first.heavy.length) {
    text = stripF2xWrapper(await withStageTimeout(step(T.fix, 'แก้จุดเกินดิบ'), signal, (s) => callWriter({ system: F2X_FIX_SYS, user: f2xFixUser(raw, draft, first.heavy), signal: s, feature: 'f2xFactFix' }), 'แก้จุดเกินดิบ'));
    if (!text) throw new Error('F2X: ได้โพสต์ว่าง');
    if (text.length < draft.length * 0.5) throw new Error(`F2X: ฉบับแก้สั้นผิดปกติ (${text.length}/${draft.length} ตัวอักษร)`);
    const again = await check(text, 'ตรวจซ้ำหลังแก้', T.recheck);
    if (again.heavy.length) throw new Error(`F2X: แก้แล้วยังเกินดิบ ${again.heavy.length} จุด (${again.heavy.map(issueText).join(' · ').slice(0, 120)})`);
  }
  // ตัวกรองคำเสี่ยง Facebook ชุดเดียวกับนักเขียนหลัก/บก.เกลา (ฉบับ F2X ไม่ผ่าน correction ที่มีด่าน L2/L3)
  const clean = sanitizeOutput({ content: text }, { scope: 'post' });
  const finalText = String(clean?.content ?? text).trim();
  if (!finalText) throw new Error('F2X: ได้โพสต์ว่างหลังกรองคำเสี่ยง');
  return { text: finalText, model: F2X_WRITER_MODEL, genre: genreInfo?.genre || '', variant, exemplarIds: exemplars.map((p) => p.id), fixed: first.heavy.length, heavyIssues: first.heavy.map((x) => issueText(x).slice(0, 120)), lightIssues: first.light.length, sanitized: finalText !== text, guardRelaxed: !!pickInfo.guardRelaxed };
}

/** ข้อมูล "การ์ด" ที่ใช้แทนสำหรับฉบับ F2X (ให้บันทึก/บอทแสดงตามจริงว่าไม่ได้ใช้การ์ดคลัง) */
export function f2xPreset(genreInfo) {
  return { id: F2X_PRESET_ID, promptId: F2X_PRESET_ID, name: 'F2X · ตัวอย่างจริงแอดมิน + Fable 5.1', promptName: 'F2X · ตัวอย่างจริงแอดมิน + Fable 5.1', source: 'f2x', promptSource: 'f2x', matchType: 'F2X', matchReason: `หมวด ${genreInfo?.genre || '-'}` };
}

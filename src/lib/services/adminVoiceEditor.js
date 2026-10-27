// ============================================================
// ✍️ ขั้น "บก.เกลาภาษาแอดมิน" (G2) — หลังตรวจแก้ ก่อนด่าน grounding/ความยาว (สาย TEXT เท่านั้น)
// ★ 27 ต.ค. 69 (เจ้าของสั่ง "ถ้าคะแนนนิ่ง ค่อยเอาขึ้นเว็บทำสวิตช์"): ผลห้องทดลอง (ตัววัดคะแนนไวรัลเทียบโพสต์จริง 5–10 ล้าน)
//   ชุดเทส 5 ข่าว: เดิม 66.9 → 76.7 (พนักงาน 78.2) · ข่าวใหม่ 5 ข่าว: 65.7 → 76.3 (พนักงาน 75.0)
//   งานจริงจากดิสคอร์ด 10 ข่าว × 2 รอบ: 64.3 → 73.5 / 72.5 (นิ่ง ต่างกัน 0.9) · ตัวเลข 173/173 ตรงดิบ · คำพูด 24/24 อยู่ในดิบ
// ทำอะไร: (1) เขียนเกลาเป็นภาษาแอดมินเพจ โดยดูโพสต์จริงของเพจ 3 ชิ้นแนวเดียวกับการ์ดที่ใช้ และคุมความยาว ≤ MAX−40 ตัวอักษร
//         (2) ถ้ายังยาวเกิน MAX → บก.ตัดอย่างเดียว สูงสุด 2 รอบ · ทุกรอบถ้าสั้นกว่า 146 คำ (ด่านความยาว) → หยุดที่ฉบับก่อนหน้า
// ปลอดภัย: สวิตช์ ADMIN_VOICE_EDIT=1 เท่านั้นที่เปิด (ค่าเริ่มต้นปิด = ไม่เรียก AI เพิ่ม ไม่แตะเนื้อ) · ล้ม/หมดเวลา/ผลผิดรูป = คืนฉบับเดิมทุกไบต์
//   ไม่แตะ title/provenance (usedModel/_source/_sourceLabel/promptId) · เก็บฉบับก่อนเกลาไว้ใน _preAdminVoiceContent
// ============================================================
// เรียกโมเดลเองแบบ "ข้อความล้วน" (ไม่ผ่าน callClaude ที่บังคับ JSON) — เทสโค้ดตัวขึ้นเว็บ 27 ต.ค.: ห่อ JSON แล้ว 2/10 ฉบับแกะไม่ออก
//   เพราะเนื้อข่าวมีเครื่องหมายคำพูด → ข้อความล้วนแบบเดียวกับห้องทดลอง + กรองคำเสี่ยงชั้นเดียวกับผลนักเขียน (sanitizeOutput scope post) + บันทึกค่าใช้จ่าย
import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from '@/lib/ai/usageLogger';
import { sanitizeOutput } from '@/lib/ai/safetyFilter';
import { withTimeoutSignal } from '@/lib/utils/withTimeout';
import { getActivePipelineDeadline } from '../utils/pipelineDeadline.js'; // ทางเดียวกับ withTimeout.js/claudeClient.js = โมดูลเส้นตายตัวเดียวกันทุกตัวโหลด
import { NEW_LENGTH_CFG } from '@/lib/ai/legacyLengthRules';
import fs from 'fs';
import path from 'path';

// คลังโพสต์ตัวอย่าง: อ่านตอนใช้ครั้งแรก (สวิตช์ปิด = ไม่แตะไฟล์) · แบบเดียวกับ cardEssences.js — ต้องอยู่ใน outputFileTracingIncludes ของ route ท่อข่าว
//   ไฟล์หาย = ไม่มีตัวอย่าง (บก.ยังเกลาภาษา+คุมความยาวได้ ไม่ทำให้งานล้ม)
let _posts = null;
export function loadAdminVoiceExemplars() {
  if (_posts) return _posts;
  try {
    _posts = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'admin-voice-exemplars.json'), 'utf8'));
  } catch (e) {
    console.warn(`[✍️ AdminVoice] ไม่พบคลังโพสต์ตัวอย่าง (data/admin-voice-exemplars.json) — เกลาโดยไม่มีตัวอย่าง: ${e?.message || e}`);
    _posts = [];
  }
  return _posts;
}

export const ADMIN_VOICE_MODEL = 'claude-opus-4-8'; // ตัวเดียวกับที่ผ่านห้องทดลอง (effort medium)
export const ADMIN_VOICE_MAX_CHARS = 800;
export const ADMIN_VOICE_MIN_WORDS = Number(NEW_LENGTH_CFG?.min) || 146; // = ด่านความยาว (ห้ามสั้นกว่าที่ด่านรับ)
const STAGE_TIMEOUT_MS = 150_000; // ทุกฉบับขนานกัน · ต่อฉบับเรียกได้สูงสุด 3 ครั้ง
const MIN_STAGE_MS = 40_000;      // เวลาที่เหลือให้ขั้นนี้น้อยกว่านี้ = ข้าม (ไม่เรียก AI)
// ★ ผู้ตรวจอิสระ 27 ต.ค. (ข้อ 1): ต้องกันเวลาให้ด่านหลังขั้นนี้ — ไม่กัน = งานช้าๆ อาจถูกขั้นนี้กินเวลาจนด่าน RAW เริ่มไม่ได้แล้วงานล้ม
//   ผู้เรียกส่ง reserveMs (ด่าน RAW เปิด = 200s · ปิด = 30s) · ไม่มีเส้นตายรวม (เทส/สคริปต์) = ใช้ timeoutMs ตรงๆ
export const ADMIN_VOICE_DEFAULT_RESERVE_MS = 30_000;

export function isAdminVoiceEditEnabled() {
  return String(process.env.ADMIN_VOICE_EDIT ?? '').trim().replace(/^["']|["']$/g, '') === '1';
}

// ★ ผู้ตรวจอิสระ 27 ต.ค. (ข้อ 2): กฎบ้านที่นักเขียนมีแต่ บก. ไม่มี — ห้ามเดาเพศ · คงชื่อ/ตัวเลข/วันที่/ที่มา (ด่านเพศ/ข้อมูลหายด้านล่างแค่ติดป้าย ไม่แก้เนื้อ)
const SYS_VOICE = `คุณคือแอดมินเพจข่าวไวรัล "รวมไอจีดารา" หน้าที่: เขียนโพสต์ที่ได้รับใหม่ให้เป็นภาษาแอดมินเพจ — ตรง กันเอง ใช้ภาษาคนทั่วไป ไม่ใช่ภาษารายงานข่าวหรือสารคดี
- เปิดด้วยสิ่งที่แรงที่สุดของเรื่อง (ข้อเท็จจริง ความต่าง หรือคำพูดจริง)
- แอดมินชม เห็นใจ หรือสรุปสั้นๆ แบบเพจได้ 1–2 จุด ต้องสมกับข้อเท็จจริงในโพสต์
- ปิดด้วยประโยคหนักๆ 1 ประโยค ไม่เล่าซ้ำสิ่งที่พูดไปแล้ว
- ใช้เฉพาะข้อเท็จจริง ชื่อ ตัวเลข และคำพูดที่มีในโพสต์ ห้ามเพิ่มข้อมูลใหม่ ห้ามใส่ความรู้สึกหรือเจตนาแทนคนในข่าว คำพูดในเครื่องหมายคำพูดต้องคงถ้อยคำเดิม
- คงชื่อ ตัวเลข วันที่ และที่มาของข้อมูลที่สำคัญไว้ · เรียกบุคคลตามที่โพสต์เรียก ห้ามเดาเพศ — ถ้าโพสต์ไม่ระบุเพศ ใช้ชื่อหรือ "เจ้าตัว" แทน เธอ/เขา
- ห้ามเปิดด้วยวันที่ ห้ามตั้งคำถามปิดท้าย · 2–3 ย่อหน้า คั่นด้วยบรรทัดว่าง
ตอบเฉพาะเนื้อโพสต์`;
const SYS_CUT = `คุณคือบรรณาธิการเพจข่าว หน้าที่: ตัดโพสต์ให้สั้นลงโดย "ตัดอย่างเดียว" — ตัดประโยคที่ซ้ำ ประโยคน้ำ และรายละเอียดที่อ่อนที่สุดออกก่อน
คงไว้: ประโยคเปิด ข้อเท็จจริงที่แรงที่สุด คำพูดจริง ประโยคปิด และชื่อ ตัวเลข วันที่ ที่มาของข้อมูลที่สำคัญ · ห้ามเพิ่มข้อมูลหรือถ้อยคำใหม่ ห้ามเปลี่ยนสรรพนามของบุคคล เชื่อมประโยคให้อ่านลื่นได้เท่าที่จำเป็น · คง 2–3 ย่อหน้า คั่นด้วยบรรทัดว่าง
ตอบเฉพาะเนื้อโพสต์ที่ตัดแล้ว`;

let _client = null;
const getClient = () => {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ไม่ได้ตั้งค่า');
    _client = new Anthropic({ apiKey, maxRetries: 1 });
  }
  return _client;
};

/** เรียก บก. 1 ครั้ง → เนื้อโพสต์ (ข้อความล้วน ผ่านตัวกรองคำเสี่ยงแล้ว) */
export async function callAdminVoiceModel({ system, prompt, signal }) {
  const res = await getClient().messages.create({
    model: ADMIN_VOICE_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: prompt }],
  }, signal ? { signal } : undefined);
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(`บก.เกลาไม่จบ (${res.stop_reason})`);
  Promise.resolve(logApiUsage({ provider: 'anthropic', model: ADMIN_VOICE_MODEL, inputTokens: res.usage?.input_tokens || 0, outputTokens: res.usage?.output_tokens || 0, feature: 'adminVoice' })).catch(() => {});
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const clean = sanitizeOutput({ content: text }, { scope: 'post' });
  return String(clean?.content ?? text).trim();
}

let _seg = null; // สร้างตอนใช้ครั้งแรก (สวิตช์ปิด = ไม่สร้าง)
const segment = (t) => [...(_seg ||= new Intl.Segmenter('th', { granularity: 'word' })).segment(String(t || ''))];
export const thaiWordCount = (t) => segment(t).filter((x) => x.isWordLike).length;

// คำหายาก (ชื่อเฉพาะ) ในข่าวดิบที่โผล่ในโพสต์ตัวอย่าง = คนเดียวกัน → ไม่ใช้ (กันนักเขียนหยิบข้อมูลเก่าของคนนั้นมาใส่)
// ★ ผู้ตรวจอิสระ 27 ต.ค. (ข้อ 4): เทียบระดับ "คำ" ไม่ใช่สตริงย่อย (เดิมคำว่า "ร่าง" ไปติดในคำอื่นแล้วตัดโพสต์ทิ้งเกิน) · คำ 2 ตัวอักษร (ชื่อเล่น) นับด้วย
const wordsOf = (t) => new Set(segment(t).filter((x) => x.isWordLike && x.segment.length >= 2 && !/^\d/.test(x.segment)).map((x) => x.segment));
const _postWords = new WeakMap();
const postWords = (p) => { if (!_postWords.has(p)) _postWords.set(p, wordsOf(p.caption)); return _postWords.get(p); };
const docFreq = (posts) => {
  const df = new Map();
  for (const p of posts) for (const w of postWords(p)) df.set(w, (df.get(w) || 0) + 1);
  return df;
};
const _dfCache = new WeakMap();
const rareWords = (raw, posts) => {
  if (!_dfCache.has(posts)) _dfCache.set(posts, docFreq(posts));
  const df = _dfCache.get(posts);
  return [...wordsOf(raw)].filter((w) => (df.get(w) || 0) >= 1 && (df.get(w) || 0) <= 3);
};

/** โพสต์จริง N ชิ้น: ต้นทางของการ์ด → การ์ดหมวดเดียวกันยอดสูงสุด → ยอดสูงสุดทั้งคลัง */
export function pickAdminVoiceExemplars(card, rawText = '', n = 3, posts = loadAdminVoiceExemplars()) {
  const rare = rareWords(rawText, posts);
  const ok = (p) => p && p.caption && !rare.some((w) => postWords(p).has(w));
  const out = [];
  const ownId = String(card?.sourceContentId || '').replace(/^fb_/, '');
  const own = posts.find((p) => p.id === ownId);
  if (ok(own)) out.push(own);
  const byViews = (a, b) => (b.views || 0) - (a.views || 0);
  const same = card?.category ? posts.filter((p) => p.category === card.category && ok(p) && !out.includes(p)).sort(byViews) : [];
  for (const p of same) { if (out.length >= n) break; out.push(p); }
  if (out.length < n) for (const p of posts.filter((q) => ok(q) && !out.includes(q)).sort(byViews)) { if (out.length >= n) break; out.push(p); }
  return out;
}

export function adminVoiceExemplarBlock(posts) {
  if (!posts?.length) return '';
  return [
    '=== 📌 ตัวอย่างโพสต์จริงของเพจ (แนวเดียวกับข่าวนี้ · คนอ่านหลายล้าน) ===',
    'อ่านตัวอย่างเหล่านี้ก่อนเขียน แล้วเขียนข่าวนี้ให้ได้น้ำเสียง ความยาว วิธีเปิด วิธีใช้คำพูดจริง และวิธีปิด ใกล้ตัวอย่างที่สุด',
    'ตัวอย่างเป็นข่าวคนละเรื่อง ห้ามนำชื่อ ตัวเลข เหตุการณ์ หรือประโยคจากตัวอย่างมาใส่ — ข้อเท็จจริงทั้งหมดต้องมาจากข่าวดิบด้านบนเท่านั้น',
    ...posts.map((p, i) => `--- ตัวอย่าง ${i + 1} (เข้าถึง ${((p.views || 0) / 1e6).toFixed(1)} ล้าน) ---\n${String(p.caption).trim()}`),
    '=== จบตัวอย่างโพสต์จริง ===',
  ].join('\n');
}

/** เกลา 1 ฉบับ · คืน { text, steps } — text = ฉบับสุดท้ายที่ผ่านขั้นต่ำ 146 คำ (ไม่ผ่านเลย = ฉบับเดิม) */
export async function editOneAdminVoice({ text, exemplarBlock = '', signal, callModel = callAdminVoiceModel, max = ADMIN_VOICE_MAX_CHARS, minWords = ADMIN_VOICE_MIN_WORDS, onStep }) {
  let cur = String(text || '');
  const steps = [];
  for (let i = 0; i < 3; i++) {
    const voice = i === 0;
    if (!voice && cur.length <= max) break;
    const ask = voice
      ? `เขียนโพสต์นี้ใหม่เป็นภาษาแอดมินเพจ ยาวไม่เกิน ${max - 40} ตัวอักษร (ตอนนี้ ${cur.length} ตัวอักษร)`
      : `ตัดโพสต์นี้ให้เหลือไม่เกิน ${max - 40} ตัวอักษร (ตอนนี้ ${cur.length} ตัวอักษร)`;
    const pre = voice && exemplarBlock ? `${exemplarBlock}\n\nให้ได้น้ำเสียงและจังหวะใกล้ตัวอย่างด้านบน (ใช้เฉพาะข้อเท็จจริงในโพสต์ ห้ามหยิบอะไรจากตัวอย่าง)\n\n` : '';
    const out = String(await callModel({ system: voice ? SYS_VOICE : SYS_CUT, prompt: `${pre}${ask}\n\n${cur}`, signal }) || '').trim();
    const words = thaiWordCount(out);
    steps.push({ kind: voice ? 'voice' : 'cut', in: cur.length, out: out.length, words });
    if (!out || words < minWords) break; // สั้นเกินด่านความยาว → คงฉบับก่อนหน้า
    cur = out;
    onStep?.(cur, steps); // ผู้ตรวจอิสระ 27 ต.ค. (ข้อสังเกต 3): รายงานฉบับล่าสุดที่ผ่าน — หมดเวลาระหว่างรอบตัด ยังได้ฉบับเกลาไว้ใช้
  }
  return { text: cur, steps };
}

/**
 * เกลาทุกฉบับขนานกัน · ไม่โยน error (ขั้นเสริม) — ล้ม/หมดเวลา = คืนฉบับเดิม + คำเตือน
 * @returns {{ versions: object[], applied: number, warning: string|null, summaryLine: string }}
 */
export async function runAdminVoiceEdit(versions, { rawText = '', cards = [], callModel = callAdminVoiceModel, timeoutMs = STAGE_TIMEOUT_MS, reserveMs = ADMIN_VOICE_DEFAULT_RESERVE_MS, minStageMs = MIN_STAGE_MS } = {}) {
  const list = Array.isArray(versions) ? versions : [];
  if (!list.length) return { versions: list, applied: 0, skipped: true, warning: null, summaryLine: '✍️ บก.เกลา: ไม่มีฉบับให้เกลา' };
  // กันเวลาให้ด่านหลังขั้นนี้: เพดาน = min(timeoutMs, เวลาที่เหลือ − reserveMs) · เหลือไม่ถึง minStageMs = ข้ามทั้งขั้น (ไม่เรียก AI)
  const deadline = getActivePipelineDeadline();
  const remaining = deadline?.remainingMs?.();
  const budget = Number.isFinite(remaining) ? Math.min(timeoutMs, remaining - reserveMs) : timeoutMs;
  if (Number.isFinite(remaining) && budget < minStageMs) {
    return { versions: list, applied: 0, skipped: true, warning: null, summaryLine: `⏱️ บก.เกลา: ข้าม — เวลางานเหลือ ${Math.round(remaining / 1000)} วิ (กันไว้ให้ด่านหลัง ${Math.round(reserveMs / 1000)} วิ)` };
  }
  const t0 = Date.now();
  // ★ ผู้ตรวจอิสระ 27 ต.ค. (ข้อ 3): เก็บผลรายฉบับทันทีที่เสร็จ — หมดเวลาทั้งขั้นแล้ว ฉบับที่เสร็จก่อนยังใช้ได้ (เดิมทิ้งหมด)
  const results = new Array(list.length).fill(null);
  let error = null;
  try {
    await withTimeoutSignal((signal) => Promise.all(list.map(async (v, i) => {
      try {
        const card = (cards || []).find((c) => c && v && c.id && c.id === v.promptId) || null;
        const block = adminVoiceExemplarBlock(pickAdminVoiceExemplars(card, rawText));
        const onStep = (text, steps) => { if (!signal?.aborted) results[i] = { ok: true, text, steps: [...steps] }; };
        const r = await editOneAdminVoice({ text: v.content, exemplarBlock: block, signal, callModel, onStep });
        if (!signal?.aborted) results[i] = { ok: true, ...r };
      } catch (e) { results[i] = { ok: false, err: e?.message || String(e) }; }
    })), budget, 'admin_voice');
  } catch (e) { error = e?.message || String(e); }
  let applied = 0; const failed = [];
  const out = list.map((v, i) => {
    const r = results[i];
    if (!r?.ok) { failed.push(`V${i + 1}: ${String(r?.err || error || 'ไม่มีผล').slice(0, 80)}`); return v; }
    if (!r.text || r.text === v.content) return { ...v, _adminVoice: { applied: false, steps: r.steps } };
    applied++;
    return { ...v, content: r.text, _preAdminVoiceContent: v.content, _adminVoice: { applied: true, fromChars: String(v.content || '').length, toChars: r.text.length, steps: r.steps } };
  });
  const ms = Date.now() - t0;
  return {
    versions: out,
    applied,
    warning: failed.length ? `บก.เกลาล้มบางฉบับ — ใช้ฉบับเดิม (${failed.join(' · ')})` : null,
    summaryLine: `✍️ บก.เกลาภาษาแอดมิน: ${applied}/${list.length} ฉบับ · ${Math.round(ms / 1000)} วิ${failed.length ? ` · ล้ม ${failed.length}` : ''}`,
  };
}

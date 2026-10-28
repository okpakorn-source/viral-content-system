// ============================================================
// 📐 ขั้น "บรรณาธิการจัดหน้า" — ขั้นสุดท้ายก่อนบันทึก/ส่งงานให้พนักงาน (สาย TEXT เท่านั้น)
// ★ 28 ต.ค. 69 เจ้าของสั่ง: "เพิ่มระบบบรรณาธิการ ขั้นตอนสุดท้ายก่อนส่งงานให้พนักงาน ให้มีหน้าที่อ่านทำความเข้าใจข่าวก่อนจะประเมินว่า
//   เนื้อข่าวนี้ควรเขียนแบบไหนถึงอ่านง่าย การเว้น การจัดบรรทัด ยกเลิกสามย่อหน้าออก และไม่ฟิกสไตล์ ... เป้าหมายคืออ่านง่ายเข้าใจความหมายได้ดี"
//   ห้องทดลอง (Max · ข่าวจริงดิสคอร์ด 5 ข่าว 10 ฉบับ): กรรมการปิดตา GPT-5.6 Sol เลือกฉบับจัดหน้า 10/10 · อ่านง่าย 6.7→9.0 · เข้าใจชัด 8.2→9.0
//   คะแนนความเหมือนโพสต์ปัง 60.7→54.0 (ถ้อยคำเดียวกันต่อกลับ 3 ย่อหน้า = 60.0 → ตกเพราะรูปแบบ) · เจ้าของดูผลแล้วสั่ง "เปิดใช้จริงในระบบ"
// ทำอะไร: บก. อ่านโพสต์ + ข่าวดิบจนเข้าใจ → ประเมินว่าข่าวนี้ควรวางแบบไหน → เปลี่ยน "ช่องว่างเดิม" เป็นเว้นวรรค/ขึ้นบรรทัด/ขึ้นย่อหน้า
// ปลอดภัย (วางหลังด่านทุกด่าน): รับเฉพาะผลที่ตัวอักษรเหมือนเดิมทุกตัวตามลำดับ และช่องว่างอยู่ตำแหน่งเดิมทุกจุด (เปลี่ยนได้แค่ชนิดช่อง · รอบ 3: อีโมจิ/รวมย่อหน้า/คำรายงานอื่น)
//   แยกได้อย่างเดียว (ห้ามรวมบรรทัด) · ห้ามขึ้นบรรทัดใหม่ต่อจากคำรายงาน (ว่า เผย ระบุ อ้าง …) หรือก่อนวลีบอกที่มา · คำ ≥ ขั้นต่ำด่านความยาว
//   + ผู้เรียกส่ง recheck = รันด่านโค้ด grounding/ข้อมูลหาย/เดาเพศซ้ำกับฉบับจัดแล้ว แย่ลง = ฉบับเดิม · ไม่ผ่าน/ล้ม/หมดเวลา = ฉบับเดิมทุกไบต์
//   ★ ผู้ตรวจอิสระ 28 ต.ค. FAIL รอบ 1 (ด่านเทียบชุดคำปล่อย "ไม่ได้ตั้งใจ"→"ตั้งใจ" · 6 แสน→6 ล้าน · สลับคน) และรอบ 2 (ย้ายช่องว่าง
//     "แม่ไม่ได้ทิ้ง ลูกไปทำงาน"→"ทิ้งลูก\nไปทำงาน" · ย่อหน้าหลัง "ระบุว่า" · เติม "และ" แยกคนเดียวเป็นสองคน · ตัด "และ" จนต่ำกว่า 146 คำ) → ด่านชุดนี้
//   รอบ 3–4: อีโมจิเลื่อนตำแหน่ง · รวมย่อหน้า · คำรายงานอื่น · ตัวล่องหน → นับทีละ code point · แยกได้อย่างเดียว · ข้อความส่งจริงประกอบจากตัวอักษรฉบับเดิม
//   ผู้ตรวจรอบ 4 = PASS มีเงื่อนไข (ความเสี่ยงที่เหลือ เช่นคำรายงานนอกรายการ/คำพูดหลายท่อน ให้เจ้าของรับทราบ · พนักงานตรวจก่อนโพสต์)
//   สวิตช์ LAYOUT_EDIT=1 เท่านั้นที่เปิด (ค่าเริ่มต้นปิด = ไม่เรียก AI ไม่แตะเนื้อ) · เก็บฉบับก่อนจัดไว้ใน _preLayoutContent
// ============================================================
// ตอบเป็นแท็ก ไม่ห่อ JSON — บทเรียน adminVoiceEditor 27 ต.ค.: ห่อ JSON แล้ว 2/10 ฉบับแกะไม่ออกเพราะเนื้อข่าวมีเครื่องหมายคำพูด
import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from '@/lib/ai/usageLogger';
import { withTimeoutSignal } from '@/lib/utils/withTimeout';
import { getActivePipelineDeadline } from '../utils/pipelineDeadline.js'; // ทางเดียวกับ adminVoiceEditor = โมดูลเส้นตายตัวเดียวกัน
import { NEW_LENGTH_CFG } from '@/lib/ai/legacyLengthRules';
import { countPublishableThaiWords } from '@/lib/utils/publishablePostText'; // ตัวนับเดียวกับด่านความยาว

export const LAYOUT_EDIT_MODEL = 'claude-opus-5-5'; // ตัวเดียวกับที่เทสในห้องทดลอง (effort medium)
export const LAYOUT_MIN_WORDS = Number(NEW_LENGTH_CFG?.min) || 146; // = ด่านความยาว
const STAGE_TIMEOUT_MS = 90_000; // ทุกฉบับขนานกัน · ห้องทดลอง 22–30 วิ/ฉบับ
const MIN_STAGE_MS = 35_000;     // เวลาที่เหลือให้ขั้นนี้น้อยกว่านี้ = ข้าม (ไม่เรียก AI)
export const LAYOUT_DEFAULT_RESERVE_MS = 30_000; // กันไว้ให้บันทึกผล/generation log หลังขั้นนี้
const MAX_LINES = 24;            // กันหั่นทุกประโยคเป็นบรรทัดเดียว (ห้องทดลอง 7–13 บรรทัด)

export function isLayoutEditEnabled() {
  return String(process.env.LAYOUT_EDIT ?? '').trim().replace(/^["']|["']$/g, '') === '1';
}

export const SYS_LAYOUT = `คุณคือบรรณาธิการขั้นสุดท้ายของเพจข่าว "รวมไอจีดารา" ก่อนส่งโพสต์ให้พนักงานนำไปลง Facebook
คนอ่านส่วนใหญ่อ่านบนมือถือ เลื่อนผ่านเร็ว เป้าหมายเดียวของคุณคือ โพสต์ต้องอ่านง่าย และคนอ่านเข้าใจความหมายถูกตั้งแต่อ่านรอบแรก

ทำงานสองขั้นตามลำดับ

ขั้น 1 อ่านให้เข้าใจก่อนลงมือ
อ่านโพสต์ทั้งหมด (และข่าวดิบที่แนบไว้เพื่อเข้าใจเรื่อง) จนตอบได้ว่า เรื่องนี้เป็นเรื่องของใคร เกิดอะไรขึ้น ใครทำอะไรกับใคร จุดที่คนอ่านต้องเข้าใจหรือรู้สึกที่สุดอยู่ตรงไหน และในโพสต์ตอนนี้มีตรงไหนที่อ่านแล้วสะดุด ต้องอ่านซ้ำ หรือแยกไม่ออกว่าใครพูดหรือใครทำ

ขั้น 2 ประเมินว่าเนื้อข่าวนี้ควรวางแบบไหนถึงอ่านง่ายที่สุด แล้วจัดใหม่
ไม่มีรูปแบบตายตัว ไม่จำเป็นต้องเป็นสามย่อหน้า จำนวนย่อหน้า ความยาวแต่ละย่อหน้า การขึ้นบรรทัดและการเว้นบรรทัด ให้ตัดสินจากเนื้อหาของข่าวนี้เท่านั้น ข่าวต่างเรื่องจึงออกมาหน้าตาต่างกันได้
แนวคิดประกอบการตัดสินใจ (ไม่ใช่สูตร ใช้เฉพาะที่เข้ากับข่าวนี้):
- ย่อหน้าที่ยาวจนบนมือถือกลายเป็นก้อนตัวหนังสือ ควรแบ่งตามจังหวะของเรื่อง
- เรื่องที่มีลำดับเหตุการณ์หลายช่วง แยกช่วงให้เห็นชัดว่าอะไรเกิดก่อนหลัง
- คำพูดจริงหรือประโยคที่หนักที่สุดของเรื่อง อาจให้อยู่บรรทัดของมันเองเพื่อให้คนอ่านหยุดตรงนั้น
- ตัวเลขหลายตัวที่กองอยู่ในประโยคเดียว แยกให้อ่านทีละตัว
- เรื่องสั้นตรงไปตรงมา ไม่ต้องหั่นถี่ ย่อหน้าน้อยแต่ไหลลื่นก็ได้
- อย่าหั่นทุกประโยคเป็นบรรทัดเดียวจนเรื่องขาดเป็นท่อน

สิ่งที่ทำได้อย่างเดียว
- เปลี่ยนเว้นวรรคที่มีอยู่แล้วในโพสต์ ให้เป็นขึ้นบรรทัดใหม่ หรือเว้นบรรทัดขึ้นย่อหน้าใหม่ (แยกได้อย่างเดียว ห้ามรวมบรรทัดหรือย่อหน้าเดิมเข้าด้วยกัน)

สิ่งที่ห้าม (ระบบตรวจตัวอักษรทุกตัวและช่องว่างทุกจุด ถ้าผิดจะใช้ฉบับเดิมทันที)
- ห้ามเปลี่ยน เพิ่ม ตัด หรือสลับลำดับคำ ตัวอักษร หรือเครื่องหมายใดๆ แม้แต่คำเชื่อม ทุกตัวต้องอยู่ครบตามลำดับเดิม
- ห้ามเว้นวรรคหรือขึ้นบรรทัดตรงจุดที่เดิมติดกันอยู่ และห้ามลบช่องว่างเดิมจนคำติดกัน
- ห้ามแยกผู้พูดออกจากสิ่งที่เขาพูด: ห้ามขึ้นบรรทัดหรือย่อหน้าต่อจากคำรายงาน (ว่า เผย ระบุ อ้าง ยืนยัน เล่า แฉ กล่าว บอก หรือเครื่องหมาย :) และห้ามขึ้นบรรทัดก่อนวลีบอกที่มา (ตามที่ ตามคำ อ้างอิง ข้อมูลจาก) ยกเว้นบรรทัดถัดไปขึ้นต้นด้วยเครื่องหมายคำพูด
- ห้ามใส่หัวข้อ สัญลักษณ์ markdown อีโมจิ หรือแฮชแท็ก
ถ้าเห็นว่าถ้อยคำตรงไหนทำให้สับสน ให้บอกไว้ในแท็ก issues แต่ห้ามแก้เอง

ตอบในรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่นนอกแท็ก
<understanding>เรื่องนี้คืออะไร ใครทำอะไร (1–2 ประโยค)</understanding>
<issues>จุดที่อ่านยากหรือสับสนในฉบับเดิม (สั้นๆ ถ้าไม่มีให้ตอบว่า ไม่มี)</issues>
<layout>เลือกวางแบบไหนเพราะอะไร (1–2 ประโยค)</layout>
<post>
โพสต์ที่จัดใหม่ทั้งโพสต์
</post>`;

let _client = null;
const getClient = () => {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ไม่ได้ตั้งค่า');
    _client = new Anthropic({ apiKey, maxRetries: 1 });
  }
  return _client;
};

/** เรียก บก.จัดหน้า 1 ครั้ง → ข้อความดิบที่มีแท็ก */
export async function callLayoutModel({ system, prompt, signal }) {
  const res = await getClient().messages.create({
    model: LAYOUT_EDIT_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], // คำสั่งคงที่ไว้ต้น + แคช (กฎเจ้าของ 23 ก.ย. "แคชเสมอ")
    messages: [{ role: 'user', content: prompt }],
  }, signal ? { signal } : undefined);
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(`บก.จัดหน้าไม่จบ (${res.stop_reason})`);
  Promise.resolve(logApiUsage({ provider: 'anthropic', model: LAYOUT_EDIT_MODEL, inputTokens: res.usage?.input_tokens || 0, outputTokens: res.usage?.output_tokens || 0, feature: 'layoutEdit' })).catch(() => {});
  return (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

const tag = (text, name) => {
  const m = String(text || '').match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`));
  return m ? m[1].trim() : '';
};

/** แกะคำตอบแท็ก → { understanding, issues, layout, post } · ไม่มีแท็ก post = post ว่าง (ผู้เรียกคืนฉบับเดิม) */
export function parseLayoutReply(text) {
  const s = String(text || '');
  let post = tag(s, 'post');
  if (!post) { const open = s.indexOf('<post>'); if (open >= 0) post = s.slice(open + 6).replace(/<\/post>[\s\S]*$/, '').trim(); }
  return { understanding: tag(s, 'understanding'), issues: tag(s, 'issues'), layout: tag(s, 'layout'), post };
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
/** ตัวขึ้นบรรทัดทุกแบบ (\r U+2028 U+2029 ฯลฯ) → \n · ช่องว่างแบบอื่น (NBSP แท็บ) → ' ' · ตัด BOM · คงตัวล่องหนอื่นไว้ในข้อความส่งจริง (ZWSP/ZWJ มีผลต่อการตัดคำ/อีโมจิ) */
function normalizeBreaks(text) {
  return String(text || '').replace(/\uFEFF/g, '').replace(/\r\n?|[\u2028\u2029\u0085\v\f]/g, '\n').replace(/[^\S\n]/g, ' ');
}

/** เก็บรูปบรรทัด: ช่องว่างมาตรฐาน · ช่องว่างซ้อน → 1 · ตัดช่องว่างหัว/ท้ายบรรทัด · เว้นบรรทัดเกิน 1 บรรทัด → 1 */
export function tidyLayout(text) {
  return normalizeBreaks(text).split('\n').map((l) => l.replace(/ {2,}/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** แยกข้อความเป็นตัวอักษรทีละ code point (ไม่นับช่องว่าง/ตัวล่องหน) + ชนิดช่องระหว่างตัว k กับ k+1: '' | 'space' | 'line' | 'para' */
function charsAndGaps(text) {
  const t = normalizeBreaks(text).replace(INVISIBLE, '').trim();
  const cps = []; const gaps = []; let ws = '';
  for (const ch of t) {
    if (/\s/.test(ch)) { ws += ch; continue; }
    if (cps.length) gaps.push(!ws ? '' : /\n[^\S\n]*\n/.test(ws) ? 'para' : ws.includes('\n') ? 'line' : 'space');
    cps.push(ch); ws = '';
  }
  return { cps, chars: cps.join(''), gaps };
}
const QUOTE_OPEN = /^["“‘'«「]/u;
// ★ ผู้ตรวจอิสระรอบ 3: ขึ้นบรรทัดใหม่ต่อจากคำรายงาน / ก่อนวลีบอกที่มา = ข้อกล่าวหา/ข้ออ้างหลุดจากผู้พูดไปยืนเป็นข้อเท็จจริงของเพจ
// รอบ 4: เพิ่มคำรายงานที่ข่าวบันเทิงใช้บ่อย (ซัด ยัน ลั่น แจง/ชี้แจง โต้ กล่าวหา เปิดใจ โพสต์ ให้สัมภาษณ์)
const SPEAKER_END = /(?:ว่า|เผย|ระบุ|อ้าง|ยืนยัน|ยัน|เล่า|แฉ|กล่าว|กล่าวหา|บอก|ซัด|ลั่น|แจง|โต้|เปิดใจ|โพสต์|ให้สัมภาษณ์|:)$/u;
const SOURCE_START = /^(?:ตามที่|ตามคำ|อ้างอิง|อ้างจาก|จากคำบอกเล่า|ข้อมูลจาก)/u;

/**
 * ด่านโค้ดของขั้นนี้ (ขั้นสุดท้าย = ไม่มีด่านอื่นตรวจซ้ำ) · คืน { ok, reasons[] }
 * ตัวอักษรเหมือนเดิมทุกตัวตามลำดับ · ช่องว่างตำแหน่งเดิมทุกจุด (ไม่เพิ่ม ไม่ลบ) · แยกได้อย่างเดียว ห้ามรวมบรรทัด/ย่อหน้าเป็นเว้นวรรค
 * · ห้ามขึ้นบรรทัดใหม่ต่อจากคำรายงาน (ว่า เผย ระบุ อ้าง … :) เว้นตามด้วยเครื่องหมายคำพูด และก่อนวลีบอกที่มา (ตามที่ อ้างอิง …)
 * · ≤24 บรรทัด · คำ (ตัวนับ ICU ของด่านความยาว) ≥ min(ขั้นต่ำ, คำเดิม) — ตัวล่องหนที่หายเปลี่ยนการนับคำได้
 */
export function checkLayoutEdit(before, after, { minWords = LAYOUT_MIN_WORDS } = {}) {
  const a = tidyLayout(after);
  if (!a) return { ok: false, reasons: ['ว่าง'] };
  const B = charsAndGaps(before), A = charsAndGaps(a);
  const ctx = (cps, k) => `"${cps.slice(Math.max(0, k - 8), k).join('')}|${cps.slice(k, k + 6).join('')}"`;
  if (A.chars !== B.chars) {
    let k = 0; while (k < A.cps.length && A.cps[k] === B.cps[k]) k++;
    return { ok: false, reasons: [`ถ้อยคำเปลี่ยน: เดิม ${ctx(B.cps, k)} → ${ctx(A.cps, k)}`] };
  }
  const reasons = [];
  for (let k = 0; k < B.gaps.length; k++) {
    const gb = B.gaps[k], ga = A.gaps[k];
    if (gb && !ga) { reasons.push(`ลบช่องว่างเดิม ${ctx(B.cps, k + 1)}`); break; }
    if (!gb && ga) { reasons.push(`เว้น/ขึ้นบรรทัดกลางวลี ${ctx(B.cps, k + 1)}`); break; }
    if ((gb === 'line' || gb === 'para') && ga === 'space') { reasons.push(`รวมบรรทัด/ย่อหน้า ${ctx(B.cps, k + 1)}`); break; }
    if (gb === 'space' && (ga === 'line' || ga === 'para')) {
      const tail = B.cps.slice(Math.max(0, k - 14), k + 1).join(''); // ยาวพอสำหรับ "ให้สัมภาษณ์" (11 code point)
      const head = B.cps.slice(k + 1, k + 16).join('');
      if (SPEAKER_END.test(tail) && !QUOTE_OPEN.test(head)) { reasons.push(`ขึ้นบรรทัดแยกผู้พูดกับคำพูด ${ctx(B.cps, k + 1)}`); break; }
      if (SOURCE_START.test(head)) { reasons.push(`ขึ้นบรรทัดแยกข้อความกับที่มา ${ctx(B.cps, k + 1)}`); break; }
    }
  }
  const lines = a.split('\n').filter((l) => l.trim()).length;
  if (lines > MAX_LINES) reasons.push(`บรรทัดมากเกิน (${lines})`);
  const words = countPublishableThaiWords({ content: a });
  if (words < Math.min(minWords, countPublishableThaiWords({ content: String(before || '') }))) reasons.push(`คำลดต่ำกว่าขั้นต่ำ (${words} คำ)`);
  return { ok: reasons.length === 0, reasons };
}

/**
 * ข้อความส่งจริง = ตัวอักษรของฉบับเดิมทุกตัว (รวมตัวล่องหนเดิม) + ชนิดช่องจากฉบับจัด — ใช้หลังด่านผ่านเท่านั้น
 * ★ ผู้ตรวจอิสระรอบ 4 ข้อ 5: ไม่เชื่อสตริงที่โมเดลส่งมา (แทรกตัวล่องหนเพิ่มได้) · ประกอบไม่ได้ (นับช่องไม่ตรง) = null
 */
export function rebuildLayout(before, after) {
  const B = charsAndGaps(before), A = charsAndGaps(tidyLayout(after));
  if (A.chars !== B.chars) return null;
  const segs = normalizeBreaks(before).trim().split(/\s+/);
  const types = A.gaps.filter((_, k) => B.gaps[k]);
  if (segs.length !== types.length + 1 || types.some((t) => !t)) return null;
  const SEP = { space: ' ', line: '\n', para: '\n\n' };
  return segs.reduce((out, seg, i) => (i ? out + SEP[types[i - 1]] + seg : seg), '');
}

/** จัดหน้า 1 ฉบับ · คืน { text, ok, reasons, understanding, issues, layout } — ไม่ผ่านด่าน = text เดิม */
export async function editOneLayout({ text, rawText = '', signal, callModel = callLayoutModel }) {
  const before = String(text || '');
  const reply = await callModel({ system: SYS_LAYOUT, prompt: `ข่าวดิบ (ใช้เพื่อเข้าใจเรื่องเท่านั้น):\n${String(rawText || '').trim()}\n\n=====\nโพสต์ที่ต้องจัด:\n${before}`, signal });
  const parsed = parseLayoutReply(reply);
  // ไม่ผ่าน sanitizeOutput ซ้ำ: ข้อความส่งจริงประกอบจากตัวอักษรของฉบับเดิม (ผ่านตัวกรองคำเสี่ยงของขั้นก่อนแล้ว) — ตัวกรองแก้คำ = ด่านตีตกเปล่าๆ
  const gate = checkLayoutEdit(before, parsed.post);
  const rebuilt = gate.ok ? rebuildLayout(before, parsed.post) : null;
  const reasons = gate.ok && rebuilt === null ? ['ประกอบข้อความจากฉบับเดิมไม่ได้'] : gate.reasons;
  return { text: rebuilt ?? before, ok: rebuilt !== null, reasons, understanding: parsed.understanding, issues: parsed.issues, layout: parsed.layout };
}

const short = (s, n = 400) => String(s || '').slice(0, n);

/**
 * จัดหน้าทุกฉบับขนานกัน · ไม่โยน error (ขั้นเสริม) — ล้ม/หมดเวลา/ไม่ผ่านด่าน = ฉบับเดิม
 * recheck(version, newContent) → string[] เหตุ (ว่าง = ผ่าน) · ผู้เรียกใช้รันด่านโค้ดของท่อซ้ำกับฉบับจัดแล้ว · โยน error = ไม่ผ่าน
 * @returns {{ versions: object[], applied: number, skipped?: boolean, warning: string|null, summaryLine: string }}
 */
export async function runLayoutEdit(versions, { rawText = '', recheck = null, callModel = callLayoutModel, timeoutMs = STAGE_TIMEOUT_MS, reserveMs = LAYOUT_DEFAULT_RESERVE_MS, minStageMs = MIN_STAGE_MS } = {}) {
  const list = Array.isArray(versions) ? versions : [];
  if (!list.length) return { versions: list, applied: 0, skipped: true, warning: null, summaryLine: '📐 บก.จัดหน้า: ไม่มีฉบับให้จัด' };
  const deadline = getActivePipelineDeadline();
  const remaining = deadline?.remainingMs?.();
  const budget = Number.isFinite(remaining) ? Math.min(timeoutMs, remaining - reserveMs) : timeoutMs;
  if (Number.isFinite(remaining) && budget < minStageMs) {
    return { versions: list, applied: 0, skipped: true, warning: null, summaryLine: `⏱️ บก.จัดหน้า: ข้าม — เวลางานเหลือ ${Math.round(remaining / 1000)} วิ (กันไว้ให้บันทึกผล ${Math.round(reserveMs / 1000)} วิ)` };
  }
  const t0 = Date.now();
  const results = new Array(list.length).fill(null); // เก็บรายฉบับทันทีที่เสร็จ — หมดเวลาทั้งขั้นแล้วฉบับที่เสร็จก่อนยังใช้ได้
  let error = null;
  try {
    await withTimeoutSignal((signal) => Promise.all(list.map(async (v, i) => {
      try {
        const r = await editOneLayout({ text: v.content, rawText, signal, callModel });
        if (!signal?.aborted) results[i] = { done: true, ...r };
      } catch (e) { results[i] = { done: false, err: e?.message || String(e) }; }
    })), budget, 'layout_edit');
  } catch (e) { error = e?.message || String(e); }
  let applied = 0; const failed = []; const rejected = [];
  const out = list.map((v, i) => {
    const r = results[i];
    if (!r?.done) { failed.push(`V${i + 1}: ${String(r?.err || error || 'ไม่มีผล').slice(0, 80)}`); return v; }
    const meta = { understanding: short(r.understanding), issues: short(r.issues), layout: short(r.layout) };
    let reasons = r.reasons;
    if (r.ok && r.text !== v.content && typeof recheck === 'function') {
      try { reasons = [...(recheck(v, r.text) || [])]; } catch (e) { reasons = [`ตรวจซ้ำล้ม: ${String(e?.message || e).slice(0, 60)}`]; }
    }
    if (reasons.length) { rejected.push(`V${i + 1}: ${reasons.join(' · ').slice(0, 120)}`); return { ...v, _layoutEdit: { applied: false, reasons, ...meta } }; }
    if (r.text === v.content) return { ...v, _layoutEdit: { applied: false, reasons: ['เหมือนเดิม'], ...meta } };
    applied++;
    return { ...v, content: r.text, _preLayoutContent: v.content, _layoutEdit: { applied: true, fromChars: String(v.content || '').length, toChars: r.text.length, ...meta } };
  });
  const ms = Date.now() - t0;
  return {
    versions: out,
    applied,
    warning: failed.length ? `บก.จัดหน้าล้มบางฉบับ — ใช้ฉบับเดิม (${failed.join(' · ')})` : null,
    summaryLine: `📐 บก.จัดหน้า: ${applied}/${list.length} ฉบับ · ${Math.round(ms / 1000)} วิ${rejected.length ? ` · ไม่ผ่านด่าน ${rejected.length} (${rejected.join(' | ')})` : ''}${failed.length ? ` · ล้ม ${failed.length}` : ''}`,
  };
}

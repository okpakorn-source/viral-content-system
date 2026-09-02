/**
 * ★ เฟส 2 "พรอมต์นักเขียน" (2 ก.ย. 69) — บล็อกกฎใหม่ 3 สวิตช์ + ตัวแตกก้อนใบสั่งเขียนเพื่อแคชพรอมต์ (WRITER_PROMPT_CACHE_V2)
 * ─────────────────────────────────────────────────────────────────────────────
 * ไฟล์นี้ตั้งใจ "ไม่มี import '@/…'" (มีแค่ node:fs/node:path) เพื่อให้เทสดึงใช้ตรงได้ และให้ summarizeServiceText
 * โหลดแบบ dynamic import ในบล็อก try — เทสสตับเดิมที่โหลด summarizeServiceText ด้วย data:/tmp.mjs จึงไม่พัง
 *
 * สวิตช์ (อ่าน "จุดเดียว" ที่ไฟล์นี้ · รับเฉพาะสตริง '1' ตรงตัว · ค่าเริ่มต้นปิดทั้งหมด = ใบสั่งเดิมไบต์ต่อไบต์ · ต้องผ่าน A/B ก่อนเปิด):
 *   WRITER_LENGTH_TARGET_V2   บล็อกความยาวเป้าหมาย 150–190 คำ (ยืดถึง 220 เฉพาะข่าวหลายเหตุการณ์) + ลำดับการตัด + ของห้ามตัด
 *   WRITER_FIDELITY_RULES_V2  บล็อกความซื่อตรง: ห้ามแต่งการกระทำ/ความคิด/ท่าทาง/ความต่าง · ห้ามเดาเพศ/บทบาท · ตีความอารมณ์ ≤ 1 ประโยค/ย่อหน้า
 *   WRITER_VIRAL_RULES_V2     บล็อก "กฎจากโพสต์ปังจริง" อ่านจาก data/writer-viral-rules.json (ไฟล์หาย/พัง/ว่าง = ไม่ใส่บล็อก ไม่ล้มท่อ)
 *   WRITER_PROMPT_CACHE_V2    แตกใบสั่งเขียนเป็น 2 ก้อน [กฎคงที่ cache:true, วัตถุดิบผันตามข่าว] ส่งเป็น promptBlocks ของ callClaude
 *
 * หลักฐานที่ผลักดัน (เพจจริง 1,927 โพสต์): 140–170 คำ ค่ากลาง 15,605 ไลก์ · 170–200 = 11,039 · 200–230 = 7,074 · 230+ ≈ 5–6 พัน
 *   ระบบเขียน 228–296 คำ (ยาวกว่าดิบ 40–60% จากประโยคบรรยายอารมณ์/รายละเอียดแต่ง/สรุปซ้ำ) · ผู้ตรวจ 14 คน: 12/14 ฉบับมีของแต่งเล็ก
 *   ("ไม่ได้ดุ" "นั่งลงคุย" "ไม่ใช่เพื่อซื้อของเล่น") · เดาเพศ/บทบาท ("แม่/เธอ" ทั้งที่ดิบไม่บอก)
 *
 * ⚠️ data/writer-viral-rules.json อ่านด้วย fs (path คำนวณตอนรัน) — บน Vercel ต้องเพิ่มไฟล์นี้ใน outputFileTracingIncludes
 *   ของ next.config.mjs (route /api/auto · /api/auto/process · /api/queue/worker · /api/summarize) ก่อนเปิดสวิตช์ ไม่งั้นบล็อกเงียบหาย
 *   (แบบเดียวกับ viral-likes-real.json — กับดักเดิมรอบ 5) · โค้ดนี้ fail-open: อ่านไม่ได้ = ไม่ใส่บล็อก + console.warn
 *
 * ทะเบียนสวิตช์: src/lib/config/newsSwitches.js (เทส tests/news-switch-registry.test.mjs สแกนไฟล์นี้)
 * เทส: tests/writer-policy-text.test.mjs · tests/writer-prompt-cache-v2.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ไฟล์กฎจากโพสต์ปังจริง (โครง { version, rules: [{ id, text, evidence }] }) — เติมข้อใหม่ได้โดยไม่แตะโค้ด */
export const WRITER_VIRAL_RULES_FILE = 'data/writer-viral-rules.json';

// ── สวิตช์ (รับเฉพาะ '1' ตรงตัว — ค่าอื่นทุกค่า = ปิด) ──
export function isWriterLengthTargetV2On() {
  return process.env.WRITER_LENGTH_TARGET_V2 === '1';
}
export function isWriterFidelityRulesV2On() {
  return process.env.WRITER_FIDELITY_RULES_V2 === '1';
}
export function isWriterViralRulesV2On() {
  return process.env.WRITER_VIRAL_RULES_V2 === '1';
}
export function isWriterPromptCacheV2On() {
  return process.env.WRITER_PROMPT_CACHE_V2 === '1';
}

// ── 1) บล็อกกฎความยาว (WRITER_LENGTH_TARGET_V2) — ภาษาไทย กระชับ · วางในโซน "กฎคงที่" ก่อนคำสั่งเด็ดขาด/JSON และก่อน FINAL RAW AUTHORITY ──
export const WRITER_LENGTH_TARGET_BLOCK = [
  '=== 📏 ความยาวเป้าหมาย (จากโพสต์ปังจริง 1,927 โพสต์) ===',
  '- เป้าหมาย 150–190 คำ (นับคำไทย) — ยืดได้ถึง 220 คำเฉพาะข่าวที่มีหลายเหตุการณ์/ไทม์ไลน์จริงหลายจุด · เกิน 220 คำ = ยาวเกิน (กฎนี้ทับข้อความ "ไม่มีเพดานสูงสุด" ในใบสั่งนี้ · พื้น 146 คำยังคงเดิม)',
  '- หลักฐาน: 140–170 คำ ค่ากลาง 15,605 ไลก์ · 170–200 คำ = 11,039 · 200–230 คำ = 7,074 · 230 คำขึ้นไป ≈ 5–6 พัน — ยิ่งยาวยิ่งตก',
  '- ร่างยาวเกินให้ตัดตามลำดับนี้: ① ประโยคบรรยายอารมณ์/ความเห็นของผู้เขียน → ② รายละเอียดตัวละครรอง → ③ ตัวอย่าง 3 ข้อเหลือ 2 ข้อที่แรงสุด → ④ เบื้องหลังที่ตัดแล้วความหมายไม่เปลี่ยน',
  '- 🔒 ห้ามตัด: ชื่อ ตัวเลข วันที่ คำพูดจริง จุดหักของเรื่อง และผลลัพธ์',
  '- "เล่าให้แน่นขึ้น ไม่ใช่สรุปให้สั้น" — ทุกประโยคที่เหลือต้องให้ข้อมูลใหม่ ห้ามเติมประโยคสรุปซ้ำหรือประโยคบรรยายอารมณ์เพื่อถ่วงความยาว',
  '=== จบความยาวเป้าหมาย ===',
].join('\n');

export function buildLengthTargetBlock() {
  return isWriterLengthTargetV2On() ? WRITER_LENGTH_TARGET_BLOCK : '';
}

// ── 2) บล็อกกฎความซื่อตรง (WRITER_FIDELITY_RULES_V2) — ตัวอย่างต้องห้ามมาจากผู้ตรวจ 14 คน (12/14 ฉบับมีของแต่งเล็ก) ──
export const WRITER_FIDELITY_RULES_BLOCK = [
  '=== 🧷 ความซื่อตรงต่อต้นฉบับ (FIDELITY — บังคับทุกเวอร์ชัน) ===',
  '- ห้ามแต่งการกระทำ ความคิด ท่าทาง หรือ "ความต่าง/การปฏิเสธ" ที่ต้นฉบับไม่ได้บอก — ตัวอย่างต้องห้าม (ผู้ตรวจจับได้จริง 12 จาก 14 ฉบับ): "ไม่ได้ดุ" · "นั่งลงคุย" · "ไม่ใช่เพื่อซื้อของเล่น" · "ไม่ได้ถูกเก็บไว้ในตู้เซฟ แต่…" — ต้นฉบับไม่ได้บอกว่า "ไม่/ไม่ใช่" ห้ามเขียนว่า "ไม่/ไม่ใช่" และต้นฉบับไม่ได้บรรยายท่าทาง ห้ามเสกท่าทาง',
  '- ห้ามเดาเพศ บทบาท หรือความสัมพันธ์: ต้นฉบับไม่ได้ระบุว่าเป็น แม่/พ่อ/ภรรยา/สามี/ลูก หรือ เธอ/เขา ให้ใช้ชื่อตามต้นฉบับ หรือคำกลาง เช่น "เจ้าตัว" "คนในคลิป" "ผู้โพสต์"',
  '- การตีความอารมณ์ทำได้เฉพาะที่อนุมานตรงจากเหตุการณ์ในต้นฉบับ และไม่เกิน 1 ประโยคต่อย่อหน้า — ที่เหลือให้เหตุการณ์และคำพูดจริงเล่าเอง',
  '- ก่อนคืน JSON ให้ไล่ทุกประโยคที่มีคำว่า ไม่ได้/ไม่ใช่/แต่/นั่ง/ยืน/มอง/ยิ้ม/ก้ม/กอด แล้วถามว่าต้นฉบับบอกไว้จริงหรือไม่ — ไม่มีให้ตัดคำหรือประโยคนั้นทิ้ง',
  '=== จบ FIDELITY ===',
].join('\n');

export function buildFidelityRulesBlock() {
  return isWriterFidelityRulesV2On() ? WRITER_FIDELITY_RULES_BLOCK : '';
}

// ── 3) บล็อก "กฎจากโพสต์ปังจริง" (WRITER_VIRAL_RULES_V2) — อ่านไฟล์ด้วย fs แบบเดียวกับ data/viral-likes-real.json ──
/**
 * อ่าน data/writer-viral-rules.json → { version, rules: [{ id, text, evidence }] } เฉพาะข้อที่ text ไม่ว่าง
 * คืน null เมื่ออ่านไม่ได้/JSON พัง/โครงผิด (ผู้เรียกถือว่า "ไม่มีบล็อก") — ห้าม throw ออกไปล้มท่อเขียน
 * @param {{ readFile?: (path: string) => string, cwd?: string }} [opts] ฉีดตัวอ่านไฟล์ได้ (เทส)
 */
export function loadWriterViralRules({ readFile, cwd } = {}) {
  const read = typeof readFile === 'function' ? readFile : (p) => readFileSync(p, 'utf8');
  const filePath = join(cwd || process.cwd(), ...WRITER_VIRAL_RULES_FILE.split('/'));
  let doc;
  try {
    doc = JSON.parse(String(read(filePath) || ''));
  } catch (err) {
    console.warn(`[WriterPolicy] ⚠️ อ่าน ${WRITER_VIRAL_RULES_FILE} ไม่ได้ → ไม่ใส่บล็อกกฎจากโพสต์ปัง (${String(err?.message || err).slice(0, 80)})`);
    return null;
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.rules)) {
    console.warn(`[WriterPolicy] ⚠️ ${WRITER_VIRAL_RULES_FILE} โครงผิด (ต้องมี rules[]) → ไม่ใส่บล็อก`);
    return null;
  }
  const rules = doc.rules
    .filter((rule) => rule && typeof rule === 'object' && typeof rule.text === 'string' && rule.text.trim())
    .map((rule, index) => ({
      id: String(rule.id || `VR-${String(index + 1).padStart(3, '0')}`),
      text: rule.text.trim(),
      evidence: typeof rule.evidence === 'string' ? rule.evidence.trim() : '',
    }));
  return { version: doc.version ?? null, rules };
}

/** แปลงกฎเป็นบล็อกข้อความ — ไม่มีกฎ = '' (ไม่ใส่หัวบล็อกเปล่า) */
export function formatViralRulesBlock(doc) {
  const rules = Array.isArray(doc?.rules) ? doc.rules.filter((rule) => rule?.text) : [];
  if (rules.length === 0) return '';
  const version = doc?.version === null || doc?.version === undefined ? '' : ` v${doc.version}`;
  return [
    `=== 🏆 กฎจากโพสต์ปังจริง (writer-viral-rules${version} · ${rules.length} ข้อ — ยึดตามนี้เหนือความเคยชินของผู้เขียน) ===`,
    ...rules.map((rule, index) => `${index + 1}. ${rule.text}${rule.evidence ? ` — หลักฐาน: ${rule.evidence}` : ''}`),
    '=== จบกฎจากโพสต์ปังจริง ===',
  ].join('\n');
}

export function buildViralRulesBlock(opts = {}) {
  if (!isWriterViralRulesV2On()) return '';
  return formatViralRulesBlock(loadWriterViralRules(opts));
}

/**
 * บล็อกกฎเฟส 2 รวม (ลำดับ: ความยาว → ความซื่อตรง → กฎจากโพสต์ปัง) — สวิตช์ปิดทั้งหมด = '' (ใบสั่งเดิมไบต์ต่อไบต์)
 * ทุกบล็อกลงท้ายด้วยบรรทัดว่างเหมือนหมวดกฎอื่นในใบสั่งเขียน (ผู้เรียกวางไว้ก่อน "✨ คำสั่งเด็ดขาด" + JSON)
 * @param {{ readFile?: (path: string) => string, cwd?: string }} [opts] ส่งต่อให้ loadWriterViralRules
 */
export function buildWriterPolicyBlock(opts = {}) {
  const parts = [buildLengthTargetBlock(), buildFidelityRulesBlock(), buildViralRulesBlock(opts)].filter(Boolean);
  return parts.length ? `${parts.join('\n\n')}\n\n` : '';
}

// ── 4) แตกก้อนใบสั่งเขียนเพื่อแคชพรอมต์ (WRITER_PROMPT_CACHE_V2) ──
/**
 * blocks[0] = ก้อนคงที่ (กฎทั้งหมด + รูปแบบ JSON — ไม่ผันตามข่าว) ติด cache:true → Claude แคชรวม system prompt ที่อยู่ก่อนหน้าด้วย
 * blocks[1] = ก้อนผันตามข่าว = [RAW-first (เมื่อมีเนื้อดิบ)] + วัตถุดิบเดิม (การ์ด/ครู/ประเด็น/ทางการ) + FINAL RAW AUTHORITY ท้ายสุด
 * prompt    = blocks ต่อกันเป็นสตริงเดียว (ตัวสำรอง Sol/preview/log ได้เนื้อเดียวกันทุกไบต์)
 * ข้อแลก (ต้องผ่าน A/B): เนื้อดิบไม่ได้อยู่ "หน้าแรกสุด" ของ user message อีกต่อไป — อยู่หัวก้อนผันตามข่าวถัดจากกฎคงที่
 *   · ⚠️ ผู้ตรวจไขว้ 2 ก.ย. 69 (low — ไม่ใช่บั๊กโค้ด · สวิตช์ปิดอยู่): ข้อความ RAW-first/FINAL ใน summarizeServiceText ยังบรรยายเลย์เอาต์เดิม
 *     ("ก่อนอ่านวัตถุดิบประกอบด้านล่าง" / "กฎการเขียนทั้งหมดด้านล่าง" / "RAW NEWS ที่อยู่ต้นข้อความ") ขณะที่โหมดแคชวางกฎคงที่ไว้เหนือเนื้อดิบ
 *     → เป็นรายการในแผน A/B ของสวิตช์นี้: วัดความซื่อตรงเทียบโหมดปิด และถ้าจะเปิดจริงให้พิจารณาข้อความ RAW/FINAL เวอร์ชันโหมดแคช
 *     ("กฎด้านบน" / "RAW NEWS ในกรอบด้านบน") โดยต้องคงข้อความเดิมไบต์ต่อไบต์เมื่อสวิตช์ปิด (สแนปช็อต tests/writer-prompt-cache-v2.test.mjs)
 * @param {{ constant: string, variable: string, rawSourceText?: string, finalizeRawFirst?: (raw: string, prompt: string) => string }} input
 */
export function splitWriterPromptForCache({ constant = '', variable = '', rawSourceText = '', finalizeRawFirst } = {}) {
  const constantBlock = `${String(constant || '').replace(/^\n+/, '')}\n\n`;
  const supporting = String(variable || '');
  const hasRaw = typeof rawSourceText === 'string' && rawSourceText.length > 0 && typeof finalizeRawFirst === 'function';
  const variableBlock = hasRaw ? String(finalizeRawFirst(rawSourceText, supporting)) : supporting;
  return {
    prompt: constantBlock + variableBlock,
    blocks: [{ text: constantBlock, cache: true }, { text: variableBlock }],
    constantChars: constantBlock.length,
    variableChars: variableBlock.length,
  };
}

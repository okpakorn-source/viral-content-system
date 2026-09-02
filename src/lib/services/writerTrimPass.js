/**
 * ★ เฟส 2 "พรอมต์นักเขียน" (2 ก.ย. 69) — ด่านตัดฉบับยาว (WRITER_TRIM_PASS) · ไฟล์นี้ไม่มี import (เทสดึงใช้ตรง · ผู้เรียกฉีด dependency)
 * ─────────────────────────────────────────────────────────────────────────────
 * ปัญหา: ระบบเขียน 228–296 คำ (ยาวกว่าดิบ 40–60% จากประโยคบรรยายอารมณ์/รายละเอียดแต่ง/สรุปซ้ำ) ขณะที่โพสต์ปังจริง 140–170 คำ
 *   (เพจจริง 1,927 โพสต์: 140–170 คำ ค่ากลาง 15,605 ไลก์ · 230+ ≈ 5–6 พัน)
 * วิธี: ฉบับที่ยาวเกิน maxWords (220) → AI ราคาถูก (luna ผ่าน callAI ที่ผู้เรียกฉีดมา) "ตัดเฉพาะประโยคที่ไม่มีข้อเท็จจริงใหม่
 *   ห้ามแก้ชื่อ/ตัวเลข/คำพูด ให้เหลือ ~target (180) คำ" แล้วตรวจผลด้วย findMissingFacts (src/lib/correction/missingFactsGate.js) เทียบเนื้อดิบ
 * fail-safe (ทิ้งผล ใช้ต้นฉบับ): ข้อเท็จจริงหายเพิ่ม · รายงานข้อเท็จจริงถูกตัด (ตรวจไม่ครบ) · สั้นกว่า minWords (146 = พื้นเผยแพร่) · ไม่สั้นลง · AI ล้ม/ตอบว่าง · หมดเวลา · นับคำไม่ได้
 *   ★ ผู้ตรวจไขว้ 2 ก.ย. 69 (medium): findMissingFacts ค่าเริ่มต้นคืนของหายแค่ 20 รายการ (slice ลำดับ number→date→quote→name→detail) —
 *     ร่างที่ขาดอยู่ก่อน ≥ 21 รายการ (ข่าว URL ตัวเลขเยอะ) ทำให้ชื่อ/คำพูดที่ luna ตัดหายเพิ่มตกนอก 20 อันดับแรก → รับผลทั้งที่ของหาย
 *     แก้: ขอ maxMissing = FACT_CHECK_MAX_MISSING ทั้ง 2 รอบ + ถ้ารายงานยังถูกตัด (truncated) = ตรวจไม่ครบ → ทิ้งผล (reason fact_check_truncated)
 * ทุกฉบับได้ version._trimPass = { before, after, applied, reason } (before/after = จำนวนคำ) · ห้ามแตะ title/provenance (usedModel/promptId/_source)
 * ผู้เรียก (autoFlowServiceText) เช็กสวิตช์ WRITER_TRIM_PASS === '1' ก่อนเรียก — ไฟล์นี้ไม่อ่าน env เอง (สวิตช์ปิด = ไม่ยิงเลย)
 *   ★ ข้อแก้ ① หลังผล A/B (2 ก.ย. 69 · 5 ข่าว × 2 แขน): trim pass ตีกลับ 3/6 เพราะ facts_lost — luna ตัดของสำคัญจริง
 *     (ตัวอย่างที่หาย: "เสียบ้าน" · "วันที่ 1 พ.ย." · สมณศักดิ์ · "เส้นที่ชอบ") → แก้ 3 ชั้นโดยด่านเดิมคงอยู่ทั้งหมด:
 *     1) พรอมต์ได้ "รายการข้อเท็จจริงที่ห้ามหาย" จากต้นฉบับดิบ — ผู้เรียกฉีด extractFacts (= extractSourceFactsDetailed
 *        จาก missingFactsGate — โครง { numbers, dates, quotes, names, details } ทุกชนิดมี .text รวม detail) ·
 *        ไม่ฉีด = ถอยไป findMissingFacts(raw, '') (เนื้อว่าง = ทุกข้อเท็จจริง "หาย" = รายการเต็ม) · ไม่มีทั้งคู่ = ไม่ใส่รายการ — ห้ามล้ม
 *     2) กฎใหม่ในพรอมต์: ห้ามตัดประโยคที่มี คำพูดในเครื่องหมายคำพูด / สมณศักดิ์-ยศ-ตำแหน่ง / วันที่-เวลา / ตัวเลข
 *     3) ด่านกลไกหลังตัด (ไม่พึ่ง AI · ก่อนขั้น findMissingFacts เดิม): หน่วยประโยค/อนุประโยคของข้อความก่อนตัดที่เข้ากติกา
 *        คุ้มครอง (regex ชุดเดียวกับข้อ 2) ต้องยังอยู่ในผลตัดแบบ substring (normalize ช่องว่าง+รูปอัญประกาศ+จุดไข่ปลา)
 *        — หาย = ทิ้งผล reason 'protected_sentence_cut' · หน่วย = ก้อนคำสะสม ≥ TRIM_SENTENCE_MIN_CHARS (แตกที่ช่องว่าง/บรรทัด
 *        — ผู้ตรวจไขว้ 2 ก.ย. 69: นิยามทั้งย่อหน้าแบบแรกคุ้มครอง 84% ของหน่วยจน 3/10 ฉบับตัดอะไรไม่ได้)
 *     ดีบักเพิ่มใน _trimPass: factsListed (จำนวนรายการที่เข้าพรอมต์จริง) · protectedSentences (จำนวนหน่วยคุ้มครอง)
 * เทส: tests/writer-trim-pass.test.mjs
 */

export const TRIM_PASS_DEFAULTS = Object.freeze({
  maxWords: 220, // เกินนี้ถึงยิง
  target: 180, // เป้าหลังตัด (~)
  minWords: 146, // พื้นเผยแพร่ (legacyLengthRules NEW_LENGTH_CFG.min) — ผลสั้นกว่านี้ทิ้ง
  timeoutMs: 25_000,
  rawChars: 6000, // เนื้อดิบที่แนบให้ตัวตัดใช้เทียบ (กันพรอมต์บาน)
});

let _segmenter = null;
let _segmenterTried = false;
/** นับคำไทยสำรอง (Intl.Segmenter · ไม่มี = ประมาณ 4 ตัวอักษร/คำ) — ผู้เรียกจริงฉีด countPublishableThaiWords มาแทน */
export function countThaiWordsDefault(text) {
  if (!_segmenterTried) {
    _segmenterTried = true;
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') _segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    } catch {
      _segmenter = null;
    }
  }
  const clean = String(text || '');
  if (_segmenter) {
    let n = 0;
    for (const s of _segmenter.segment(clean)) if (s.isWordLike) n++;
    return n;
  }
  return Math.max(1, Math.ceil(clean.replace(/\s+/g, '').length / 4));
}

// ── ★ ข้อแก้ ① (2 ก.ย. 69): กติกาประโยคคุ้มครอง — regex ชุดเดียวใช้ทั้งบรรยายในพรอมต์และด่านกลไกหลังตัด ──
/** สมณศักดิ์/ยศ/ตำแหน่ง — ประโยคที่มีคำเหล่านี้ห้ามถูกตัด (สตริง regex เรียงยาวก่อนสั้น กันจับครึ่งคำ) · export ให้เทสตรวจรายการได้ */
export const PROTECTED_TITLE_PATTERNS = Object.freeze([
  // สมณศักดิ์/ตำแหน่งสงฆ์ (จากผล A/B: สมณศักดิ์เป็นของที่ luna ตัดหายจริง)
  'พระครู', 'พระอาจารย์', 'พระมหา', 'พระเทพ', 'หลวงพ่อ', 'หลวงปู่', 'หลวงตา', 'หลวงพี่', 'สมเด็จ', 'เจ้าอาวาส', 'เจ้าคุณ', 'สามเณร',
  // ยศตำรวจ/ทหารแบบย่อ (จุดต้อง escape)
  'พล\\.ต\\.อ\\.', 'พล\\.ต\\.ท\\.', 'พล\\.ต\\.ต\\.', 'พ\\.ต\\.อ\\.', 'พ\\.ต\\.ท\\.', 'พ\\.ต\\.ต\\.', 'ร\\.ต\\.อ\\.', 'ร\\.ต\\.ท\\.', 'ร\\.ต\\.ต\\.',
  'ด\\.ต\\.', 'จ\\.ส\\.ต\\.', 'จ\\.ส\\.อ\\.', 'ส\\.ต\\.อ\\.', 'ส\\.ต\\.ท\\.', 'ส\\.ต\\.ต\\.', 'พล\\.อ\\.', 'พล\\.ท\\.', 'พล\\.ต\\.', 'พ\\.อ\\.', 'พ\\.ท\\.',
  // ตำแหน่งราชการ/ปกครอง/วิชาชีพ
  'นายกรัฐมนตรี', 'นายกเทศมนตรี', 'นายกฯ', 'นายก อบต', 'นายก อบจ', 'รัฐมนตรี', 'ผู้ว่าราชการ', 'ผู้ว่าฯ', 'อธิบดี', 'ปลัด', 'กำนัน', 'ผู้ใหญ่บ้าน',
  'ผอ\\.', 'ผกก\\.', 'ผบช\\.', 'ผบ\\.', 'สารวัตร', 'นพ\\.', 'พญ\\.', 'ทพ\\.', 'ดร\\.', 'รศ\\.', 'ผศ\\.',
]);
/** คำพูดในเครื่องหมายคำพูด (“ ” " ' ‘ ’) */
export const PROTECTED_QUOTE_RE = /[“”"‘’']/u;
export const PROTECTED_TITLE_RE = new RegExp(`(?:${PROTECTED_TITLE_PATTERNS.join('|')})`, 'u');
/** วันที่/เวลา (1 พ.ย. · 12 ม.ค. 68 · 10/8/2569 · เวลา 03.00 น. · ปี 2567) — เลขไทยถูกครอบโดยกติกาตัวเลขอยู่แล้ว */
export const PROTECTED_DATE_RE = new RegExp([
  '\\d{1,2}\\s*(?:ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)',
  '\\d{1,2}[.:]\\d{2}\\s*น\\.',
  'เวลา\\s*\\d',
  '(?:ปี|พ\\.ศ\\.|ค\\.ศ\\.)\\s*\\d{2,4}',
  '\\d{1,2}/\\d{1,2}/\\d{2,4}',
].join('|'), 'u');
export const PROTECTED_NUMBER_RE = /[0-9๐-๙]/u;

/** กติกาคุ้มครองประโยคทั้งชุด — ลำดับ: quote → title → date → number (types ใน listProtectedSentences เรียงตามนี้) */
export const PROTECTED_SENTENCE_RULES = Object.freeze([
  Object.freeze({ type: 'quote', re: PROTECTED_QUOTE_RE }),
  Object.freeze({ type: 'title', re: PROTECTED_TITLE_RE }),
  Object.freeze({ type: 'date', re: PROTECTED_DATE_RE }),
  Object.freeze({ type: 'number', re: PROTECTED_NUMBER_RE }),
]);

/**
 * normalize สำหรับเทียบ substring ของประโยคคุ้มครอง — ใช้ทั้งฝั่งต้นฉบับและฝั่งผลตัด:
 * แปลงเครื่องหมายคำพูด/จุดไข่ปลาให้เป็นรูปเดียว (“ ” „ → " · ‘ ’ → ' · … → ...) แล้วยุบช่องว่างทุกชนิดเหลือตัวเดียว
 * ★ ผู้ตรวจไขว้ 2 ก.ย. 69 (medium): วัดจริง 10 ฉบับ — luna คืน “”→"" ทั้งที่ประโยคครบ ทำ protected_sentence_cut 4/4 ฉบับที่มี “”
 *   (trim เป็นหมัน + เผา AI call) — เทียบผ่านรูป normalize จึงไม่ตีกลับเพราะชนิดอัญประกาศ แต่คำในคำพูดเปลี่ยนยังจับได้
 */
export function normalizeTrimWhitespace(text) {
  return String(text || '')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ความยาวขั้นต่ำของหน่วยประโยค (ตัวอักษร) — สะสมคำถึงเกณฑ์นี้แล้วปิดหน่วย · เศษท้ายบรรทัดที่สั้นกว่าถูกรวมเข้าหน่วยก่อนหน้า */
export const TRIM_SENTENCE_MIN_CHARS = 20;

/**
 * แตกข้อความเป็นหน่วยประโยค/อนุประโยค: ขึ้นบรรทัดใหม่ = ตัดเสมอ · ในบรรทัดใช้ "ช่องว่าง" เป็นขอบเขต (ไทยเขียนติดกันเป็นก้อน
 * ระหว่างช่องว่าง — ไม่มีจุดจบประโยค) โดยสะสมก้อนคำต่อจนหน่วยยาว ≥ TRIM_SENTENCE_MIN_CHARS แล้วปิดหน่วย ·
 * เศษท้ายบรรทัดที่สั้นกว่าเกณฑ์ถูกรวมเข้าหน่วยก่อนหน้า — กัน "28" หรือ "กิโล" เป็นหน่วยเดี่ยวที่เช็ค substring ผ่านง่ายเกิน
 * ★ ผู้ตรวจไขว้ 2 ก.ย. 69 (medium-low): นิยามเดิม (ตัดที่ [.!?…”] เท่านั้น) ให้หน่วย = ทั้งย่อหน้า (median 93–278 ตัวอักษร)
 *   → 84% ของหน่วยถูกคุ้มครอง · 3/10 ฉบับตัดอะไรไม่ได้เลย — นิยามใหม่คุ้มครองแค่อนุประโยคที่มีของจริง ไม่ใช่ทั้งย่อหน้า
 */
export function splitTrimSentences(text) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    const units = [];
    let buffer = '';
    for (const token of line.split(/\s+/)) {
      if (!token) continue;
      buffer = buffer ? `${buffer} ${token}` : token;
      if (buffer.length >= TRIM_SENTENCE_MIN_CHARS) {
        units.push(buffer);
        buffer = '';
      }
    }
    if (buffer) {
      if (units.length > 0) units[units.length - 1] += ` ${buffer}`; // เศษสั้นท้ายบรรทัด → รวมหน่วยก่อนหน้า
      else if (buffer.length >= 2) units.push(buffer);
    }
    out.push(...units);
  }
  return out;
}

/** ประโยค/บรรทัดที่เข้ากติกาคุ้มครอง — คืน [{ text, norm, types }] (norm = ยุบช่องว่างแล้ว ใช้เช็ค substring) */
export function listProtectedSentences(text) {
  const out = [];
  for (const sentence of splitTrimSentences(text)) {
    const types = PROTECTED_SENTENCE_RULES.filter((rule) => rule.re.test(sentence)).map((rule) => rule.type);
    if (types.length > 0) out.push({ text: sentence, norm: normalizeTrimWhitespace(sentence), types });
  }
  return out;
}

/** เพดานรายการข้อเท็จจริงในพรอมต์ — กันพรอมต์บาน (เกินให้บอก "…และอีก N รายการ") */
export const TRIM_FACT_LIST_LIMITS = Object.freeze({ maxItems: 80, maxChars: 3000, maxItemChars: 160 });

/** จัดรายการ [{type, text}] เป็นบรรทัด "- ชนิด|ข้อความ" ภายใต้เพดาน — คืน { lines, listed, omitted } */
export function formatTrimFactList(facts, limits = TRIM_FACT_LIST_LIMITS) {
  const list = Array.isArray(facts) ? facts : [];
  const lines = [];
  let used = 0;
  for (const fact of list) {
    if (lines.length >= limits.maxItems) break;
    const text = normalizeTrimWhitespace(fact?.text).slice(0, limits.maxItemChars);
    if (!text) continue;
    const line = `- ${fact?.type || 'fact'}|${text}`;
    if (used + line.length > limits.maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return { lines, listed: lines.length, omitted: Math.max(0, list.length - lines.length) };
}

/** คำสั่งตัด — ตัดทั้งประโยคหรือคงทั้งประโยคเท่านั้น ห้ามเรียบเรียงใหม่ (ให้ด่านตรวจข้อเท็จจริงจับได้ง่าย) */
export function buildTrimPrompt({ content, before, target, minWords, raw, rawChars = TRIM_PASS_DEFAULTS.rawChars, facts }) {
  const rawText = String(raw || '');
  const rawShown = rawText.length > rawChars ? `${rawText.slice(0, rawChars)}\n…(ตัดแสดง)` : rawText;
  const factList = formatTrimFactList(facts); // ★ ข้อแก้ ①: ไม่มีรายการ = ไม่ใส่หมวด (กติกาคุ้มครองใส่เสมอ)
  return [
    '=== งาน: ตัดฉบับให้กระชับ (TRIM PASS) ===',
    `ข้อความด้านล่างยาว ${before} คำ ต้องเหลือประมาณ ${target} คำ (ห้ามต่ำกว่า ${minWords} คำ)`,
    'กติกา:',
    '- ตัดได้เฉพาะประโยคที่ "ไม่มีข้อเท็จจริงใหม่": ประโยคบรรยายอารมณ์/ความเห็นของผู้เขียน ประโยคสรุปซ้ำใจความเดิม รายละเอียดตัวละครรอง ตัวอย่างที่ซ้ำกัน',
    '- ตัดทั้งประโยค หรือคงไว้ทั้งประโยคเท่านั้น — ห้ามเรียบเรียงใหม่ ห้ามเปลี่ยนคำ ห้ามเติมคำ ในประโยคที่เหลือ',
    '- ห้ามตัดหรือแก้ ชื่อ ตัวเลข วันที่ คำพูดในเครื่องหมายคำพูด จุดหักของเรื่อง และผลลัพธ์',
    '- 🔒 ห้ามตัดประโยคที่มีอย่างใดอย่างหนึ่งต่อไปนี้ และต้องคงประโยคนั้นไว้ตรงตัวทุกคำ: คำพูดในเครื่องหมายคำพูด (“ ” " \' ‘ ’) · สมณศักดิ์/ยศ/ตำแหน่ง (พระครู พระอาจารย์ หลวงพ่อ หลวงปู่ พระมหา สมเด็จ พ.ต.อ. ร.ต.ท. นายก ผอ. ฯลฯ) · วันที่/เวลา (1 พ.ย. · 12 ม.ค. 68 · เวลา 03.00 น. · ปี 2567) · ตัวเลขทุกตัว — ระบบตรวจด้วยเครื่องหลังตัด ถ้าประโยคเหล่านี้หาย ผลจะถูกทิ้งทั้งฉบับ',
    '- คงจำนวนย่อหน้าและลำดับย่อหน้าเดิม (คั่นด้วยบรรทัดว่าง) ห้ามรวมย่อหน้า ห้ามเปลี่ยนประโยคเปิดของย่อหน้าแรก',
    '- ถ้าตัดแล้วข้อเท็จจริงจะหาย ให้คงประโยคนั้นไว้แม้จะยาวเกินเป้า',
    ...(factList.listed > 0 ? [
      '',
      '=== 📌 รายการข้อเท็จจริงที่ห้ามหาย (นับจากต้นฉบับดิบ) ===',
      ...factList.lines,
      ...(factList.omitted > 0 ? [`…และอีก ${factList.omitted} รายการ (ของที่ไม่ได้แสดงก็ห้ามหาย — เทียบกับต้นฉบับดิบด้านล่าง)`] : []),
      '=== จบรายการข้อเท็จจริง ===',
    ] : []),
    'ตอบเป็น JSON เท่านั้น: {"content": "ข้อความหลังตัด"}',
    '',
    '=== ต้นฉบับข่าวดิบ (ใช้เทียบว่าประโยคไหนมีข้อเท็จจริง — ห้ามคัดลอกสำนวนจากนี้) ===',
    rawShown,
    '=== จบต้นฉบับข่าวดิบ ===',
    '',
    '=== ข้อความที่ต้องตัด ===',
    String(content || ''),
    '=== จบข้อความที่ต้องตัด ===',
  ].join('\n');
}

/**
 * ดึงเนื้อจากคำตอบ AI — รับ {content} · สตริง · {versions:[{content}]} · อื่น = ''
 * ★ ผู้ตรวจไขว้ 2 ก.ย. 69 (low · pre-existing): บางทาง callAI คืน JSON ดิบทั้งก้อนเป็นสตริง —
 *   สตริงที่ trim แล้วขึ้นต้น { ให้ลองแกะ .content ก่อน (แกะไม่ได้/ไม่มี content = คืนสตริงเดิมตามพฤติกรรมเก่า)
 */
export function pickTrimmedContent(result) {
  if (typeof result === 'string') {
    const trimmed = result.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.content === 'string') return parsed.content.trim();
      } catch { /* ไม่ใช่ JSON — ใช้สตริงตรงตามเดิม */ }
    }
    return trimmed;
  }
  if (result && typeof result === 'object') {
    if (typeof result.content === 'string') return result.content.trim();
    const first = Array.isArray(result.versions) ? result.versions[0] : null;
    if (first && typeof first.content === 'string') return first.content.trim();
  }
  return '';
}

/** คีย์ของรายการที่หาย (จาก findMissingFacts) — ชนิด|ข้อความ */
export function missingFactKeys(report) {
  const missing = Array.isArray(report?.missing) ? report.missing : [];
  return new Set(missing.map((m) => `${m?.type || ''}|${m?.text || ''}`));
}

/** เพดานเวลาในตัว (ไม่พึ่ง withTimeout ของท่อ — ไฟล์นี้ไม่มี import) · parentSignal ยกเลิก = ยกเลิกตาม */
function runWithTrimTimeout(factory, timeoutMs, parentSignal) {
  if (parentSignal?.aborted) {
    return Promise.reject(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('writer_trim_pass: ถูกยกเลิกก่อนเริ่ม (parent signal aborted)'));
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const onParentAbort = () => { if (ctrl && !ctrl.signal.aborted) ctrl.abort(parentSignal?.reason); };
  if (parentSignal && typeof parentSignal.addEventListener === 'function') parentSignal.addEventListener('abort', onParentAbort, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`TIMEOUT: writer_trim_pass ใช้เวลาเกิน ${Math.round(timeoutMs / 1000)}s (ยกเลิก request แล้ว)`);
      err.failedStep = 'writer_trim_pass';
      if (ctrl && !ctrl.signal.aborted) ctrl.abort(err);
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => factory(ctrl ? ctrl.signal : undefined)), timeout]).finally(() => {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') parentSignal.removeEventListener('abort', onParentAbort);
  });
}

/** เพดานรายการที่หายที่ขอจาก findMissingFacts ทั้ง 2 รอบ — ห้ามใช้ค่าเริ่มต้น 20 ของด่านนั้น (ของที่หายเพิ่มต้องไม่ตกนอกรายการ — ดูหมายเหตุผู้ตรวจไขว้หัวไฟล์) */
export const FACT_CHECK_MAX_MISSING = 10_000;

/**
 * ★ ข้อแก้ ①: แปลงผล extractFacts เป็นรายการ [{ type, text }] — รับได้ 2 ทรง:
 * (ก) array ของ { type, text } ตรงๆ (เช่น missing จาก findMissingFacts) · (ข) object จาก extractSourceFactsDetailed:
 * { numbers, dates, quotes, names, details } — ทุกชนิดมี .text (สตริงล้วนก็รับ) และต้องรวมชนิด detail ด้วย
 */
export function normalizeExtractedFacts(result) {
  if (Array.isArray(result)) {
    return result
      .filter((item) => item && typeof item === 'object' && typeof item.text === 'string' && item.text)
      .map((item) => ({ type: String(item.type || 'fact'), text: item.text }));
  }
  if (!result || typeof result !== 'object') return [];
  const out = [];
  for (const [key, type] of [['numbers', 'number'], ['dates', 'date'], ['quotes', 'quote'], ['names', 'name'], ['details', 'detail']]) {
    for (const item of Array.isArray(result[key]) ? result[key] : []) {
      const text = typeof item === 'string' ? item : item?.text;
      if (typeof text === 'string' && text) out.push({ type, text });
    }
  }
  return out;
}

/**
 * ★ ข้อแก้ ①: รายการข้อเท็จจริงสำหรับพรอมต์ — ลำดับถอย: extractFacts (ฉีดมา) → findMissingFacts(raw, '')
 * (เนื้อว่าง = ทุกข้อเท็จจริง "หาย" = ได้รายการเต็ม) → ไม่มีทั้งคู่/พัง = [] — ห้ามล้มไม่ว่ากรณีใด
 */
export function resolveTrimFactList({ extractFacts, findMissingFacts, raw } = {}) {
  if (!raw) return [];
  try {
    if (typeof extractFacts === 'function') return normalizeExtractedFacts(extractFacts(raw));
    if (typeof findMissingFacts === 'function') {
      const report = findMissingFacts(raw, '', { maxMissing: FACT_CHECK_MAX_MISSING });
      return normalizeExtractedFacts(Array.isArray(report?.missing) ? report.missing : []);
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * ตัดฉบับที่ยาวเกิน — คืน version ใหม่ (ไม่แก้ object เดิม) พร้อม _trimPass เสมอ
 * @param {object} version ร่างจากนักเขียน (ใช้ .content)
 * @param {{
 *   raw?: string, maxWords?: number, target?: number, minWords?: number, timeoutMs?: number, rawChars?: number,
 *   callAI?: Function, model?: string, countWords?: (text: string) => number,
 *   findMissingFacts?: (raw: string, out: string, opts?: { maxMissing?: number }) => { missing: Array<{type: string, text: string}>, truncated?: number },
 *   extractFacts?: (raw: string) => object | Array<{type: string, text: string}>,
 *   signal?: AbortSignal,
 * }} [opts]
 */
export async function trimIfTooLong(version, opts = {}) {
  const {
    raw = '',
    maxWords = TRIM_PASS_DEFAULTS.maxWords,
    target = TRIM_PASS_DEFAULTS.target,
    minWords = TRIM_PASS_DEFAULTS.minWords,
    timeoutMs = TRIM_PASS_DEFAULTS.timeoutMs,
    rawChars = TRIM_PASS_DEFAULTS.rawChars,
    callAI,
    model,
    countWords = countThaiWordsDefault,
    findMissingFacts,
    extractFacts, // ★ ข้อแก้ ①: ผู้เรียกฉีด extractSourceFactsDetailed (ไม่ฉีด = ถอยไป findMissingFacts(raw, ''))
    signal,
  } = opts;
  const base = version && typeof version === 'object' ? version : {};
  const content = typeof base.content === 'string' ? base.content : '';
  const keep = (patch) => ({ ...base, _trimPass: { before: null, after: null, applied: false, reason: '', ...patch } });

  let before;
  try {
    before = countWords(content);
  } catch (err) {
    return keep({ reason: 'count_error', error: String(err?.message || err).slice(0, 120) });
  }
  if (!Number.isFinite(before) || before <= maxWords) return keep({ before, after: before, reason: 'within_max' });
  if (typeof callAI !== 'function') return keep({ before, after: before, reason: 'no_ai' });

  // ★ ข้อแก้ ① (2 ก.ย. 69): เตรียมรายการข้อเท็จจริง (เข้าพรอมต์) + ประโยคคุ้มครอง (ด่านกลไกหลังตัด) — พังส่วนไหนถือว่าไม่มีส่วนนั้น ห้ามล้ม
  let promptFacts = [];
  try {
    promptFacts = resolveTrimFactList({ extractFacts, findMissingFacts, raw });
  } catch {
    promptFacts = [];
  }
  let protectedSentences = [];
  try {
    protectedSentences = listProtectedSentences(content);
  } catch {
    protectedSentences = [];
  }
  const debugInfo = { factsListed: formatTrimFactList(promptFacts).listed, protectedSentences: protectedSentences.length };

  const prompt = buildTrimPrompt({ content, before, target, minWords, raw, rawChars, facts: promptFacts });
  let result;
  try {
    result = await runWithTrimTimeout(
      (requestSignal) => callAI({
        prompt,
        ...(model ? { model } : {}),
        temperature: 0.2,
        maxTokens: 4000,
        ...(requestSignal ? { signal: requestSignal } : {}),
        allowModelFallback: false,
        maxRetries: 0,
      }),
      timeoutMs,
      signal,
    );
  } catch (err) {
    const message = String(err?.message || err);
    const reason = /^TIMEOUT/.test(message) ? 'timeout' : (signal?.aborted ? 'aborted' : 'ai_error');
    return keep({ ...debugInfo, before, after: before, reason, error: message.slice(0, 120) });
  }

  const next = pickTrimmedContent(result);
  if (!next) return keep({ ...debugInfo, before, after: before, reason: 'empty_result' });

  let after;
  try {
    after = countWords(next);
  } catch (err) {
    return keep({ ...debugInfo, before, after: before, reason: 'count_error', error: String(err?.message || err).slice(0, 120) });
  }
  if (!Number.isFinite(after) || after >= before) return keep({ ...debugInfo, before, after, reason: 'not_shorter' });
  if (after < minWords) return keep({ ...debugInfo, before, after, reason: 'too_short' });

  // ★ ข้อแก้ ①: ด่านกลไก (ไม่พึ่ง AI) — ประโยคคุ้มครองของข้อความก่อนตัดต้องยังอยู่ครบแบบ substring ตรงตัว (normalize ช่องว่าง)
  //   ทำก่อนขั้น findMissingFacts เดิมเสมอ (ด่านเดิมคงไว้ทั้งหมด) — จับ luna ตัดประโยคคำพูด/สมณศักดิ์-ยศ/วันที่/ตัวเลขทิ้ง
  const normNext = normalizeTrimWhitespace(next);
  const cutProtected = protectedSentences.filter((s) => !normNext.includes(s.norm));
  if (cutProtected.length > 0) {
    return keep({
      ...debugInfo,
      before,
      after,
      reason: 'protected_sentence_cut',
      cut: cutProtected.slice(0, 3).map((s) => s.text.slice(0, 140)),
    });
  }

  if (typeof findMissingFacts === 'function' && raw) {
    let lost = [];
    let truncated = 0;
    try {
      const factOpts = { maxMissing: FACT_CHECK_MAX_MISSING }; // ขอรายการเต็ม — ค่าเริ่มต้น 20 ของด่านซ่อนของที่หายเพิ่มได้ (ผู้ตรวจไขว้ 2 ก.ย. 69)
      const wasReport = findMissingFacts(raw, content, factOpts); // ของที่นักเขียนทิ้งไปตั้งแต่ร่างแรก — ไม่นับเป็น "หายเพิ่ม"
      const nowReport = findMissingFacts(raw, next, factOpts);
      truncated = (Number(wasReport?.truncated) || 0) + (Number(nowReport?.truncated) || 0);
      const wasMissing = missingFactKeys(wasReport);
      const nowMissing = Array.isArray(nowReport?.missing) ? nowReport.missing : [];
      lost = nowMissing.filter((m) => !wasMissing.has(`${m?.type || ''}|${m?.text || ''}`));
    } catch (err) {
      return keep({ ...debugInfo, before, after, reason: 'fact_check_error', error: String(err?.message || err).slice(0, 120) });
    }
    if (lost.length > 0) {
      return keep({ ...debugInfo, before, after, reason: 'facts_lost', lost: lost.slice(0, 5).map((m) => `${m.type}:${m.text}`) });
    }
    if (truncated > 0) {
      // รายงานถูกตัด = เทียบไม่ครบ ไม่รู้ว่าของที่ตกนอกรายการหายเพิ่มหรือไม่ → fail-safe ทิ้งผล ใช้ต้นฉบับ
      return keep({ ...debugInfo, before, after, reason: 'fact_check_truncated', truncated });
    }
  }

  return { ...base, content: next, _trimPass: { before, after, applied: true, reason: 'trimmed', originalChars: content.length, ...debugInfo } };
}

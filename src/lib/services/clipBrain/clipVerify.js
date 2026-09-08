/**
 * 🔍 clipBrain/clipVerify.js — ผู้ตรวจ: เทียบผลถอดกับ "เฉลยจากคลิป" (26 ส.ค. 69)
 * ==================================================================
 * ของคลิปล้วน · ไม่แตะระบบข่าว · ทุกอย่างอยู่หลังสวิตช์
 *
 * แนวคิด (กุญแจที่พิสูจน์มาแล้ววันนี้): ให้ Gemini ถอด "คำพูดคำต่อคำ + ตัวหนังสือบนจอ"
 * มาเป็นเฉลยก่อน แล้วค่อยเทียบ — เปลี่ยนจาก "ให้ AI เดาว่าตัวเองผิดไหม" เป็น "มีของจริงไว้เทียบ"
 * วิธีนี้จับ "ป๋อ (ณัฐวุฒิ สกิดใจ)" ที่ AI เติมนามสกุลเองได้จริงมาแล้ว (คลิปไม่มีคำว่าสกิดใจเลย)
 *
 * แบ่งงานเป็น 2 ชั้น:
 *   ชั้นโค้ด  — ตรวจสิ่งที่ตรวจด้วยกฎได้แน่นอน (ชื่อ/ตัวเลขไม่มีในเฉลย · ประเด็นหาย · คำเพี้ยน)
 *   ชั้นสมอง — ให้ Codex (คนละค่ายกับคนเขียน) อ่านเทียบเรื่องที่ต้องใช้วิจารณญาณ
 */
import { detectFilterCorruption } from './clipSafeText.js';

export const VERIFY_REV = 'clip-verify-v1-0826';

const norm = (s) => String(s == null ? '' : s).replace(/[\s"'“”‘’()[\]·,.!?—–\-]/g, '');
const THAI_NUM = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };
const toArabic = (s) => String(s).replace(/[๐-๙]/g, (d) => THAI_NUM[d]);

/** พรอมต์ขอเฉลย — คำพูดคำต่อคำ + ตัวหนังสือบนจอ (ตอบเป็นข้อความล้วน อ่านง่าย ตรวจง่าย) */
export const TRUTH_PROMPT = `ถอด "ของจริงในคลิป" ออกมาให้ครบที่สุด เพื่อใช้เป็นเฉลยตรวจงาน

ส่วนที่ 1 — คำพูดคำต่อคำ: เขียนทุกประโยคที่ได้ยินตั้งแต่วินาทีแรกถึงวินาทีสุดท้าย ห้ามสรุป ห้ามย่อ ห้ามข้าม
  ใส่ชื่อผู้พูดนำหน้าเมื่อเปลี่ยนคนพูด · ใส่เวลาเป็นระยะทุกๆ ประมาณ 1 นาที
ส่วนที่ 2 — ตัวหนังสือบนจอ: คัดลอกทุกตัวอักษรที่อ่านได้จากบนจอ (ป้ายชื่อ CG ซับ ชื่อรายการ ข้อความในคลิป) ให้ครบ

🔴 ตอบเป็น JSON บรรทัดเดียวเท่านั้น ห้ามมีคำอธิบายอื่น:
{"transcription":[{"time":"00:00","speaker":"ชื่อผู้พูด","text":"ประโยคที่พูด"}],"onScreenText":["ข้อความบนจอ"]}`;
// ★ 27 ส.ค. 69 — เดิมพรอมต์นี้สั่ง "ตอบข้อความล้วน ห้ามมี JSON" แต่ตัวเรียก Gemini รับเฉพาะ JSON
//   ที่ผ่านมาใช้ได้เพราะ **AI ไม่ทำตามคำสั่ง มันตอบ JSON มาเอง** (ตรวจไฟล์ truth.txt จริงยืนยัน)
//   ถ้าวันไหนมันทำตามจริง เฉลยจะว่าง → การตรวจสอบถูกข้ามแบบเงียบๆ = ได้เนื้อที่ไม่มีใครตรวจโดยไม่มีใครรู้
//   → สั่ง JSON ตรงๆ ตามรูปที่มันตอบอยู่แล้ว = พฤติกรรมเดิม แต่ไม่ฝากชะตาไว้กับความบังเอิญ

/**
 * ชั้นโค้ด — ตรวจสิ่งที่กฎตัดสินได้แน่นอน
 * @param {object} insight ผลถอด (รูปเดียวกับที่เก็บคลัง)
 * @param {string} truth เฉลยจากคลิป
 * @param {object} opts { caption } แคปชั่นต้นทาง (นับเป็นหลักฐานได้ตามกฎโปรเจกต์)
 */
/**
 * 🐞 บั๊ก #4 (จับได้จากการยิงจริง 26 ส.ค.): "คำแทนตามบทบาท" ถูกตีเป็นของงอก
 *   เช่น "ชายที่ร้านก๋วยเตี๋ยว" · "หญิงสาวผู้ดำเนินรายการ" · "พิธีกรหญิง"
 *   คำพวกนี้ **ตั้งใจให้ไม่มีในคลิป** (ใช้แทนเมื่อคลิปไม่บอกชื่อ ตามกฎ IDENTITY_RULES)
 *   เตือนไปก็ผิด และจะทำให้พนักงานเลิกเชื่อธง (บทเรียนเดิม: โปรเจกต์เคยทิ้งธง 2 ตัวเพราะเตือนผิด 21-37%)
 */
const ROLE_RE = /^(ชาย|หญิง|หนุ่ม|สาว|เด็ก|คุณ(ลุง|ป้า|ยาย|ตา|แม่|พ่อ)|ผู้|พิธีกร|เจ้าของ|แม่ค้า|พ่อค้า|นัก|ลูกค้า|พนักงาน|ทีมงาน|คนใน|แขก|ญาติ|เพื่อนบ้าน|ชาวบ้าน|เจ้าหน้าที่|บุคคล)/;
/** คำเชื่อมที่ยังอยู่ในวลีบทบาท ไม่ใช่ชื่อคน (เช่น "ที่ร้าน…" "ในคลิป" "ประจำสน.") */
const ROLE_JOIN_RE = /^(ที่|ใน|ประจำ|ชื่อ|คือ|จาก)/;
/** คำนามที่ไม่ใช่ชื่อคนแน่ๆ — กันเตือนผิดเวลาบทบาทถูกเขียนแยกคำ (เช่น "เจ้าของ ร้านก๋วยเตี๋ยว") */
const NON_NAME_RE = /^(ร้าน|รายการ|ช่อง|คลิป|เพจ|บริษัท|โรงพยาบาล|โรงเรียน|หมู่บ้าน|ชุมชน|จังหวัด|อำเภอ|ตำบล|วัด|ตำรวจ|ทหาร|หมอ|แพทย์|พยาบาล|ครู|อาจารย์|ทนาย|กู้ภัย|ผู้สื่อข่าว|นักข่าว)/;
const isRoleToken = (w) => ROLE_RE.test(w) || ROLE_JOIN_RE.test(w) || NON_NAME_RE.test(w);
/** โทเคนที่หน้าตาเป็น "ชื่อคน" — คำไทยยาว ≥2 ตัว (หรือคำอังกฤษ ≥3) ที่ไม่ใช่คำบทบาท */
const looksLikeName = (w) => !isRoleToken(w) && (/[ก-๙]{2,}/.test(w) || /[A-Za-z]{3,}/.test(w));
const splitTokens = (s) => String(s || '').split(/[()\s/|,]+/).map((w) => w.trim()).filter(Boolean);

/**
 * 🐞 บั๊ก CB-05 (ผู้ตรวจอิสระจับได้ 26 ส.ค.): เดิมเช็ค /ที่|ผู้|ใน|ประจำ/ กับ "ทั้งสตริง"
 *   → "เจ้าหน้าที่ สมชาย ใจดี" มีคำว่า "ที่" อยู่ในคำว่าเจ้าหน้าที่ เลยถูกตีเป็นคำแทนบทบาท
 *     แล้วข้ามการตรวจชื่อทั้งก้อน (ชื่อแต่งหลุดด่าน)
 *   → แก้: ลอกวลีบทบาทส่วนต้นออกก่อน ถ้ายังเหลือโทเคนที่หน้าตาเป็นชื่อคน = ไม่ใช่คำแทน ต้องตรวจกับเฉลย
 */
export const isRolePlaceholder = (s) => {
  const t = String(s || '').trim();
  if (!t) return false;
  if (!ROLE_RE.test(t)) return false;              // ไม่ได้ขึ้นต้นด้วยคำบทบาท = ชื่อคนตรงๆ
  return !splitTokens(t).some(looksLikeName);      // เหลือชื่อคนพ่วงมาด้วยไหม
};

const quoteBody = (quote) => toArabic(norm(String(quote || '')
    .replace(/^[^:：]{0,40}[:：]\s*/, '')          // ตัดชื่อผู้พูดนำหน้า
    .replace(/\s*[-–—]\s*[^-–—]{0,40}$/, '')       // ตัดชื่อผู้พูดต่อท้าย " - ชื่อ"
    .replace(/\([^)]{0,40}\)\s*$/, '')));          // ตัดชื่อผู้พูดในวงเล็บท้าย

/** สัดส่วนตัวอักษรที่อยู่ในท่อนตรงกัน ≥14 ตัว (0–1); ไม่ยืนยันผู้พูดหรือความหมาย */
export function quoteCoverage(quote, T) {
  const s = quoteBody(quote);
  if (s.length < 14) return 0;                     // หลักฐานไม่พอ ไม่ใช่คำพูดที่ยืนยันแล้ว
  const truth = toArabic(norm(T));
  let covered = 0;
  let coveredEnd = 0;
  // เลื่อนทีละตัวเหมือน CB-11; นับ union ของช่วงที่ตรง ไม่บวกทับตัวอักษรเดิม
  for (let i = 0; i + 14 <= s.length; i += 1) {
    if (!truth.includes(s.slice(i, i + 14))) continue;
    covered += i + 14 - Math.max(i, coveredEnd);
    coveredEnd = i + 14;
  }
  return covered / s.length;
}

/** Readiness diagnostics only; never rewrite text or feed factual repair/status.
 * Load metrics only for v2, keeping legacy module-hook fixtures dependency-free.
 * Quote verification is textual coverage, not speaker or factual verification.
 */
export async function assessReadiness(insight, { truth = '' } = {}) {
  const result = { findings: [], stories: [], mainStory: { issues: [] } };
  const doc = insight?.topicsV2;
  if (!doc || doc.schemaVersion !== 2) return result;
  const { countThaiWords, lengthBand, bureaucraticRate, longSentenceCount, crossStoryOverlap, wordRangeLabel } = await import('./topicMetrics.js');
  const list = (v) => Array.isArray(v) ? v : [];
  const text = (v) => typeof v === 'string' ? v : '';
  const fixes = {
    'length-short': `เติมรายละเอียดที่มีหลักฐานให้ครบ${wordRangeLabel()} โดยไม่แต่งข้อมูลเพิ่ม`,
    'length-long': `เรียบเรียงให้กระชับในช่วง${wordRangeLabel()} โดยเก็บสาระสำคัญ`,
    'no-highlight': 'เลือกประโยคไฮไลท์ที่ตรงกับเนื้อเรื่องและหลักฐาน',
    bureaucratic: 'ปรับคำราชการเป็นภาษาที่อ่านเข้าใจง่าย',
    'long-sentence': 'แบ่งประโยคยาวให้ติดตามได้ง่าย โดยคงความหมายเดิม',
    overlap: 'ทบทวนข้อความซ้ำกับเรื่องที่ระบุ และเก็บบริบทเท่าที่จำเป็น',
    'quote-unverified': 'ตรวจคำพูดกับเสียงต้นทางก่อนนำไปใช้',
    'quote-short': 'ตรวจคำพูดสั้นกับเสียงต้นทางด้วยคน',
    'no-facts': 'เพิ่มข้อเท็จจริงพร้อมหลักฐานของประเด็นนี้',
    missing: 'เขียนเรื่องเล่าหลักจากประเด็นและหลักฐานที่มี',
    'main-story-stale': 'ทบทวนเรื่องเล่าหลักให้สอดคล้องกับประเด็นที่แก้แล้ว',
  };
  const add = (issues, where, code, detail, value) => {
    issues.push({ code, detail, ...(value === undefined ? {} : { value }) });
    result.findings.push({ side: 'ความพร้อม', severity: 'ข้อสังเกต', kind: 'ความพร้อมใช้งาน',
      where, detail, fix: fixes[code] });
  };
  const proseIssues = (body, issues, where) => {
    const words = countThaiWords(body);
    const band = lengthBand(words);
    if (band !== 'ok') add(issues, where, `length-${band}`, `มี ${words} คำ ควรมี${wordRangeLabel()}`, words);
    const rate = bureaucraticRate(body);
    if (rate >= 0.8) add(issues, where, 'bureaucratic', `พบคำราชการ ${rate.toFixed(2)} ครั้งต่อ 1,000 ตัวอักษร`, rate);
  };
  const stories = list(doc.stories);
  const overlaps = crossStoryOverlap(stories).pairs;
  stories.forEach((story, i) => {
    const issues = [];
    const where = `topicsV2.stories[${i}]`;
    const body = text(story?.story);
    proseIssues(body, issues, where);
    if (!text(story?.highlight).trim()) add(issues, where, 'no-highlight', 'ยังไม่มีประโยคไฮไลท์');
    const long = longSentenceCount(body, 60);
    if (long) add(issues, where, 'long-sentence', `มี ${long} ประโยคที่ยาวเกิน 60 คำ`, long);
    const id = story?.id ?? i;
    const peers = new Set(overlaps.flatMap((p) => p.a === id ? [p.b] : p.b === id ? [p.a] : []));
    for (const peer of peers) add(issues, where, 'overlap', `พบข้อความที่อาจซ้ำกับเรื่อง ${peer}`, peer);
    list(story?.quotes).forEach((quote, j) => {
      const value = text(quote?.text);
      if (quoteBody(value).length < 14) {
        add(issues, where, 'quote-short', `คำพูดลำดับ ${j + 1} สั้นกว่า 14 ตัวหลังปรับรูป จึงยังยืนยันไม่ได้`, j);
      } else {
        const coverage = quoteCoverage(value, truth);
        if (coverage < 0.6) add(issues, where, 'quote-unverified', `คำพูดลำดับ ${j + 1} ตรงกับเฉลย ${Math.round(coverage * 100)}% ยังยืนยันไม่ได้`, coverage);
      }
    });
    if (!list(story?.facts).some((f) => text(f?.text).trim())) add(issues, where, 'no-facts', 'ยังไม่มีข้อเท็จจริงของประเด็นนี้');
    result.stories.push({ id: story?.id, issues });
  });
  const main = text(insight.mainStory ?? doc.mainStory);
  if (!main.trim()) add(result.mainStory.issues, 'mainStory', 'missing', 'ยังไม่มีเรื่องเล่าหลัก');
  else proseIssues(main, result.mainStory.issues, 'mainStory');
  if (doc.mainStoryStale === true) add(result.mainStory.issues, 'mainStory', 'main-story-stale',
    'ประเด็นหลักถูกแก้แล้ว เรื่องเล่าหลักยังเป็นฉบับเดิม ควรทบทวนความสอดคล้องก่อนนำไปใช้');
  return result;
}

export function checkAgainstTruth(insight, truth, { caption = '', plannedSegments = null } = {}) {
  const findings = [];
  const T = toArabic(norm(truth) + norm(caption));
  const inTruth = (v) => T.includes(toArabic(norm(v)));

  // ① ของงอก — ชื่อคนที่ไม่มีในเฉลย (ไล่ทีละคำ เพราะ "ป๋อ (ณัฐวุฒิ สกิดใจ)" ต้องจับที่ "สกิดใจ")
  for (const raw of (insight?.speakers || [])) {
    if (isRolePlaceholder(raw)) continue;          // 🐞 บั๊ก #4: คำแทนบทบาท ไม่ใช่ของงอก
    const words = String(raw).split(/[()\s/|,]+/).map((w) => w.trim()).filter((w) => w.length > 2);
    const missing = words.filter((w) => /[ก-๙]/.test(w) && !inTruth(w));
    if (missing.length) {
      findings.push({
        kind: 'ของงอก-ชื่อ', severity: 'สูง', where: `ผู้พูด: ${raw}`,
        detail: `ไม่พบในคลิปเลย (ทั้งเสียงและตัวหนังสือบนจอ): ${missing.join(', ')}`,
        fix: 'ตัดส่วนที่ไม่มีหลักฐานออก เหลือเฉพาะชื่อที่คลิปบอกจริง หรือใช้คำแทนตามบทบาท',
      });
    }
  }

  // ② ของงอก — ตัวเลขที่ไม่มีในเฉลย
  const nums = new Set();
  const scanNums = (txt) => { for (const m of String(txt || '').matchAll(/\d[\d,.]*/g)) if (m[0].replace(/\D/g, '').length >= 2) nums.add(m[0]); };
  scanNums(insight?.rawData);
  (insight?.subStories || []).forEach((s) => scanNums(s?.rawData));
  for (const n of nums) {
    if (!T.includes(n.replace(/[,.]/g, ''))) {
      findings.push({
        kind: 'ของงอก-ตัวเลข', severity: 'กลาง', where: `ตัวเลข ${n}`,
        detail: 'ไม่พบตัวเลขนี้ในคำพูดหรือบนจอ (อาจคำนวณเองหรือจำผิด)',
        fix: 'ตรวจกับคลิปว่ามีจริงไหม ถ้าไม่มีให้ตัดออก',
      });
    }
  }

  // ③ คำพูดในเครื่องหมายคำพูดต้องมีในเฉลย (ยอมให้เพี้ยนเล็กน้อยได้)
  const allQuotes = [...(insight?.quotes || []), ...(insight?.subStories || []).flatMap((s) => s?.quotes || [])];
  for (const q of allQuotes) {
    const short = quoteBody(q).length < 14;
    const coverage = quoteCoverage(q, T);
    if (short || coverage < 0.6) {
      findings.push({
        kind: short ? 'คำพูดสั้นตรวจไม่ได้' : (coverage >= 0.3 ? 'คำพูดตรงบางส่วน' : 'คำพูดไม่ตรงคลิป'),
        severity: short ? 'ต่ำ' : (coverage >= 0.3 ? 'กลาง' : 'สูง'),
        where: `"${String(q).slice(0, 55)}"`, coverage,
        detail: short ? 'คำพูดสั้นกว่า 14 ตัวหลังปรับรูป จึงยังยืนยันด้วยตัวตรวจโค้ดไม่ได้'
          : `พบท่อนตรงกันครอบคลุม ${Math.round(coverage * 100)}% ของคำพูด ยังยืนยันทั้งประโยคไม่ได้`,
        fix: short ? 'ตรวจคำพูดสั้นกับเสียงต้นทาง' : 'แก้ให้ตรงคำที่พูดจริง หรือเลิกใส่เครื่องหมายคำพูด',
      });
    }
  }

  // ④ ของหาย — ประเด็นใน timeline ที่ไม่ถูกเขียนถึงในเนื้อเลย
  // 🐞 บั๊ก #4c: เดิมเตือนแม้ประเด็นนั้นอยู่ใน "ช่วงที่แผนตั้งใจข้าม" (เช่นไฮไลท์เปิดรายการ)
  //   และเดิมไม่ดูว่ามีประเด็นย่อยครอบช่วงเวลานั้นอยู่แล้วหรือเปล่า → เตือนเกินจริง
  const body = norm(String(insight?.rawData || '') + (insight?.subStories || []).map((s) => s?.rawData || '').join(''));
  const parseRangeSec = (txt) => {
    const m = String(txt || '').match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\D+(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const a = (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
    const b = (m[4] ? +m[4] * 3600 : 0) + +m[5] * 60 + +m[6];
    return b > a ? [a, b] : null;
  };
  const subRanges = (insight?.subStories || []).map((s) => parseRangeSec(s?.timeRange)).filter(Boolean);
  const planned = Array.isArray(plannedSegments) ? plannedSegments.map((s) => [s.startSec, s.endSec]) : null;
  const overlaps = (r, list) => !!list && list.some(([a, b]) => Math.min(b, r[1]) - Math.max(a, r[0]) > 5);

  for (const tl of (insight?.timeline || [])) {
    const topic = String(tl?.topic || '');
    const keys = topic.split(/[\s/,·]+/).filter((w) => w.length >= 4 && /[ก-๙]/.test(w));
    if (!keys.length) continue;
    if (keys.some((k) => body.includes(norm(k)))) continue;      // เขียนถึงแล้ว
    const r = parseRangeSec(tl?.time);
    if (r && overlaps(r, subRanges)) continue;                    // มีประเด็นย่อยครอบช่วงนี้อยู่แล้ว
    const skippedByPlan = r && planned && !overlaps(r, planned);
    findings.push({
      kind: 'ของหาย-ประเด็น',
      severity: skippedByPlan ? 'กลาง' : 'สูง',
      where: `${tl?.time || '?'} ${topic}`,
      detail: skippedByPlan
        ? 'อยู่ในช่วงที่แผนตั้งใจข้าม (เช่น ไฮไลท์เปิดรายการ) — ตรวจว่าข้ามได้จริงไหม'
        : 'ตาเห็นประเด็นนี้ แต่ไม่มีในเนื้อที่เขียนเลย',
      fix: 'เพิ่มประเด็นนี้เข้าเนื้อ หรือระบุว่าข้ามเพราะอะไร',
    });
  }

  // ⑤ คำเพี้ยนจากตัวกรองคำ (ของที่ผ่านเส้นทางเดิมมา)
  const cor = detectFilterCorruption(JSON.stringify(insight || {}));
  if (cor.corrupted) {
    findings.push({
      kind: 'คำเพี้ยน', severity: 'สูง', where: cor.sample,
      detail: 'พบร่องรอยคำถูกแทนกลางคำจนความหมายเสีย',
      fix: 'แก้กลับเป็นคำเดิมตามบริบท',
    });
  }

  // ⑥ ครอบคลุมคลิปแค่ไหน
  const dur = Number(insight?.clipDurationSec || 0);
  let coverage = null;
  if (dur > 0 && (insight?.timeline || []).length) {
    const secs = [];
    for (const tl of insight.timeline) {
      const m = String(tl?.time || '').match(/(\d{1,2}):(\d{2})/g);
      if (m) for (const x of m) { const [a, b] = x.split(':').map(Number); secs.push(a * 60 + b); }
    }
    if (secs.length) coverage = Math.min(100, Math.round((Math.max(...secs) / dur) * 100));
    if (coverage !== null && coverage < 80) {
      findings.push({
        kind: 'ดูไม่ถึงท้ายคลิป', severity: 'กลาง', where: `ครอบคลุม ~${coverage}%`,
        detail: `แผนที่ประเด็นหยุดที่ ~${coverage}% ของความยาวคลิป`,
        fix: 'ตรวจช่วงท้ายคลิปว่ามีเนื้อที่ตกหล่นไหม',
      });
    }
  }

  const high = findings.filter((f) => f.severity === 'สูง').length;
  return {
    rev: VERIFY_REV,
    verdict: high ? 'ต้องตรวจ' : (findings.length ? 'มีข้อสังเกต' : 'สะอาด'),
    findings: findings.map((f) => ({ ...f, side: 'ความจริง' })),
    stats: { truthChars: String(truth || '').length, coverage, quotesChecked: allQuotes.length, timelineChecked: (insight?.timeline || []).length },
  };
}

/** พรอมต์ให้ผู้ตรวจ (Codex) อ่านเทียบเรื่องที่ต้องใช้วิจารณญาณ */
export function buildReviewPrompt({ insight, truth, caption = '', codeFindings = [] }) {
  return `คุณคือผู้ตรวจงานข่าว — ตรวจว่า "ผลถอดคลิป" ตรงกับ "เฉลยจากคลิป" หรือไม่
⛔ ตัดสินจากเฉลยเท่านั้น ห้ามใช้ความรู้นอกคลิปมาเติมหรือมาแก้ต่างให้
ตอบเป็น JSON บรรทัดเดียว ห้ามมีข้อความอื่น

รูปแบบ: {"verdict":"สะอาด|มีข้อสังเกต|ต้องตรวจ","findings":[{"kind":"ของงอก|ของหาย|คำพูดไม่ตรง|เขียนเฟ้อ|ซอยประเด็นเทียม|อื่นๆ","severity":"สูง|กลาง|ต่ำ","where":"ชี้จุดให้ชัด","detail":"อธิบายสั้นๆ","fix":"ควรแก้ยังไง"}],"note":"สรุปสั้น 1 บรรทัด"}

สิ่งที่ต้องดู:
1. ของงอก — ข้อเท็จจริง/ชื่อ/ตัวเลข/สถานที่ ที่ไม่มีในเฉลย (อันตรายที่สุด)
2. ของหาย — เรื่องสำคัญในเฉลยที่ไม่ถูกเขียนถึงเลย
3. คำพูดในเครื่องหมายคำพูด ต้องตรงคำที่พูดจริง
4. เขียนเฟ้อ — ใส่การตีความ/อารมณ์ที่คลิปไม่ได้บอก (เช่น "ด้วยน้ำเสียงสั่นเครือ" ถ้าเฉลยไม่ได้ระบุ)
5. ซอยประเด็นเทียม — คลิปมีเรื่องเดียวแต่ถูกซอยเป็นหลายประเด็นโดยไม่มีเหตุผล หรือประเด็นซ้ำกันเอง
ถ้าไม่พบปัญหาจริง ให้ตอบ verdict "สะอาด" และ findings เป็น [] — **ห้ามหาเรื่องติเพื่อให้ดูขยัน**

${codeFindings.length ? `หมายเหตุ: ตัวตรวจอัตโนมัติชี้ไว้แล้ว ${codeFindings.length} จุด (ดูซ้ำได้ แต่ไม่ต้องรายงานซ้ำถ้าเห็นตรงกัน):\n${codeFindings.map((f) => `- [${f.kind}] ${f.where}`).join('\n')}\n` : ''}
=== แคปชั่นต้นทาง ===
${String(caption || '(ไม่มี)').slice(0, 500)}
แคปชั่นส่วนนี้มาจากต้นทางเท่านั้น; headline ในผลถอดเป็นข้อความที่ AI สร้างและต้องตรวจ ห้ามใช้เป็นหลักฐาน

=== เฉลยจากคลิป (คำพูดคำต่อคำ + ตัวหนังสือบนจอ) ===
${String(truth || '').slice(0, 60000)}

=== ผลถอดที่ต้องตรวจ ===
${JSON.stringify({
    headline: insight?.headline, overview: insight?.overview, speakers: insight?.speakers,
    rawData: insight?.rawData, quotes: insight?.quotes,
    subStories: (insight?.subStories || []).map((s) => ({ topic: s.topic, timeRange: s.timeRange, rawData: s.rawData, quotes: s.quotes })),
    timeline: insight?.timeline,
  }, null, 1).slice(0, 60000)}`;
}

/**
 * 🐞 บั๊ก #9 (จับได้ 26 ส.ค. — ตัวซ่อมหมดเวลาทั้ง 300 และ 600 วินาที):
 *   ต้นเหตุคือส่ง "เฉลยทั้งก้อน 38,000 ตัว + ผลถอดทั้งใบ + 11 จุด" ให้ AI ซ่อมทีเดียว
 *   ทางแก้ที่ราก: **ของงอกประเภทชื่อ ไม่ต้องใช้ AI เลย** — โค้ดตัดส่วนที่ไม่มีหลักฐานออกได้เอง
 *   เหลือเฉพาะเรื่องที่ต้องใช้วิจารณญาณจริงถึงส่งให้ AI (พรอมต์เล็กลงมาก)
 *
 * ตัดเฉพาะ "คำที่ไม่มีในเฉลย" ออกจากชื่อผู้พูด — เก็บส่วนที่มีหลักฐานไว้
 *   "พลอย รัญดภา" → "พลอย"   ·   "อาร์ม โอฮานา" → "อาร์ม"
 *   ถ้าตัดแล้วไม่เหลืออะไรเลย → แทนด้วยคำกลาง "บุคคลในคลิป" ทั้งใบ (ไม่มีหลักฐานสักส่วน)
 *
 * 🐞 บั๊ก CB-07 (ผู้ตรวจอิสระ 26 ส.ค.): เดิมกรณี "ตัดทิ้งทั้งชื่อ" ลบออกจาก speakers อย่างเดียว
 *   ไม่สร้างรายการแทนที่ → ชื่อแต่งยังค้างใน headline/overview/rawData/subStories
 *   แต่ log บอกว่าซ่อมแล้ว → แก้: กวาดแทนที่ทุกช่องข้อความ และถ้ายังเหลือให้รายงาน unresolved
 */
export const NAME_PLACEHOLDER = 'บุคคลในคลิป';
const DUP_PLACEHOLDER_RE = new RegExp(`${NAME_PLACEHOLDER}(\\s*${NAME_PLACEHOLDER})+`, 'g');

/**
 * 🐞 บั๊ก CB-07 รอบสอง (ผู้ตรวจอิสระ 26 ส.ค.): ตัวกวาดชื่อเดิม String() ทับทุกอย่างที่เจอ
 *   พิสูจน์แล้ว: repairFabricatedNames({speakers:['สมชาย'],keyPoints:[{point:'ประเด็นเดิม'}]},'สมชาย')
 *   คืน keyPoints[0] === '[object Object]' — ข้อมูลเดิมพังทั้งที่ไม่มีชื่อให้ซ่อมสักตัว
 * → แก้: เดินเฉพาะ "ใบที่เป็นสตริง" · object/array คงรูปเดิมทุกคีย์ · ของที่ไม่ใช่สตริงไม่แตะเลย
 */
const MAX_WALK_DEPTH = 8;
/** ออบเจกต์ธรรมดาเท่านั้นที่สร้างใหม่ได้อย่างปลอดภัย — Date/Map/คลาสอื่นห้ามแปลงรูป */
const isPlainObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};
/** เก็บ "ใบสตริง" ทั้งหมดจากค่าใดๆ (ใช้ตรวจว่ากวาดชื่อครบจริงไหม แม้ชื่อซ่อนใน keyPoint แบบออบเจกต์) */
function collectStrings(v, sink, depth = 0, seen = new Set()) {
  if (typeof v === 'string') { sink.push(v); return; }
  if (!v || typeof v !== 'object' || depth >= MAX_WALK_DEPTH || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) for (const x of v) collectStrings(x, sink, depth + 1, seen);
  else if (isPlainObject(v)) for (const k of Object.keys(v)) collectStrings(v[k], sink, depth + 1, seen);
  seen.delete(v);                                  // เช็คเฉพาะ "วงบนเส้นทางเดิม" ไม่ใช่ของซ้ำที่เป็นพี่น้องกัน
}

export function repairFabricatedNames(insight, truth, { caption = '' } = {}) {
  const T = toArabic(norm(truth) + norm(caption));
  const inTruth = (v) => T.includes(toArabic(norm(v)));
  const changes = [];
  const ops = [];                                  // งานซ่อมแบบโครงสร้าง (ไม่ต้องอ่านย้อนจากข้อความ changes)
  const speakers = [];
  for (const raw of (insight?.speakers || [])) {
    const s = String(raw);
    if (isRolePlaceholder(s)) { speakers.push(s); continue; }
    const words = splitTokens(s);
    // คำบทบาท (เช่น "เจ้าหน้าที่") เก็บไว้เสมอ — ไม่ใช่ชื่อ ไม่ต้องมีในเฉลย
    const kept = words.filter((w) => isRoleToken(w) || w.length <= 2 || !/[ก-๙]/.test(w) || inTruth(w));
    if (kept.length === words.length) { speakers.push(s); continue; }
    const keptSet = new Set(kept);
    const dropped = [...new Set(words.filter((w) => !keptSet.has(w)))];
    const fixed = kept.join(' ').trim();
    if (fixed) {
      speakers.push(fixed);
      ops.push({ from: s, to: fixed, dropped, mode: 'ตัดบางส่วน' });
      changes.push(`"${s}" → "${fixed}" (ตัดส่วนที่ไม่มีในคลิป)`);
    } else {
      speakers.push(NAME_PLACEHOLDER);
      ops.push({ from: s, to: NAME_PLACEHOLDER, dropped, mode: 'ตัดทั้งชื่อ' });
      changes.push(`"${s}" → "${NAME_PLACEHOLDER}" (ไม่มีหลักฐานในคลิปเลย)`);
    }
  }
  const uniq = [...new Set(speakers)];

  // กวาดชื่อที่ไม่มีหลักฐานออกจากเนื้อทุกช่อง
  const swap = (txt) => {
    let o = String(txt == null ? '' : txt);
    for (const op of ops) o = o.split(op.from).join(op.to);                 // ชื่อเต็มก่อน
    for (const op of ops) {                                                 // แล้วค่อยไล่โทเคนกรณีตัดทั้งชื่อ
      if (op.mode !== 'ตัดทั้งชื่อ') continue;
      for (const w of op.dropped) if (w.length >= 3 && /[ก-๙]/.test(w)) o = o.split(w).join(op.to);
    }
    return o.includes(NAME_PLACEHOLDER) ? o.replace(DUP_PLACEHOLDER_RE, NAME_PLACEHOLDER) : o;
  };
  // เดินเฉพาะใบสตริง — object/array คงรูป (keyPoint แบบ {point,detail} ต้องออกมาเป็น {point,detail} เหมือนเดิม)
  const swapDeep = (v, depth = 0, seen = new Set()) => {
    if (typeof v === 'string') return swap(v);
    if (!v || typeof v !== 'object') return v;             // null/undefined/ตัวเลข/บูลีน — คืนตามเดิม ไม่แปลงเป็นสตริง
    if (depth >= MAX_WALK_DEPTH || seen.has(v)) return v;   // ลึกเกิน/วนเป็นวง — คืนของเดิมดีกว่าพัง
    seen.add(v);
    let o;
    if (Array.isArray(v)) o = v.map((x) => swapDeep(x, depth + 1, seen));
    else if (!isPlainObject(v)) o = v;
    else {
      o = {};
      // เขียนผ่าน defineProperty — คีย์ '__proto__' จะได้ไม่ไปโดน setter ของ prototype
      for (const k of Object.keys(v)) {
        Object.defineProperty(o, k, { value: swapDeep(v[k], depth + 1, seen), enumerable: true, writable: true, configurable: true });
      }
    }
    seen.delete(v);
    return o;
  };
  const out = {
    ...insight,
    speakers: uniq,
    headline: swapDeep(insight?.headline),
    overview: swapDeep(insight?.overview),
    rawData: swapDeep(insight?.rawData),
    directLead: swapDeep(insight?.directLead),
    quotes: swapDeep(insight?.quotes),
    keyPoints: swapDeep(insight?.keyPoints),
    subStories: (insight?.subStories || []).map((s) => (s && typeof s === 'object'
      ? { ...s, topic: swapDeep(s.topic), rawData: swapDeep(s.rawData), directLead: swapDeep(s.directLead), quotes: swapDeep(s.quotes), keyPoints: swapDeep(s.keyPoints) }
      : s)),
  };

  // ตรวจว่ากวาดครบจริงไหม — ยังเหลือ = ห้ามรายงานว่าซ่อมครบ
  // เก็บใบสตริงแบบลงลึก เพราะชื่อแต่งอาจซ่อนอยู่ใน keyPoint แบบ {point,detail} ไม่ใช่สตริงตรงๆ
  const bodySink = [];
  for (const v of [out.headline, out.overview, out.rawData, out.directLead, out.quotes, out.keyPoints]) collectStrings(v, bodySink);
  for (const s of (out.subStories || [])) {
    if (!s || typeof s !== 'object') continue;
    for (const v of [s.topic, s.rawData, s.directLead, s.quotes, s.keyPoints]) collectStrings(v, bodySink);
  }
  const bodyAll = bodySink.join('\n');
  const seen = new Set();
  const unresolved = [];
  for (const op of ops) {
    for (const w of op.dropped) {
      if (w.length < 3 || !/[ก-๙]/.test(w) || seen.has(w)) continue;
      if (!bodyAll.includes(w)) continue;
      seen.add(w);
      unresolved.push({ name: w, from: op.from, why: 'ยังค้างในเนื้อหลังกวาดชื่อ — ต้องให้คนหรือตัวซ่อมดูต่อ' });
    }
  }
  return { insight: out, changes, ops, unresolved };
}

/** เลือกข้อความต้นฉบับรอบหลักฐานของแต่ละ finding; งบรวมเครื่องหมายคั่นช่วงด้วย */
export function selectTruthForFindings(truth, findings, { maxChars = 12000, window = 600 } = {}) {
  const text = String(truth || '');
  const cap = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 12000;
  const radius = Number.isFinite(window) ? Math.max(0, Math.floor(window)) : 600;
  if (text.length <= cap) return text;
  if (!cap) return '';
  const separator = '\n…\n';
  const fallback = () => {
    if (cap <= separator.length) return text.slice(0, cap);
    const budget = cap - separator.length;
    const head = Math.ceil(budget / 2);
    return text.slice(0, head) + separator + text.slice(text.length - (budget - head));
  };

  // เก็บตำแหน่งกลับไปยังต้นฉบับ เพื่อค้นแบบไม่สนช่องว่าง/เลขไทย แต่ไม่แก้ข้อความหลักฐาน
  const offsets = [];
  let searchable = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = toArabic(norm(text[i]));
    if (c) { searchable += c; offsets.push(i); }
  }
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  const groups = (Array.isArray(findings) ? findings : []).map((f) => {
    const terms = new Set();
    for (const key of ['quote', 'name', 'topic', 'where', 'detail', 'fix']) {
      const raw = typeof f?.[key] === 'string' ? f[key].slice(0, 4000) : '';
      const parts = [raw, ...raw.split(/[\s"'“”‘’()[\],;：/|]+/)];
      for (const part of parts) {
        const term = toArabic(norm(part));
        if (term.length >= 3 || /^\d{2,}$/.test(term)) terms.add(term);
      }
      for (const part of segmenter.segment(raw)) {
        const term = toArabic(norm(part.segment));
        if (part.isWordLike && (term.length >= 3 || /^\d{2,}$/.test(term))) terms.add(term);
      }
    }
    const candidates = [];
    for (const term of [...terms].sort((a, b) => b.length - a.length).slice(0, 128)) {
      const matches = [];
      let from = 0;
      for (let count = 0; count < 4; count += 1) {
        const i = searchable.indexOf(term, from);
        if (i < 0) break;
        const start = offsets[i];
        const end = offsets[i + term.length - 1] + 1;
        matches.push({ start, end });
        from = i + term.length;
      }
      // คำทั่วไปที่ซ้ำหลายครั้งต้องไม่เบียดชื่อ/ตัวเลขเฉพาะช่วงท้ายออกจากงบ
      for (const match of matches) candidates.push({ ...match, score: term.length / matches.length });
    }
    const hits = [];
    for (const candidate of candidates.sort((a, b) => b.score - a.score || a.start - b.start)) {
      if (hits.some((hit) => candidate.start >= hit.start && candidate.end <= hit.end)) continue;
      hits.push({ start: Math.max(0, candidate.start - radius), end: Math.min(text.length, candidate.end + radius), focus: candidate.start });
      if (hits.length >= 4) break;
    }
    return hits;
  });
  const merge = (ranges) => {
    const merged = [];
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
      const prev = merged[merged.length - 1];
      if (prev && range.start <= prev.end) prev.end = Math.max(prev.end, range.end);
      else merged.push({ ...range });
    }
    return merged;
  };
  const size = (ranges) => ranges.reduce((sum, r) => sum + r.end - r.start, 0) + Math.max(0, ranges.length - 1) * separator.length;
  let selected = [];
  // กระจายงบ: หลักฐานแรกของทุก finding มาก่อนช่วงเพิ่มเติมของ finding เดียว
  for (let rank = 0; rank < 4; rank += 1) {
    for (const group of groups) {
      const hit = group[rank];
      if (!hit) continue;
      const merged = merge([...selected, hit]);
      if (size(merged) <= cap) { selected = merged; continue; }
      const remaining = cap - size(selected) - (selected.length ? separator.length : 0);
      if (remaining <= 0) continue;
      const start = Math.max(hit.start, Math.min(hit.focus - Math.floor(remaining / 2), hit.end - remaining));
      const clipped = merge([...selected, { start, end: Math.min(hit.end, start + remaining) }]);
      if (size(clipped) <= cap) selected = clipped;
    }
  }
  return selected.length ? selected.map((r) => text.slice(r.start, r.end)).join(separator) : fallback();
}

/** พรอมต์ให้ตัวซ่อม (Claude) แก้เฉพาะจุดที่ผู้ตรวจชี้ */
export function buildRepairPrompt({ insight, truth, findings }) {
  return `คุณคือบรรณาธิการ แก้ "ผลถอดคลิป" เฉพาะจุดที่ผู้ตรวจชี้เท่านั้น

⛔ กติกาเหล็ก
- แก้เฉพาะจุดที่ระบุ **ห้ามเขียนใหม่ทั้งใบ ห้ามแก้ส่วนที่ไม่ได้ถูกชี้**
- ห้ามเพิ่มข้อเท็จจริงที่ไม่มีในเฉลย · ห้ามตัดข้อเท็จจริงที่มีในเฉลยทิ้ง
- ถ้าจุดไหนแก้ไม่ได้เพราะข้อมูลไม่พอ ให้ปล่อยไว้แล้วบอกเหตุผลใน unfixed
- ชื่อคนที่ไม่มีหลักฐานในคลิป ให้ใช้คำแทนตามบทบาท (เช่น "ชายในคลิป" "เจ้าของร้าน") ห้ามเดาชื่อ
- ถ้าจำเป็นต้อง **เพิ่มประเด็นย่อยก้อนใหม่** ให้ใส่ "fromFinding" = เลขข้อใน "จุดที่ต้องแก้" ที่สั่งให้เพิ่มก้อนนั้น
  ก้อนใหม่ที่ไม่มี fromFinding หรืออ้างเลขข้อที่ไม่มีจริง จะถูกทิ้งทั้งก้อน (กันการแต่งประเด็นใหม่เข้ามาเอง)

ตอบ JSON บรรทัดเดียว: {"patch":{"headline":"...","overview":"...","rawData":"...","speakers":[...],"quotes":[...],"subStories":[{"no":1,"topic":"...","timeRange":"...","rawData":"...","quotes":[...],"fromFinding":"เลขข้อ (ใส่เฉพาะก้อนที่เพิ่มใหม่)"}]},"changed":[{"fromFinding":1,"summary":"สรุปสิ่งที่แก้","edits":[{"path":"rawData","before":"ข้อความเดิมตรงตัว","after":"ข้อความใหม่ตรงตัว"}]}],"unfixed":[{"fromFinding":2,"reason":"เหตุผลที่แก้ไม่ได้"}]}
ใส่เฉพาะช่องที่แก้จริงใน patch — ช่องที่ไม่ได้แก้ไม่ต้องใส่
changed ต้องอ้างเลข finding ทีละข้อ พร้อม edits ทุกจุดที่จำเป็นต่อการแก้ข้อนั้นครบแล้วเท่านั้น
path ใช้ headline/overview/rawData/speakers/quotes หรือ subStories.<no>.topic/timeRange/rawData/quotes (no ตามผลถอดปัจจุบัน)
before/after เป็นข้อความตรงตัวในช่องนั้นที่ถูกเปลี่ยนจริง; เพิ่มข้อความใช้ before="" ลบข้อความใช้ after=""
ถ้าแก้ได้เพียงบางส่วน ให้คง finding นั้นใน unfixed; คำบอกว่าแก้แล้วลอยๆ ไม่ถือเป็นการแก้สำเร็จ

=== จุดที่ต้องแก้ ===
${findings.map((f, i) => `${i + 1}. [${f.kind}] ${f.where}\n   ปัญหา: ${f.detail}\n   ควรแก้: ${f.fix}`).join('\n')}

=== เฉลยจากคลิป (ใช้ยืนยันข้อเท็จจริง) ===
${selectTruthForFindings(truth, findings)}

=== ผลถอดปัจจุบัน ===
${JSON.stringify({
    headline: insight?.headline, overview: insight?.overview, speakers: insight?.speakers,
    rawData: insight?.rawData, quotes: insight?.quotes,
    subStories: (insight?.subStories || []).map((s) => ({ no: s.no, topic: s.topic, timeRange: s.timeRange, rawData: s.rawData, quotes: s.quotes })),
  }, null, 1).slice(0, 50000)}`;
}

/**
 * 🐞 บั๊ก CB-06 (ผู้ตรวจอิสระ 26 ส.ค.): แพตช์จากโมเดลถูกเชื่อโดยไม่ตรวจรูป
 *   พิสูจน์แล้ว: subStories=[null] โยน TypeError · quotes/keyPoints ที่ไม่ใช่ array โยนที่ .map
 *   · no แบบ "1" ไม่ชนกับ 1 จึงเพิ่มก้อนซ้ำ · ก้อนใหม่ไม่จำกัดจำนวน
 *   · rawData เดิม ≤200 ตัวหดเหลือ 1 ตัวได้ · speakers/quotes แทนทั้ง array โดยไม่มีด่านกันหด
 *   · changed รายงานทั้งที่ค่าไม่เปลี่ยนจริง
 * → กฎใหม่: ตรวจทุก entry · หดเกินครึ่งและหายเกิน 40 ตัว = ปฏิเสธช่องนั้น · ก้อนใหม่ ≤3 ต่อรอบ
 *   · array ห้ามสั้นลง · changed เฉพาะที่ต่างจริง · ของที่ไม่รับเก็บใน rejected · ห้ามโยน exception
 */
const MAX_NEW_SUBSTORIES = 3;
const MAX_TIMERANGE_LEN = 60;

/**
 * 🐞 บั๊ก CB-06 รอบสอง (ผู้ตรวจอิสระ 26 ส.ค.): ก้อนใหม่ผ่านด่านแค่ "มีหัวข้อ + เนื้อ ≥60 ตัว"
 *   → ตัวซ่อมแต่งประเด็นใหม่ที่ไม่มีใครสั่งให้แก้เข้ามาได้ 3 ก้อน/รอบ โดยไม่มีอะไรผูกกับหลักฐาน
 * → กฎใหม่: ก้อนใหม่ต้องอ้าง "จุดที่ผู้ตรวจชี้" ที่ผู้เรียกส่งเข้ามาจริง (fromFinding / evidence)
 *   ไม่ส่ง findings มา = ตรวจหลักฐานไม่ได้ = ห้ามเพิ่มก้อนใหม่เลย (ปลอดภัยกว่ารับไว้ก่อน)
 *   หมายเหตุ: ด่านนี้คุมเฉพาะ "ก้อนใหม่" — การแก้ก้อนเดิมยังทำได้ตามเดิม
 */
const EVIDENCE_KEYS = ['fromFinding', 'evidence'];

/** อ่านตัวอ้างหลักฐานจากก้อนใหม่ — รับทั้งเลขข้อและข้อความ */
const readEvidenceAnchor = (p) => {
  for (const k of EVIDENCE_KEYS) {
    const v = p?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
};

/**
 * หา finding ที่ก้อนใหม่อ้างถึง — คืนคำบรรยายจุดนั้นถ้าอ้างของจริง, คืน null ถ้าอ้างลอย
 * รับได้ 2 แบบ: เลขข้อตามที่ buildRepairPrompt แจกไว้ (1-based) · ข้อความที่ตรงกับ where/kind ของจุดนั้น
 */
function resolveFindingRef(p, findings) {
  if (!Array.isArray(findings) || !findings.length) return null;
  const anchor = readEvidenceAnchor(p);
  if (!anchor) return null;
  const describe = (f, i) => `#${i + 1} [${f?.kind || '?'}] ${String(f?.where || '').slice(0, 60)}`;

  const numMatch = anchor.match(/^\D{0,4}(\d{1,3})\D{0,2}$/);       // "3" · "#3" · "ข้อ 3" · "3."
  if (numMatch) {
    const i = Number(numMatch[1]) - 1;
    return (i >= 0 && i < findings.length) ? describe(findings[i], i) : null;
  }

  const a = norm(anchor);
  if (a.length < 4) return null;                                    // สั้นเกินกว่าจะชี้จุดไหนได้จริง
  for (let i = 0; i < findings.length; i += 1) {
    const f = findings[i] || {};
    const w = norm(f.where);
    const k = norm(f.kind);
    if (w && (w.includes(a) || a.includes(w))) return describe(f, i);
    if (k && a.includes(k)) return describe(f, i);
  }
  return null;
}
/** เนื้อหดเกินครึ่ง "และ" หายเกิน 40 ตัว = ผิดปกติ (ไม่เว้นขอบ 200 ตัวแบบเดิม) */
const shrankTooMuch = (before, after) => before.length - after.length > 40 && after.length < before.length * 0.5;
/** เลขก้อน: รับได้ทั้ง 1 และ "1" — คืน null ถ้าไม่ใช่จำนวนเต็มบวก */
const normNo = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n > 0 && n <= 999 ? n : null;
};

/** รับรองเฉพาะการเปลี่ยนข้อความที่รับจริงและผูกเลข finding ชัดเจน ไม่ใช่การตรวจความหมายซ้ำ */
function confirmedRepairFindings(findings, report, appliedEdits) {
  if (!Array.isArray(findings) || !Array.isArray(report?.changed) || !Array.isArray(report?.unfixed)) return [];
  const findingNo = (v) => {
    const n = (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) ? Number(v) : 0;
    return Number.isInteger(n) && n >= 1 && n <= findings.length ? n : null;
  };
  const blocked = new Set();
  for (const item of report.unfixed) {
    const n = findingNo(item?.fromFinding);
    if (n) { blocked.add(n); continue; }
    // รายงานรุ่นเก่าเป็นข้อความ: จับเลขข้อที่ต้นประโยคหรือ where ที่ชัดเจนเท่านั้น
    const s = typeof item === 'string' ? item.trim() : '';
    const match = s.match(/^(?:#|ข้อ\s*)?(\d{1,3})(?=[\s.:)\-]|$)/);
    const ref = match && findingNo(match[1]);
    if (ref) { blocked.add(ref); continue; }
    const matches = findings.map((f, i) => ({ no: i + 1, where: norm(f?.where) }))
      .filter((f) => f.where.length >= 4 && norm(s).includes(f.where));
    if (matches.length === 1) blocked.add(matches[0].no);
    else return []; // มีข้อที่ยังแก้ไม่ได้แต่ไม่รู้ข้อไหน จึงยังล้างธงไม่ได้
  }
  const confirmed = new Map();
  for (const item of report.changed) {
    const n = findingNo(item?.fromFinding);
    if (!n || blocked.has(n)) continue;
    const valid = Array.isArray(item?.edits) && item.edits.length > 0 && item.edits.every((edit) => {
      const actual = appliedEdits.get(edit?.path);
      if (!actual || typeof edit.before !== 'string' || typeof edit.after !== 'string' || edit.before === edit.after) return false;
      return (!edit.before || (actual.before.includes(edit.before) && !actual.after.includes(edit.before)))
        && (!edit.after || (!actual.before.includes(edit.after) && actual.after.includes(edit.after)));
    });
    confirmed.set(n, valid && confirmed.get(n) !== false);
  }
  return [...confirmed].filter(([, valid]) => valid).map(([n]) => n);
}

/**
 * เอา patch จากตัวซ่อมมาทับผลเดิม — ทับเฉพาะช่องที่ส่งมาและผ่านด่าน · คืน {insight, changed, rejected}
 * @param {object} insight ผลถอดเดิม
 * @param {object} patch แพตช์จากตัวซ่อม (เชื่อไม่ได้ ต้องผ่านด่านทุกช่อง)
 * @param {object|Array} opts {findings, changed, unfixed} = findings และรายงานจากตัวซ่อม (ส่ง array findings ตรงๆ ก็ได้)
 *   ใช้ตรวจว่า "ก้อนย่อยใหม่" ที่ตัวซ่อมเพิ่มมา ผูกกับจุดที่ผู้ตรวจชี้จริงไหม
 *   ไม่ส่งมา = ห้ามเพิ่มก้อนใหม่ (ค่าเริ่มต้นปลอดภัย · ของเดิมยังแก้ได้ตามปกติ)
 */
export function applyRepairPatch(insight, patch, opts) {
  const findings = Array.isArray(opts) ? opts
    : (opts && typeof opts === 'object' && Array.isArray(opts.findings) ? opts.findings : null);
  const base = (insight && typeof insight === 'object') ? insight : {};
  const out = { ...base };
  const changed = [];
  const rejected = [];
  const appliedEdits = new Map();
  const recordEdit = (path, before, after) => {
    const asText = (v) => Array.isArray(v) ? v.join('\n') : String(v ?? '');
    appliedEdits.set(path, { before: appliedEdits.get(path)?.before ?? asText(before), after: asText(after) });
  };
  const rej = (where, why) => { rejected.push({ where, why }); };
  try {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      rej('patch', 'แพตช์ไม่ใช่ออบเจกต์ — ไม่ทับอะไรเลย');
      return { insight: out, changed: [], rejected, resolvedFindings: [] };
    }

    // ① ช่องข้อความ
    const guardText = (key, val) => {
      if (val === undefined || val === null || val === '') return;
      if (typeof val === 'object' || typeof val === 'function') { rej(key, 'ไม่ใช่ข้อความ'); return; }
      const before = String(base[key] == null ? '' : base[key]);
      const after = String(val);
      if (after === before) { rej(key, 'ค่าเท่าเดิม ไม่ต้องทับ'); return; }
      if (shrankTooMuch(before, after)) { rej(key, `เนื้อหดผิดปกติ ${before.length}→${after.length} ตัว`); return; }
      out[key] = after; changed.push(key);
      recordEdit(key, before, after);
    };
    guardText('headline', patch.headline);
    guardText('overview', patch.overview);
    guardText('rawData', patch.rawData);

    // ② array ข้อความ — ห้ามสั้นลงกว่าเดิม
    const cleanList = (arr, where) => {
      const okItems = [];
      for (const x of arr) {
        if (x === null || x === undefined || typeof x === 'object' || typeof x === 'function') { rej(where, 'มีรายการที่ไม่ใช่ข้อความ'); continue; }
        const t = String(x);
        if (t.trim()) okItems.push(t);
      }
      return okItems;
    };
    const guardList = (key) => {
      const val = patch[key];
      if (val === undefined || val === null) return;
      if (!Array.isArray(val)) { rej(key, 'ไม่ใช่ array'); return; }
      const before = (Array.isArray(base[key]) ? base[key] : []).map((x) => String(x == null ? '' : x));
      const after = cleanList(val, key);
      if (!after.length) { rej(key, 'ว่างเปล่า'); return; }
      if (after.length < before.length) { rej(key, `รายการหด ${before.length}→${after.length} — ไม่รับ`); return; }
      if (after.length === before.length && after.every((x, i) => x === before[i])) { rej(key, 'ค่าเท่าเดิม ไม่ต้องทับ'); return; }
      out[key] = after; changed.push(key);
      recordEdit(key, before, after);
    };
    guardList('speakers');
    guardList('quotes');

    // ③ ประเด็นย่อย
    if (patch.subStories !== undefined && patch.subStories !== null) {
      if (!Array.isArray(patch.subStories)) rej('subStories', 'ไม่ใช่ array');
      else {
        const curList = (Array.isArray(base.subStories) ? base.subStories : []).filter((s) => s && typeof s === 'object');
        const byNo = new Map();
        curList.forEach((s, i) => {
          let k = normNo(s.no) ?? (i + 1);
          while (byNo.has(k)) k += 1;                   // กันเลขซ้ำของเดิมทำให้ก้อนหายเงียบ
          byNo.set(k, s);
        });
        let touched = false;
        let added = 0;
        for (const p of patch.subStories) {
          if (!p || typeof p !== 'object' || Array.isArray(p)) { rej('subStories', 'รายการไม่ใช่ออบเจกต์ — ข้าม'); continue; }
          const no = normNo(p.no);
          if (no === null) { rej('subStories', `เลขก้อนใช้ไม่ได้: ${JSON.stringify(p.no)}`); continue; }
          const cur = byNo.get(no);

          // 🐞 บั๊ก #10 (26 ส.ค.): ก้อนใหม่ที่ตัวซ่อมเพิ่มเคยหายเงียบ → รับได้ แต่ต้องมีเนื้อจริงและจำกัดจำนวน
          // 🐞 บั๊ก CB-06 รอบสอง: และต้องผูกกับจุดที่ผู้ตรวจชี้ด้วย ไม่งั้นคือแต่งเรื่องใหม่เข้าคลัง
          if (!cur) {
            const ref = resolveFindingRef(p, findings);
            if (!ref) {
              rej(`subStories no.${no}`, (Array.isArray(findings) && findings.length)
                ? 'ก้อนใหม่ไม่ได้อ้างจุดที่ผู้ตรวจชี้ (ต้องมี fromFinding/evidence ที่ตรงกับจุดที่ส่งมาซ่อม)'
                : 'ห้ามเพิ่มก้อนใหม่ — ผู้เรียกไม่ได้ส่ง findings มาให้ตรวจหลักฐาน');
              continue;
            }
            if (added >= MAX_NEW_SUBSTORIES) { rej(`subStories no.${no}`, `เกินเพดานก้อนใหม่ ${MAX_NEW_SUBSTORIES} ก้อน/รอบ`); continue; }
            const topic = typeof p.topic === 'string' ? p.topic.trim() : '';
            const rawData = typeof p.rawData === 'string' ? p.rawData : '';
            if (!topic || rawData.trim().length < 60) { rej(`subStories no.${no}`, 'ก้อนใหม่เนื้อไม่พอ (ต้องมีหัวข้อ + เนื้อ ≥60 ตัว)'); continue; }
            const quotes = Array.isArray(p.quotes) ? cleanList(p.quotes, `subStories no.${no} quotes`) : [];
            const keyPoints = Array.isArray(p.keyPoints) ? cleanList(p.keyPoints, `subStories no.${no} keyPoints`) : [];
            if (p.quotes != null && !Array.isArray(p.quotes)) rej(`subStories no.${no} quotes`, 'ไม่ใช่ array — ทิ้ง');
            if (p.keyPoints != null && !Array.isArray(p.keyPoints)) rej(`subStories no.${no} keyPoints`, 'ไม่ใช่ array — ทิ้ง');
            const timeRange = typeof p.timeRange === 'string' && p.timeRange.length <= MAX_TIMERANGE_LEN ? p.timeRange : '';
            byNo.set(no, { no, topic, timeRange, rawData, quotes, keyPoints, directLead: '', interviewEventIsNews: false, fromFinding: ref });
            for (const key of ['topic', 'timeRange', 'rawData', 'quotes']) recordEdit(`subStories.${no}.${key}`, '', byNo.get(no)[key]);
            added += 1; touched = true;
            changed.push(`subStories+เพิ่มก้อนใหม่ no.${no}`);
            continue;
          }

          // แก้ก้อนเดิม — ทีละช่อง ช่องไหนไม่ผ่านก็ปฏิเสธเฉพาะช่องนั้น
          const merged = { ...cur };
          let hit = false;
          if (p.topic != null) {
            if (typeof p.topic !== 'string' || !p.topic.trim()) rej(`subStories no.${no} topic`, 'ไม่ใช่ข้อความที่ใช้ได้');
            else if (p.topic === String(cur.topic == null ? '' : cur.topic)) rej(`subStories no.${no} topic`, 'ค่าเท่าเดิม');
            else { merged.topic = p.topic; hit = true; }
          }
          if (p.timeRange != null) {
            if (typeof p.timeRange !== 'string' || !p.timeRange.trim() || p.timeRange.length > MAX_TIMERANGE_LEN) rej(`subStories no.${no} timeRange`, 'รูปแบบช่วงเวลาใช้ไม่ได้');
            else if (p.timeRange === String(cur.timeRange == null ? '' : cur.timeRange)) rej(`subStories no.${no} timeRange`, 'ค่าเท่าเดิม');
            else { merged.timeRange = p.timeRange; hit = true; }
          }
          if (p.rawData != null) {
            const beforeRaw = String(cur.rawData == null ? '' : cur.rawData);
            if (typeof p.rawData !== 'string' || !p.rawData.trim()) rej(`subStories no.${no} rawData`, 'ไม่ใช่ข้อความที่ใช้ได้');
            else if (p.rawData === beforeRaw) rej(`subStories no.${no} rawData`, 'ค่าเท่าเดิม');
            else if (shrankTooMuch(beforeRaw, p.rawData)) rej(`subStories no.${no} rawData`, `เนื้อหดผิดปกติ ${beforeRaw.length}→${p.rawData.length} ตัว`);
            else { merged.rawData = p.rawData; hit = true; }
          }
          if (p.quotes != null) {
            if (!Array.isArray(p.quotes)) rej(`subStories no.${no} quotes`, 'ไม่ใช่ array');
            else {
              const beforeQ = (Array.isArray(cur.quotes) ? cur.quotes : []).map((x) => String(x == null ? '' : x));
              const afterQ = cleanList(p.quotes, `subStories no.${no} quotes`);
              if (!afterQ.length) rej(`subStories no.${no} quotes`, 'ว่างเปล่า');
              else if (afterQ.length < beforeQ.length) rej(`subStories no.${no} quotes`, `รายการหด ${beforeQ.length}→${afterQ.length} — ไม่รับ`);
              else if (afterQ.length === beforeQ.length && afterQ.every((x, i) => x === beforeQ[i])) rej(`subStories no.${no} quotes`, 'ค่าเท่าเดิม');
              else { merged.quotes = afterQ; hit = true; }
            }
          }
          if (hit) {
            for (const key of ['topic', 'timeRange', 'rawData', 'quotes']) {
              if (merged[key] !== cur[key]) recordEdit(`subStories.${no}.${key}`, cur[key], merged[key]);
            }
            byNo.set(no, merged); touched = true;
          }
        }
        if (touched) {
          out.subStories = [...byNo.values()]
            .sort((a, b) => (normNo(a?.no) || 0) - (normNo(b?.no) || 0))
            .map((s, i) => ({ ...s, no: i + 1 }));
          changed.push('subStories');
        } else if (patch.subStories.length) rej('subStories', 'ไม่มีช่องไหนผ่านด่าน');
      }
    }
    return { insight: out, changed: [...new Set(changed)], rejected,
      resolvedFindings: confirmedRepairFindings(findings, opts, appliedEdits) };
  } catch (e) {
    // สัญญา fail-open: แพตช์ผิดรูปแค่ไหนก็ห้ามโยนออกไปให้ท่อพัง — คืนของเดิม
    rej('patch', `แพตช์ผิดรูป: ${String(e?.message || e).slice(0, 120)}`);
    return { insight: { ...base }, changed: [], rejected, resolvedFindings: [] };
  }
}

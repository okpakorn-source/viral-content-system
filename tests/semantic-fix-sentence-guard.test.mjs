// 🧷 ข้อสอบ Sentence Guard ด่าน L4.6 "ห้ามทิ้งประโยคค้าง" (3 ก.ย. 69)
//   เคสจริง 2 ก.ย. 69 (#05243 จิ่งป๋อหราน · กรรมการให้ 26/50 ต่ำสุดเพราะจบค้าง):
//   AI ชี้ลบ "เคยกำข้าวของหนักเดินส่งน้ำเพื่อคุณย่า…" → เนื้อเหลือจบค้าง "…พระเอกที่หลายคนไม่รู้ว่า"
//   สวิตช์ SEMANTIC_FIX_SENTENCE_GUARD ค่าเริ่มต้นเปิด · =0 = พฤติกรรมเดิมไบต์ต่อไบต์
// โหลดซอร์สจริง ณ เวลารัน + แทน import AI ด้วย mock (แบบเดียวกับ semantic-seam-guard)
// รัน: node tests/semantic-fix-sentence-guard.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let src = readFileSync(new URL('../src/lib/correction/semanticSanityCheck.js', import.meta.url), 'utf8');
const stubs = [
  ["import { callAI } from '@/lib/ai/openai';", 'const callAI = async () => globalThis.__SG_MOCK__;'],
  ["import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock';"],
  [/import \{ callClaude, isClaudeAvailable \} from '@\/lib\/ai\/claudeClient';[^\n]*/,
    'const callClaude = async () => globalThis.__SG_MOCK__; const isClaudeAvailable = () => true;'],
];
for (const [from, to] of stubs) {
  const hit = typeof from === 'string' ? src.includes(from) : from.test(src);
  if (!hit) { console.log('❌ stub ไม่เจอ import:', String(from).slice(0, 50)); process.exit(1); }
  src = src.replace(from, to);
}
const tmpUrl = new URL('../src/lib/correction/_sentence-guard-under-test.tmp.mjs', import.meta.url);
writeFileSync(tmpUrl, src);
let semanticSanityCheck, findDanglingTail, DANGLING_TAIL_WORDS, DANGLING_TAIL_EXCEPTIONS;
try {
  ({ semanticSanityCheck, findDanglingTail, DANGLING_TAIL_WORDS, DANGLING_TAIL_EXCEPTIONS } = await import(tmpUrl.href));
} finally {
  rmSync(tmpUrl);
}

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };
const mock = (issues) => { globalThis.__SG_MOCK__ = { hasIssues: issues.length > 0, issues }; };
delete process.env.SEMANTIC_FIX_SENTENCE_GUARD; // กันสิ่งแวดล้อมปนเปื้อน — ค่าเริ่มต้น = เปิด

// ── ① รายการคำเชื่อม/คำต้องมีส่วนขยาย ครบตามสเปกเจ้าของ + matcher แม่นเรื่องคำพ้องท้าย ──
{
  const SPEC = ['ว่า', 'ที่', 'ซึ่ง', 'และ', 'แต่', 'เพื่อ', 'กับ', 'ของ', 'ให้', 'ไม่รู้ว่า', 'จน', 'เพราะ', 'ถ้า'];
  t('1 export DANGLING_TAIL_WORDS ครบทุกคำที่สเปกสั่ง', Array.isArray(DANGLING_TAIL_WORDS) && SPEC.every((w) => DANGLING_TAIL_WORDS.includes(w)));
  t('2 export DANGLING_TAIL_EXCEPTIONS เป็นรายการ', Array.isArray(DANGLING_TAIL_EXCEPTIONS) && DANGLING_TAIL_EXCEPTIONS.includes('กว่า'));
  t('3 จบ "…ไม่รู้ว่า" → จับคำยาวสุดก่อน (ไม่ใช่แค่ "ว่า")', findDanglingTail('พระเอกที่หลายคนไม่รู้ว่า') === 'ไม่รู้ว่า');
  t('4 ช่องว่างท้ายไม่หลอก matcher', findDanglingTail('เขาบอกให้   ') === 'ให้');
  t('5 "มากกว่า" จบประโยคได้ → ไม่ใช่ "ว่า" ค้าง', findDanglingTail('ทำได้ดีมากกว่า') === null);
  t('6 "ข้าวของ" จบประโยคได้ → ไม่ใช่ "ของ" ค้าง', findDanglingTail('เขาเร่งเก็บข้าวของ') === null);
  t('7 "ยากจน" จบประโยคได้ → ไม่ใช่ "จน" ค้าง', findDanglingTail('ครอบครัวยากจน') === null);
  t('8 "ผู้กำกับ" จบประโยคได้ → ไม่ใช่ "กับ" ค้าง', findDanglingTail('เขาคือผู้กำกับ') === null);
  t('9 "ภายใน" จบประโยคได้ → ไม่ใช่ "ใน" ค้าง', findDanglingTail('เก็บทุกอย่างไว้ภายใน') === null);
  t('10 จบด้วยคำเชื่อมจริง → จับได้ (เพราะ/กับ/ซึ่ง)', findDanglingTail('ทั้งหมดนี้เป็นเพราะ') === 'เพราะ' && findDanglingTail('เขาเดินทางไปกับ') === 'กับ' && findDanglingTail('เรื่องราวซึ่ง') === 'ซึ่ง');
  t('11 จบด้วยเครื่องหมายจบประโยค → สมบูรณ์ ไม่ค้าง', findDanglingTail('ทำเสร็จแล้ว!') === null && findDanglingTail('เหลือเพียงความทรงจำ…') === null);
  t('11b พ้องรูปสองทาง: "บอกว่า" ต้องไม่ถูก exception "กว่า" กลืน (match ยาวสุดชนะ)', findDanglingTail('เขาย้ำและบอกว่า') === 'บอกว่า' && findDanglingTail('เธอกล่าวว่า') === 'กล่าวว่า');
}

// ── เนื้อจำลองโครงเคสจริง #05243 (ย่อหน้าท้ายมีตัวเลข/ชื่อเรื่อง Latin ตรงของจริง) ──
const P1 = 'จิ่งป๋อหรานในวัยเด็กเติบโตมากับคุณปู่และคุณย่า ครอบครัวมีฐานะยากลำบากแต่ไม่เคยขาดความรัก';
const LAST_HANGING = 'แต่ปลายทางของเรื่องนี้ไม่ได้มีแค่วันที่ชีวิตดีขึ้น คุณย่าจากไปในปี 2017 ทิ้งบ้านหลังใหญ่ไว้คู่กับความทรงจำของเด็กวัย 16 ที่เคยทำทุกทางเพื่อคนที่เลี้ยงเขามา วันนี้เขายืนในบทหลวนเนี่ยนใน ฤดูใหม่นี้มีเพียงสองเรา The Early Spring (2026) พระเอกที่หลายคนไม่รู้ว่า';
const BROKEN_TAIL = 'เคยกำข้าวของหนักเดินส่งน้ำเพื่อคุณย่ามาก่อน';
const REAL_DOC = `${P1}\n\n${LAST_HANGING} ${BROKEN_TAIL}`;
const P3 = 'ท้ายเรื่องพวกเขากลายเป็นครอบครัวเดียวกัน';

// ── ② เคสจริง replay: ลบท่อนท้ายเรื่องแล้วจะเหลือ "…ไม่รู้ว่า" ค้าง → ด่านต้องคืนเนื้อเดิมของประโยค (fail-safe) ──
{
  mock([{ brokenText: BROKEN_TAIL, reason: '"กำข้าวของหนัก" คำผิดรูปไร้ความหมาย', severity: 'high' }]);
  const r = await semanticSanityCheck(REAL_DOC);
  t('12 ผลต้องไม่จบค้างด้วย "ไม่รู้ว่า"', !r.sanitizedContent.trimEnd().endsWith('ไม่รู้ว่า'));
  t('13 หน่วยยาวเกินเพดาน+แบกตัวเลข/ชื่อเรื่อง → คืนเนื้อเดิมไบต์ต่อไบต์', r.sanitizedContent === REAL_DOC && r.fixed === false);
  t('14 ธง SENTENCE_GUARD + เหตุการณ์ reverted ให้กล่องดำ', r.error === 'SENTENCE_GUARD' && Array.isArray(r.sentenceGuard) && r.sentenceGuard[0].action === 'reverted');
}

// ── ②b หน่วยยาวเกินเพดานแบบไทยล้วน (ไม่มีตัวเลข/ชื่อให้ด่านอื่นดัก) → เพดานความยาวต้องกันเอง ──
{
  const LONG_HEAD = 'เรื่องราวของเขาเดินทางมาไกลจากวันแรกที่ไม่มีใครรู้จักผ่านการฝึกซ้อมหนักหน่วงทุกเช้าค่ำโดยไม่เคยหยุดพักและยังคงเดินหน้าต่อไปอย่างมุ่งมั่นเสมอมาเพราะเขาเชื่อมาตลอดว่า';
  t('14b เนื้อเทสยาวเกินเพดานจริง (>120 ตัว)', LONG_HEAD.length > 120);
  const doc = `${P1}\n\n${LONG_HEAD} ท่อนพังตรงนี้\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังตรงนี้', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('14c หน่วยยาวไทยล้วนจบ "ว่า" → คืนเนื้อเดิม (unit-too-long — ห้ามลบก้อนใหญ่)', r.sanitizedContent === doc && r.fixed === false && r.sentenceGuard?.[0]?.reason === 'unit-too-long');
}

// ── ③ สวิตช์ปิด (=0) = พฤติกรรมเดิม: ลบแล้วทิ้งประโยคค้างเหมือนบั๊กจริง ──
{
  process.env.SEMANTIC_FIX_SENTENCE_GUARD = '0';
  try {
    mock([{ brokenText: BROKEN_TAIL, reason: 'ทดสอบ', severity: 'high' }]);
    const r = await semanticSanityCheck(REAL_DOC);
    t('15 สวิตช์ปิด → ลบตามที่ AI ชี้ (พฤติกรรมเดิม)', r.fixed === true && !r.sanitizedContent.includes(BROKEN_TAIL));
    t('16 สวิตช์ปิด → จบค้าง "ไม่รู้ว่า" แบบบั๊กเดิม (พิสูจน์ =0 คืนของเก่าจริง)', r.sanitizedContent.trimEnd().endsWith('ไม่รู้ว่า'));
    t('17 สวิตช์ปิด → ไม่มี field ใหม่โผล่ (sentenceGuard ไม่มี)', !('sentenceGuard' in r));
  } finally {
    delete process.env.SEMANTIC_FIX_SENTENCE_GUARD;
  }
}

// ── ④ หน่วยสั้นไม่มีข้อเท็จจริง → ลบทั้งหน่วยแทน (ไม่เหลือหัวประโยคค้าง) ──
{
  const doc = `${P1}\n\nเขาบอกกับทีมงานว่า ท่อนพังอ่านไม่รู้เรื่องตรงนี้\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังอ่านไม่รู้เรื่องตรงนี้', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('18 เหลือ "เขาบอกกับทีมงานว่า" ค้าง → ลบทั้งหน่วยแทน', r.fixed === true && !r.sanitizedContent.includes('เขาบอกกับทีมงานว่า'));
  t('19 ย่อหน้ารอบข้างครบ (พฤติกรรม cleanup เดิม)', r.sanitizedContent === `${P1} ${P3}`);
  t('20 เหตุการณ์ extended บันทึกให้กล่องดำ + removed คือทั้งหน่วย', r.sentenceGuard?.[0]?.action === 'extended' && r.issuesFound[0].removed.includes('เขาบอกกับทีมงานว่า'));
}

// ── ⑤ เหลือเศษสั้นผิดปกติ ("แต่") → ลบทั้งหน่วย ไม่ทิ้งเศษ ──
{
  const doc = `${P1}\n\nแต่ท่อนพังยาวมากที่ไร้ความหมายทั้งหมดตรงนี้\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังยาวมากที่ไร้ความหมายทั้งหมดตรงนี้', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('21 เศษ "แต่" ไม่ถูกทิ้งค้าง → หน่วยหายทั้งก้อน', r.fixed === true && r.sanitizedContent === `${P1} ${P3}`);
}

// ── ⑤b เศษสั้นที่ "ไม่จบด้วยคำค้าง" → ต้อง trigger ทาง fragment ล้วน (ข้อติงผู้ตรวจ 3 ก.ย. 69: เคส ⑤ "แต่" ซ้อน dangling
//        ทำให้ mutant SENTENCE_REMNANT_MIN_CHARS=0 รอด — เคสนี้ "ครับผม" 6 ตัวไม่มีคำค้าง กัด fragment-path ตรงๆ) ──
{
  const doc = `${P1}\n\nครับผม ท่อนพังยาวมากไร้ความหมายตรงนี้\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังยาวมากไร้ความหมายตรงนี้', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('21b เศษ "ครับผม" (6 ตัว ไม่มีคำค้าง) → ลบทั้งหน่วยแทน ไม่ทิ้งเศษ', r.fixed === true && r.sanitizedContent === `${P1} ${P3}`);
  t('21c เหตุการณ์บันทึก trigger ขึ้นต้น "fragment" (พิสูจน์มาทางเศษสั้น ไม่ใช่คำค้าง)',
    r.sentenceGuard?.[0]?.action === 'extended' && String(r.sentenceGuard?.[0]?.trigger || '').startsWith('fragment'));
}

// ── ⑥ เศษที่จะลบเพิ่มมีตัวเลขที่หน่วยอื่นไม่มี → ห้ามลบ คืนเนื้อเดิม (ห้ามข้อเท็จจริงหาย) ──
{
  const doc = `${P1}\n\nเขาย้ำยอดบริจาค 250,000 บาทและบอกว่า ท่อนพังไร้ความหมายตรงนี้\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังไร้ความหมายตรงนี้', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('22 เศษแบกเลข 250,000 → คืนเนื้อเดิมไบต์ต่อไบต์ (ไม่ลบทั้งหน่วย)', r.sanitizedContent === doc && r.fixed === false);
  t('23 เหตุผล unique-fact-in-remnant บันทึกไว้ตรวจย้อน', r.sentenceGuard?.[0]?.reason === 'unique-fact-in-remnant');
}

// ── ⑦ เศษตรงกับต้นฉบับ (แบกข้อเท็จจริงต้นทาง) → คืนเนื้อเดิม ──
{
  const SOURCE = 'เด็กหญิงวิ่งไปบอกคุณครูประจำชั้นด้วยความตกใจ และครูรีบเข้ามาดูอาการทันที';
  const doc = `${P1}\n\nหนูน้อยวิ่งไปบอกคุณครูประจำชั้นด้วยความตกใจว่า ท่อนพังตรงนี้ยาวหน่อย\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังตรงนี้ยาวหน่อย', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc, { sourceBody: SOURCE });
  t('24 เศษตรงต้นฉบับ ≥12 ตัว → คืนเนื้อเดิม (remnant-matches-source)', r.sanitizedContent === doc && r.sentenceGuard?.[0]?.reason === 'remnant-matches-source');
}

// ── ⑧ เคสปกติต้องไม่ถูกแตะ: รอยลบกลางหน่วย เนื้อสองฝั่งต่อกันอ่านจบได้ ──
{
  const doc = `${P1}\n\nความสนิทค่อยๆ โตขึ้นจากการทำงาน วลีพังกลางเรื่องตรงนี้ ทั้งคู่คอยเตือนกันเรื่องสุขภาพ\n\n${P3}`;
  mock([{ brokenText: 'วลีพังกลางเรื่องตรงนี้ ', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('25 รอยลบกลางหน่วยรอยต่อสะอาด → ลบปกติ ด่านไม่ยุ่ง', r.fixed === true && !r.sanitizedContent.includes('วลีพังกลางเรื่องตรงนี้'));
  t('26 ไม่มีเหตุการณ์ sentence guard เมื่อไม่ trigger', !('sentenceGuard' in r) && r.error == null);
  t('27 เนื้อสองฝั่งรอยลบยังครบ', r.sanitizedContent.includes('โตขึ้นจากการทำงาน') && r.sanitizedContent.includes('ทั้งคู่คอยเตือนกันเรื่องสุขภาพ'));
}

// ── ⑧b รอยลบกลางหน่วยที่ "ฝั่งซ้ายของรอยจบด้วยคำค้าง" แต่เนื้อฝั่งขวายังต่อ → ต้องลบปกติ ห้าม false-trigger
//        (ข้อติงผู้ตรวจ 3 ก.ย. 69: เคส ⑧ ฝั่งซ้ายจบ "การทำงาน" ไม่พ้องคำค้าง → mutant ที่ตัดเงื่อนไข
//        "รอยลบต้องชิดท้ายหน่วย" (right.search < 0) รอด — เคสนี้ฝั่งซ้าย "เขาบอกว่า" กัดเงื่อนไขนั้นตรงๆ) ──
{
  const doc = `${P1}\n\nเขาบอกว่าท่อนพังกลางประโยคตรงนี้เรื่องนี้สำคัญกับใจเขามาตลอด\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังกลางประโยคตรงนี้', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('27b ฝั่งซ้ายจบ "บอกว่า" แต่รอยลบอยู่กลางหน่วย → ลบปกติ เนื้อสองฝั่งเชื่อมกันครบ',
    r.fixed === true && r.sanitizedContent === `${P1}\n\nเขาบอกว่าเรื่องนี้สำคัญกับใจเขามาตลอด\n\n${P3}`);
  t('27c ไม่มีเหตุการณ์ sentence guard (ด่านห้ามกินเนื้อดี/ห้ามยกเลิกการลบที่ AI ชี้)', !('sentenceGuard' in r) && r.error == null);
}

// ── ⑨ รอยลบชิดท้ายหน่วยแต่ท้ายที่เหลือจบสมบูรณ์ → ไม่ trigger (กัน false positive) ──
{
  const doc = `${P1}\n\nพ่อยังโทรมาถามไถ่ทุกคืนเสมอมา ท่อนพังท้ายย่อหน้าตรงนี้\n\n${P3}`;
  mock([{ brokenText: ' ท่อนพังท้ายย่อหน้าตรงนี้', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc);
  t('28 ท้ายที่เหลือ "เสมอมา" จบได้ปกติ → ลบตามเดิม ไม่แตะเพิ่ม', r.fixed === true && r.sanitizedContent.includes('พ่อยังโทรมาถามไถ่ทุกคืนเสมอมา') && !('sentenceGuard' in r));
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);

// 🔎 ข้อสอบ "แก้บั๊ก [object Object] ในรายการของขั้นแตกประเด็น" — เจ้าของสั่ง 16 ส.ค. 69
// รัน: node tests/breakdown-list-fix.test.mjs
//
// ที่มาของบั๊ก (พบจากผลเจนข่าวจริง ไม่ใช่การเดา):
//   AI ขั้นแตกประเด็นคืน conflicts / best_sections เป็น "อาเรย์ของอ็อบเจกต์"
//   แต่โค้ดเรียก .join() ตรงๆ ⇒ ได้ "[object Object] | [object Object]" ยัดเข้าพรอมต์
//   AI ปลายทางบ่นเองในล็อก: "เนื้อข่าวระบุจุดขัดแย้งเป็น [object Object] จึงวางแผนจาก...เท่านั้น"
//   ผลคือ **แก่นดราม่าที่คมที่สุดของข่าวถูกทิ้งทุกใบ** เช่น "รักในวันแต่งงาน vs รักในวันพักฟื้น"
//
// ข้อสอบนี้ล็อกไว้ 3 ชั้น:
//   ① พฤติกรรมตัวคลี่ (flattenList) — ต้องคลี่ได้จริง ไม่ทิ้งของ ไม่พังกับ input แปลกๆ
//   ② สวิตช์ถอย BREAKDOWN_LIST_FIX=0 — ต้องกลับไปเป็นของเดิมเป๊ะ (รวมอาการ [object Object])
//   ③ การต่อสาย (wiring) — 4 จุดเรียกจริงต้องใช้ตัวคลี่ ไม่ใช่ .join() ดิบ
//      ⚠️ ชั้น ③ จำเป็น เพราะชั้น ① ผ่านได้แม้ไม่มีใครเรียกใช้เลย (บทเรียนจากรอบเพดานตัวอย่างครู)

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(ROOT + p, 'utf8');

const WF = read('src/lib/workflow/workflowEngine.js');
const TXT = read('src/lib/services/summarizeServiceText.js');
const URLSVC = read('src/lib/services/summarizeService.js');

// ── โหลด flattenList "จากซอร์สจริง" (workflowEngine import @/lib/db ตรงๆ ไม่ได้ใน node)
//    ตัดเฉพาะบล็อกฟังก์ชันมารัน ⇒ ถ้าใครแก้ซอร์ส ข้อสอบนี้เห็นทันที
const start = WF.indexOf('const _LIST_KEYS');
const end = WF.indexOf('export function buildFullContext');
if (start < 0 || end < 0 || end <= start) {
  console.log('❌ หาบล็อก flattenList ในซอร์สไม่เจอ — โครงไฟล์เปลี่ยน ต้องอัปเดตข้อสอบ');
  process.exit(1);
}
const src = WF.slice(start, end).replace(/^export /gm, '');
const mod = await import('data:text/javascript;charset=utf-8,' +
  encodeURIComponent(src + '\nexport { flattenList };'));
const { flattenList } = mod;

const withEnv = (v, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'BREAKDOWN_LIST_FIX');
  const old = process.env.BREAKDOWN_LIST_FIX;
  if (v === undefined) delete process.env.BREAKDOWN_LIST_FIX; else process.env.BREAKDOWN_LIST_FIX = v;
  try { return fn(); } finally { if (had) process.env.BREAKDOWN_LIST_FIX = old; else delete process.env.BREAKDOWN_LIST_FIX; }
};

// ═══ ① พฤติกรรมตัวคลี่ — ใช้ของจริงจากผลรัน 16 ส.ค. 69 ═══
const REAL_CONFLICTS = [
  { conflict: 'รักในวันแต่งงาน vs รักในวันพักฟื้น', detail: 'คำสัญญาสวยงาม ปะทะการลงมือจริง', emotional_weight: 'สูงมาก' },
  { conflict: 'คนแจ๋น vs คนนิ่ง', detail: 'บุคลิกตรงข้ามสุดขั้ว', emotional_weight: 'กลาง' },
];
const REAL_SECTIONS = [
  { section: 'อ้นอาบน้ำสระผมป้อนยาเอง 1 ปี', why_strong: 'เห็นภาพ จับต้องได้' },
  { section: 'คำสัญญาวันแต่งงาน', why_strong: 'ปมที่คนจำได้' },
];

t('1 conflicts จริง → ได้ข้อความอ่านออก ไม่มี [object Object]',
  withEnv(undefined, () => {
    const r = flattenList(REAL_CONFLICTS, ' | ');
    return !r.includes('[object Object]') && r.includes('รักในวันแต่งงาน vs รักในวันพักฟื้น') && r.includes('คนแจ๋น vs คนนิ่ง');
  }));

t('2 best_sections จริง → คลี่ฟิลด์ section ออกมาถูก',
  withEnv(undefined, () => {
    const r = flattenList(REAL_SECTIONS, ' | ');
    return !r.includes('[object Object]') && r.includes('อ้นอาบน้ำสระผมป้อนยาเอง 1 ปี');
  }));

t('3 ตัวคั่นถูกใช้จริง (ไม่ได้ hardcode)',
  withEnv(undefined, () => flattenList(REAL_CONFLICTS, ', ').split(', ').length === 2 &&
    flattenList(REAL_CONFLICTS, ' | ').includes(' | ')));

t('4 อาเรย์สตริงล้วน (quotes/pain_points) → ผลเท่าเดิมเป๊ะกับ .join() เดิม — ไม่ทำของที่ไม่พังให้พัง',
  withEnv(undefined, () => {
    const a = ['ประโยคหนึ่ง', 'ประโยคสอง', 'ประโยคสาม'];
    return flattenList(a, ' | ') === a.join(' | ');
  }));

t('5 อ็อบเจกต์ชื่อฟิลด์ที่ไม่รู้จัก → คลี่ค่าข้อความออกมา ดีกว่าทิ้งเป็น [object Object]',
  withEnv(undefined, () => {
    const r = flattenList([{ ประเด็น: 'ของสำคัญ', นน: 'สูง' }], ' | ');
    return !r.includes('[object Object]') && r.includes('ของสำคัญ');
  }));

t('6 อ็อบเจกต์ว่าง/null/undefined ปนมา → ไม่ล้ม และไม่ทิ้งขยะลงพรอมต์',
  withEnv(undefined, () => {
    const r = flattenList([{ conflict: 'ก' }, null, undefined, {}, { conflict: 'ข' }], ' | ');
    return r === 'ก | ข';
  }));

t('7 ไม่ใช่อาเรย์ (undefined/null/สตริง/อ็อบเจกต์) → คืนค่าว่าง ไม่ throw',
  withEnv(undefined, () => flattenList(undefined) === '' && flattenList(null) === '' &&
    flattenList('abc') === '' && flattenList({ a: 1 }) === ''));

t('8 อาเรย์ว่าง → ค่าว่าง',
  withEnv(undefined, () => flattenList([], ' | ') === ''));

t('9 ตัวเลข/บูลีนปนมา → แปลงเป็นข้อความ ไม่หาย',
  withEnv(undefined, () => flattenList([1, 'สอง', 3], ' | ') === '1 | สอง | 3'));

t('10 ลำดับฟิลด์: conflict มาก่อน detail (เอาหัวข้อ ไม่ใช่รายละเอียด)',
  withEnv(undefined, () => flattenList([{ detail: 'รายละเอียดยาว', conflict: 'หัวข้อสั้น' }]) === 'หัวข้อสั้น'));

// ═══ ② สวิตช์ถอย — ต้องกลับไปเป็นของเดิมเป๊ะ ═══
t('11 BREAKDOWN_LIST_FIX=0 → กลับไปพฤติกรรมเดิมเป๊ะ (ได้ [object Object] เหมือนก่อนแก้)',
  withEnv('0', () => flattenList(REAL_CONFLICTS, ' | ') === REAL_CONFLICTS.join(' | ')));

t('12 BREAKDOWN_LIST_FIX=0 กับสตริงล้วน → เท่า .join() เดิม',
  withEnv('0', () => flattenList(['ก', 'ข'], ', ') === 'ก, ข'));

t('13 ค่าอื่นที่ไม่ใช่ "0" (1/ว่าง/on/ขยะ) → ใช้ของที่แก้แล้ว (ตั้งต้น=แก้แล้ว ไม่ต้องตั้ง env)',
  ['1', '', 'on', 'true', 'abc', undefined].every((v) =>
    withEnv(v, () => !flattenList(REAL_CONFLICTS, ' | ').includes('[object Object]'))));

t('14 สวิตช์ถอยทน อัญประกาศ/ช่องว่าง ("0" กับ \' "0" \' ต้องถอยเหมือนกัน)',
  withEnv('"0"', () => flattenList(REAL_CONFLICTS).includes('[object Object]')) &&
  withEnv(' 0 ', () => flattenList(REAL_CONFLICTS).includes('[object Object]')));

// ═══ ③ การต่อสาย — 4 จุดเรียกจริงต้องใช้ตัวคลี่ ไม่ใช่ .join() ดิบ ═══
// ⚠️ ต้องตัดคอมเมนต์ทิ้งก่อนตรวจ — ไม่งั้นคำอธิบายบั๊กที่เขียนไว้ (มี .join() เป็นตัวอย่าง)
//    จะถูกนับเป็น "โค้ดที่ยังพัง" ทั้งที่เป็นแค่คำอธิบาย
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const WFC = stripComments(WF), TXTC = stripComments(TXT), URLC = stripComments(URLSVC);
const wired = (src, needle) => new RegExp(needle).test(src);

t('15 [ต่อสาย] workflowEngine: conflicts ใช้ flattenList ไม่ใช่ .join() ดิบ',
  wired(WFC, 'จุดขัดแย้ง: \\$\\{flattenList\\(bd\\.conflicts') && !wired(WFC, 'bd\\.conflicts\\.join\\('));

t('16 [ต่อสาย] workflowEngine: best_sections ใช้ flattenList ไม่ใช่ .join() ดิบ',
  wired(WFC, 'ท่อนดีที่สุด: \\$\\{flattenList\\(bd\\.best_sections') && !wired(WFC, 'bd\\.best_sections\\.join\\('));

t('17 [ต่อสาย] สาย TEXT (ตัวจริงที่ใช้งาน): conflicts ขั้นวางแผน ใช้ flattenList',
  wired(TXTC, 'const conflicts = flattenList\\(actualBreakdown\\.conflicts') &&
  !wired(TXTC, 'actualBreakdown\\.conflicts\\?\\.join\\('));

t('18 [ต่อสาย] สาย TEXT: best_sections ขั้น "เขียนจริง" ใช้ flattenList',
  wired(TXTC, 'flattenList\\(actualBreakdown\\.best_sections') &&
  !wired(TXTC, 'actualBreakdown\\.best_sections\\.join\\('));

t('19 [ต่อสาย] สาย URL (แฝด): conflicts + best_sections ใช้ flattenList ทั้งคู่',
  wired(URLC, 'const conflicts = flattenList\\(actualBreakdown\\.conflicts') &&
  wired(URLC, 'flattenList\\(actualBreakdown\\.best_sections') &&
  !wired(URLC, 'actualBreakdown\\.conflicts\\?\\.join\\(') &&
  !wired(URLC, 'actualBreakdown\\.best_sections\\.join\\('));

t('20 [ต่อสาย] ทั้งสองไฟล์ import flattenList เข้ามาจริง (ไม่งั้นพังตอนรัน)',
  wired(TXTC, 'import \\{[^}]*flattenList[^}]*\\} from .@/lib/workflow/workflowEngine.') &&
  wired(URLC, 'import \\{[^}]*flattenList[^}]*\\} from .@/lib/workflow/workflowEngine.'));

t('21 [ต่อสาย] flattenList ถูก export ออกจาก workflowEngine',
  wired(WFC, 'export function flattenList\\('));

// 🔴 ข้อนี้เขียนผิดมา 2 รอบ — เป็นบทเรียนที่แพงที่สุดของงานนี้:
//   รอบ 1: assert ว่า `quotes?.join(` ต้องยังอยู่ = **ข้อสอบล็อกบั๊กไว้** ใครแก้ให้ถูกจะเจอแดงแล้วถอย
//   รอบ 2: ยังเคลมว่า pain_points ปลอดภัย ทั้งที่ดูข้อมูลแค่ 4 ชุด
//   ความจริงจากตัวอย่างจริง 26 ชุด (คิวงานจริง 22 + ผลรัน 4):
//     conflicts เป็นกล่อง 85% · best_sections 69% · quotes 31% · pain_points 23% · emotional_hooks 0%
//   ⇒ เหลือช่องเดียวที่ยืนยันได้ว่าเป็นสตริงเสมอคือ emotional_hooks
//   บทเรียน: ข้อสอบชนิด "ห้ามแตะตรงนี้" ต้องมีข้อมูลจริงครบพอ ไม่ใช่เดาจากชื่อฟิลด์หรือดูไม่กี่ใบ
t('22 [ไม่ล้ำเส้น] emotional_hooks — ช่องเดียวที่วัดแล้วเป็นสตริง 26/26 ชุด — ไม่ถูกแตะ',
  wired(TXTC, 'actualBreakdown\\.emotional_hooks\\.join\\(') &&
  /const emotionalHooks = bd\.emotional_hooks \|\| \[\];/.test(read('src/lib/input-engine/narrativePayloadText.js')));

t('23 [ไม่ล้ำเส้น] key_points ยังใช้ .map(kp => kp.point || kp) แบบเดิม ไม่ถูกเปลี่ยนรูป',
  wired(TXTC, 'key_points\\?\\.map\\(kp => kp\\.point \\|\\| kp\\)') &&
  wired(URLC, 'key_points\\?\\.map\\(kp => kp\\.point \\|\\| kp\\)'));

// ═══ ④ ด่านสุดท้าย — พรอมต์จริงที่ยิงเข้านักเขียน ต้องไม่มี [object Object] เลยแม้แต่ตัวเดียว ═══
// 🔴 ข้อสอบชุดนี้เกิดจากที่ผู้ตรวจอิสระจับได้ว่า ①②③ ยังไม่พอ:
//    ท่อข่าวอัตโนมัติ (mode analyze) ส่ง breakdown เข้าพรอมต์ผ่าน formatNarrativePayload "ทางเดียว"
//    (summarizeServiceText: สร้างที่ 1259 → เข้าพรอมต์ที่ 1401) ซึ่งตอนนั้นยังพัง 4 จุดโดยไม่มีใครเห็น
//    บทเรียน: อย่าตรวจแค่ "ฟังก์ชันถูกไหม/ต่อสายครบไหม" ต้องตรวจ "ผลสุดท้ายที่ AI ได้เห็นจริง"
const NP = read('src/lib/input-engine/narrativePayloadText.js');
const NPU = read('src/lib/input-engine/narrativePayload.js');

// ประกอบโมดูลจากซอร์สจริง โดยฝัง flattenItem แทน import '@/...' (node ตามเส้น @ ไม่ได้)
const wfBlock = WF.slice(start, end).replace(/^export /gm, '');
const npSrc = wfBlock + '\n' + NP.replace(/^import .*from '@\/lib\/workflow\/workflowEngine';.*$/m, '');
const np = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(npSrc));

// breakdown ของจริงจากการรัน 16 ส.ค. 69 (_audit-16aug/out-3way-on-a.json) — รูปเดียวกันเป๊ะ
const REAL_BD = {
  core_story: 'อ้น ศรีพรรณ ดูแล เอ อนันต์ ด้วยมือตัวเองนานกว่า 1 ปี',
  conflict_point: 'ชีวิตคู่ต้องเจอบททดสอบใหญ่',
  conflicts: REAL_CONFLICTS,
  best_sections: REAL_SECTIONS,
  quotes: ['ไม่ว่าลุงเอจะอยู่ในสภาพไหน หนูจะดูแลอย่างดีที่สุด'],
  pain_points: ['ความจำเสื่อมชั่วคราว'],
  emotional_hooks: ['คำสัญญาที่ทำจริง'],
  key_points: [{ point: 'ดูแลเองทุกอย่าง', detail: 'อาบน้ำ สระผม ป้อนยา' }],
  key_facts: { people: ['อ้น ศรีพรรณ', 'เอ อนันต์'], dates: [], places: [] },
};
// 🔴 เนื้อข่าวมี "วันที่ไทย" — เงื่อนไขจุดระเบิดที่ผู้ตรวจวัดว่าโดน 16% ของข่าวในคลัง
const BODY_WITH_DATE = 'เมื่อวันที่ 10 สิงหาคม 2569 อ้น ศรีพรรณ เล่าว่าดูแล เอ อนันต์ มานานกว่า 1 ปี และเมื่อ 5 ก.ค. 2568 อาการเริ่มดีขึ้น';

const buildPrompt = (bd, body) =>
  np.formatNarrativePayload(np.buildNarrativePayload('อ้น ศรีพรรณ - เอ อนันต์', bd, null, null, body));

t('24 [ด่านสุดท้าย] พรอมต์จริงที่นักเขียนได้เห็น ต้องไม่มี [object Object] เลย',
  withEnv(undefined, () => !buildPrompt(REAL_BD, BODY_WITH_DATE).includes('[object Object]')));

t('25 [ด่านสุดท้าย] แก่นดราม่าต้องไปถึงนักเขียนจริง (ไม่ใช่แค่ไม่มีขยะ)',
  withEnv(undefined, () => {
    const p = buildPrompt(REAL_BD, BODY_WITH_DATE);
    return p.includes('รักในวันแต่งงาน vs รักในวันพักฟื้น') && p.includes('อ้นอาบน้ำสระผมป้อนยาเอง 1 ปี');
  }));

t('26 [กันล้ม] ข่าวมีวันที่ไทย + best_sections เป็นกล่อง → ต้องไม่ throw (เดิม TypeError = ข่าวล้มทั้งใบ)',
  withEnv(undefined, () => { try { buildPrompt(REAL_BD, BODY_WITH_DATE); return true; } catch { return false; } }));

t('27 [กันล้ม] เกราะกันล้มต้องอยู่ "นอกสวิตช์" — ปิดฟิกซ์แล้วก็ยังต้องไม่ล้ม',
  withEnv('0', () => { try { buildPrompt(REAL_BD, BODY_WITH_DATE); return true; } catch { return false; } }));

t('28 [สวิตช์ถอย] ปิดฟิกซ์ → ขยะกลับมาเหมือนเดิม (พิสูจน์ว่าถอยได้จริง ไม่ใช่แค่ชื่อสวิตช์)',
  withEnv('0', () => buildPrompt(REAL_BD, BODY_WITH_DATE).includes('[object Object]')));

t('29 [ต่อสาย] แฝดสาย URL แก้ครบ 3 จุดเดียวกัน (best_sections / conflicts / เกราะกันล้ม)',
  /event: flattenItem\(s\)/.test(NPU) && /\(bd\.conflicts \|\| \[\]\)\.map\(flattenItem\)/.test(NPU) &&
  /String\(t\.event \?\? ''\)/.test(NPU) && !/t\.event\.includes\(/.test(stripComments(NPU)));

t('30 [รูที่ผู้ตรวจเจาะ] กล่องซ้อนกล่อง {conflict:{...}} ต้องไม่ทะลุเป็น [object Object]',
  withEnv(undefined, () => {
    const r = flattenList([{ conflict: { left: 'ก', right: 'ข' }, detail: 'เนื้อสำรอง' }], ' | ');
    return !r.includes('[object Object]') && r === 'เนื้อสำรอง';
  }));

t('31 [รูที่ผู้ตรวจเจาะ] มีเพดานกันพรอมต์บวม (ใบยาว 5000 ตัว × 500 ใบ ต้องไม่หลุดเป็นแสนตัวอักษร)',
  withEnv(undefined, () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ conflict: 'ก'.repeat(5000) + i }));
    return flattenList(big, ' | ').length < 12000;
  }));

// 🔴 เกราะกันล้มมีค่าเฉพาะช่องทางนี้: key_facts.dates ไม่ได้ผ่านตัวคลี่ (บรรทัด 91-93)
//    ถ้าโมเดลคืน dates เป็นกล่องเมื่อไร .includes จะ throw = ข่าวล้มทั้งใบ — ต้องกันไว้แม้ปิดสวิตช์
t('33 [กันล้ม] key_facts.dates เป็นกล่อง + ข่าวมีวันที่ไทย → ต้องไม่ล้ม (ทั้งเปิดและปิดสวิตช์)',
  [undefined, '0'].every((v) => withEnv(v, () => {
    try { buildPrompt({ ...REAL_BD, key_facts: { people: [], dates: [{ date: '10 ส.ค. 2569' }], places: [] } }, BODY_WITH_DATE); return true; }
    catch { return false; }
  })));

t('32 [ค่าศูนย์] ฟิลด์ที่มีค่าเป็นเลข 0 ต้องไม่ถูกข้าม',
  withEnv(undefined, () => flattenList([{ point: 0, detail: 'ไม่ควรได้อันนี้' }]) === '0'));

// ═══ ⑤ รอบผู้ตรวจรอบสอง — quotes เป็นกล่อง + รูที่ mutation ยังไม่ถูกจับ ═══
// 🔴 quotes: เจอเป็นกล่อง {quote,speaker,context,emotional_impact} จริง 1 ใน 4 ใบ (out-live-tak-nuay.json)
const REAL_QUOTES = [{ quote: 'ปรับแต่ไม่เปลี่ยน', speaker: 'หนุ่ย ธาดา', context: 'ยอมรับในเรื่องที่ผิด', emotional_impact: 'ประโยคสั้นที่มีแรงถกเถียงสูง' }];

t('34 [quotes] กล่องคำพูดต้องคลี่ได้ และต้องเอา "ประโยค" ไม่ใช่คำวิจารณ์ของ AI',
  withEnv(undefined, () => flattenList(REAL_QUOTES, ' | ') === 'ปรับแต่ไม่เปลี่ยน'));

t('35 [ต่อสาย quotes] ทั้ง 3 จุดใช้ตัวคลี่ ไม่ใช่ .join() ดิบ (สาย TEXT / สาย URL / buildFullContext)',
  wired(TXTC, "const quotes = flattenList\\(actualBreakdown\\.quotes") &&
  wired(URLC, "const quotes = flattenList\\(actualBreakdown\\.quotes") &&
  wired(WFC, 'flattenList\\(bd\\.quotes') &&
  !wired(TXTC, 'actualBreakdown\\.quotes\\?\\.join\\(') && !wired(WFC, 'bd\\.quotes\\.join\\('));

t('36 [ประโยคเด็ดต้องไม่หายเงียบ] ของจริงชื่อฟิลด์ quote ไม่ใช่ text — ต้องไปถึงนักเขียน',
  withEnv(undefined, () => {
    const p = buildPrompt({ ...REAL_BD, quotes: REAL_QUOTES }, BODY_WITH_DATE);
    return p.includes('ปรับแต่ไม่เปลี่ยน') && !p.includes('[object Object]');
  }));

// 🔴 ข้อนี้เคย assert แค่ "ไม่ล้ม" — ผู้ตรวจชี้ว่านั่นคือการเปลี่ยนอาการดังเป็นอาการเงียบ
//    ซึ่งคือโรคที่งานทั้งชุดนี้กำลังรักษาอยู่ ⇒ ต้อง assert "ไม่มีขยะ" ด้วย ไม่ใช่แค่ไม่ล้ม
t('37 [กันล้ม+ไม่มีขยะ] people เป็นกล่อง + ข่าวมีชื่อคนไทย → ไม่ล้ม และพรอมต์ต้องไม่มี [object Object]',
  withEnv(undefined, () => {
    try {
      const p = buildPrompt({ ...REAL_BD, key_facts: { people: [{ name: 'อ้น ศรีพรรณ' }], dates: [], places: [] } },
        'ครูสมชาย ใจดี เล่าว่า นางสาวมานี รักเรียน ดูแลกันมานาน');
      return !p.includes('[object Object]') && p.includes('อ้น ศรีพรรณ');
    } catch { return false; }
  }) && withEnv('0', () => {
    try {
      buildPrompt({ ...REAL_BD, key_facts: { people: [{ name: 'อ้น ศรีพรรณ' }], dates: [], places: [] } },
        'ครูสมชาย ใจดี เล่าว่า นางสาวมานี รักเรียน ดูแลกันมานาน');
      return true; // ปิดสวิตช์แล้วขยะกลับมาได้ แต่ห้ามล้ม
    } catch { return false; }
  }));

t('38 [กันล้ม quotes] quotes มี null ปนมา → ต้องไม่ล้ม',
  withEnv(undefined, () => { try { buildPrompt({ ...REAL_BD, quotes: [null, 'ปกติ'] }, BODY_WITH_DATE); return true; } catch { return false; } }));

// 🔴 3 ข้อนี้ปิดรูที่ผู้ตรวจพบว่า "ทุบแล้วข้อสอบยังเขียว" (M9/M11/M12)
t('39 [ปิดรู M9] ลำดับคีย์: detail ต้องชนะ name/title/value — ใครสลับกลับต้องแดง',
  withEnv(undefined, () => flattenList([{ name: 'อ้น', title: 'นักแสดง', detail: 'แก่นเรื่องที่ต้องใช้' }]) === 'แก่นเรื่องที่ต้องใช้'));

t('40 [ปิดรู M12] ใบที่คลี่แล้วว่างต้องถูกคัดทิ้ง ไม่ทิ้งตัวคั่นเปล่าไว้ในพรอมต์',
  withEnv(undefined, () => flattenList([{ conflict: 'ก' }, {}, { conflict: 'ข' }, { emotional_weight: {} }], ' | ') === 'ก | ข'));

// ⚠️ ข้อนี้แก้มา 2 รอบ:
//    รอบ 1 เขียนกว้างไปจนไปจับอีกฟังก์ชัน (VIRAL_SHORTLIST_K) ที่ใช้ console.log อย่างถูกต้องอยู่แล้ว
//    รอบ 2 ผู้ตรวจฝั่งรันจริงทุบนิยาม _warnOnce ให้เตือนทุกครั้ง แล้วข้อสอบยังเขียว
//      = ค้นคำ ไม่ได้ตรวจพฤติกรรม ⇒ รอบนี้ดึงตัว _warnOnce จริงมารันแล้วนับจำนวนครั้งที่มันพิมพ์
t('41 [ปิดรู M11] คำเตือนเพดานครูต้องเตือน "ครั้งเดียวจริง" — ตรวจพฤติกรรม ไม่ใช่ค้นคำ',
  (() => {
    const VF = stripComments(read('src/lib/services/viralFewshot.js'));
    const a = VF.indexOf('let _exWarned'), b = VF.indexOf('export function exampleChars');
    if (a < 0 || b <= a) return false;
    let hits = 0;
    const realLog = console.log;
    console.log = () => { hits++; };
    try {
      // eslint-disable-next-line no-new-func
      new Function(VF.slice(a, b) + '\n_warnOnce("x");_warnOnce("y");_warnOnce("z");')();
    } finally { console.log = realLog; }
    const rawLog = (VF.match(/console\.log\(`\[ViralFewshot\] 📏 VIRAL_EXAMPLE_CHARS/g) || []).length;
    return hits === 1 && rawLog === 0;
  })());

t('42 [ตัดแล้วต้องส่งเสียง] เพดานจำนวนใบตัดของทิ้ง ต้องมี log ไม่ตัดเงียบ (บทเรียนเพดานครู 700)',
  /เกินเพดาน \$\{_LIST_MAX\}/.test(WF) || /_LIST_MAX\} — ตัดทิ้ง/.test(WF));

// ═══ ⑥ รอบสาม — วัดจากตัวอย่างจริง 26 ชุด (เดิมดูแค่ 4 ชุดเลยเคลมผิด 2 รอบ) ═══
// รูปฟิลด์ที่เจอจริงทั้งหมด ใช้ของจริงจาก data/job_queue.json ไม่ใช่ตัวอย่างสมมติ
const REAL_PAIN_A = [{ pain_point: 'ต้องดูแลคนรักที่จำอะไรไม่ได้', detail: 'ทำเองทุกอย่างนานกว่า 1 ปี', emotion: 'เหนื่อยแต่ไม่ทิ้ง' }];
const REAL_PAIN_B = [{ pain: 'ถูกนอกใจแต่เลือกอยู่ต่อ', why_it_hits: 'คนอ่านเคยเจอเอง' }];
const REAL_Q_CONTENT = [{ type: 'direct', content: 'ปรับแต่ไม่เปลี่ยน', speaker: 'หนุ่ย ธาดา' }];

t('43 [pain_points] รูป {pain_point,...} ต้องคลี่ได้ (เจอจริง 23% ของ 26 ชุด — ผมเคยเคลมว่าปลอดภัย)',
  withEnv(undefined, () => flattenList(REAL_PAIN_A) === 'ต้องดูแลคนรักที่จำอะไรไม่ได้'));

t('44 [pain_points] รูป {pain, why_it_hits} ต้องเอา "ความเจ็บ" ไม่ใช่คำวิจารณ์ของ AI',
  withEnv(undefined, () => flattenList(REAL_PAIN_B) === 'ถูกนอกใจแต่เลือกอยู่ต่อ'));

t('45 [pain_points] เข้าพรอมต์นักเขียนแล้วต้องไม่มีขยะ และเนื้อต้องไปถึง',
  withEnv(undefined, () => {
    const p = buildPrompt({ ...REAL_BD, pain_points: REAL_PAIN_A }, BODY_WITH_DATE);
    return !p.includes('[object Object]') && p.includes('ต้องดูแลคนรักที่จำอะไรไม่ได้');
  }));

t('46 [quotes รูปที่ 3] {type,content,speaker} — ประโยคเด็ดต้องไม่ถูกทิ้ง (2 ใบใน 26 เป็นรูปนี้)',
  withEnv(undefined, () => {
    const p = buildPrompt({ ...REAL_BD, quotes: REAL_Q_CONTENT }, BODY_WITH_DATE);
    return p.includes('ปรับแต่ไม่เปลี่ยน') && !p.includes('[object Object]');
  }));

t('47 [ต่อสาย pain_points] ตัวประกอบโครงเรื่องทั้งคู่ต้องคลี่ ไม่ยัดกล่องดิบ',
  /\(bd\.pain_points \|\| \[\]\)\.map\(flattenItem\)/.test(NP) &&
  /\(bd\.pain_points \|\| \[\]\)\.map\(flattenItem\)/.test(NPU));

t('48 [ต่อสาย MasterAgent] painPoints + quotes ใน MasterAgent ต้องคลี่ (เดิม q.text ที่ไม่มีอยู่จริง = undefined)',
  (() => {
    const MA = stripComments(read('src/lib/agents/masterAgent.js'));
    return /flattenList\(m\.emotional\.painPoints/.test(MA) && /flattenList\(m\.entities\.quotes/.test(MA) &&
      !/m\.emotional\.painPoints\.join\(/.test(MA) && !/q\.text\)\.join/.test(MA) &&
      /import \{[^}]*flattenList[^}]*\} from '\.\.\/workflow\/workflowEngine\.js'/.test(MA);
  })());

t('49 [ชื่อฟิลด์ครบทุกรูปที่เจอจริง] conflict/section/quote/content/pain_point/pain ต้องอยู่ใน _LIST_KEYS',
  ['conflict', 'section', 'quote', 'content', 'pain_point', 'pain'].every((k) => new RegExp(`'${k}'`).test(WF.slice(WF.indexOf('const _LIST_KEYS'), WF.indexOf('const _ITEM_MAX')))));

// ═══ ⑦ ปิดรูที่ผู้ตรวจทุบแล้วข้อสอบยังเขียว + ตาข่ายรวม ═══
// 🔴 ฝาแฝดสาย URL: ข้อ 47 ปิด pain_points ให้แล้ว แต่ลืม quote/people ของรอบสอง — ทุบแล้วเคยเขียว
t('50 [ฝาแฝด URL] quote fix + เกราะ people ต้องมีในสาย URL ด้วย (เดิมทุบแล้วข้อสอบเขียว)',
  /q\?\.quote \|\| q\?\.content \|\| q\?\.text/.test(NPU) &&
  /String\(p \?\? ''\)/.test(NPU) &&
  /\(bd\.key_facts\?\.people \|\| \[\]\)\.map\(flattenItem\)/.test(NPU));

t('51 [ตาข่ายรวม] numbers/places ที่ยัดเข้า "ข้อมูลพื้นฐาน" ต้องผ่านตัวคลี่ทั้งสองไฟล์',
  [NP, NPU].every((s) => /type: 'statistic', data: flattenItem\(n\)/.test(s) && /type: 'location', data: flattenItem\(p\)/.test(s)));

t('52 [ตาข่ายรวม] numbers/places เป็นกล่อง → พรอมต์ต้องไม่มีขยะ',
  withEnv(undefined, () => {
    const p = buildPrompt({ ...REAL_BD, key_facts: { people: [], dates: [], places: [{ name: 'โรงพยาบาลศิริราช' }], numbers: [{ value: '19 ปี' }] } }, BODY_WITH_DATE);
    return !p.includes('[object Object]') && p.includes('โรงพยาบาลศิริราช') && p.includes('19 ปี');
  }));

t('53 [กันล้ม key_points] key_points[].point เป็นกล่อง + ข่าวมี quote → ต้องไม่ล้ม (รอยร้าวเก่า d414a8d ก็ล้ม)',
  [undefined, '0'].every((v) => withEnv(v, () => {
    try {
      buildPrompt({ ...REAL_BD, key_points: [{ point: { a: 1 }, detail: 'x' }], quotes: ['คำพูดสั้น'] }, BODY_WITH_DATE);
      return true;
    } catch { return false; }
  })));

t('54 [รีเสิร์ช] จุดที่หลับอยู่เพราะสวิตช์ปิด ต้องถูกปิดไว้ล่วงหน้า (เปิด NEWS_RESEARCH เมื่อไรบั๊กจะไม่ฟื้น)',
  (() => {
    const RS = stripComments(read('src/lib/services/researchService.js'));
    return /flattenList\(breakdownData\?\.quotes/.test(RS) &&
      /flattenList\(breakdownData\?\.key_facts\?\.people/.test(RS) &&
      /flattenList\(breakdownData\?\.key_facts\?\.places/.test(RS) &&
      !/breakdownData\?\.quotes\?\.join\(/.test(RS);
  })());

// 🔴 รูที่ผู้ตรวจฝั่งรันจริงเจอ: สวิตช์ถอยมี 2 ชั้นซ้อน (flattenList + flattenItem)
//    ถอดชั้นเดียวแล้วอีกชั้นถอยแทน อาการหลักยังถูก ข้อสอบเลยเขียว — แต่ขอบเคสเพี้ยนเงียบ
t('55 [ปิดรู 2 ชั้น] ถอดสวิตช์ชั้นใดชั้นหนึ่งต้องแดง — ตรวจว่าทั้ง flattenList และ flattenItem อ่านสวิตช์เอง',
  (() => {
    const blk = WF.slice(WF.indexOf('function _fixOn'), WF.indexOf('export function buildFullContext'));
    const item = blk.slice(blk.indexOf('export function flattenItem'), blk.indexOf('export function flattenList'));
    const list = blk.slice(blk.indexOf('export function flattenList'));
    return /_fixOn\(\)/.test(item) && /_fixOn\(\)/.test(list);
  })());

t('56 [ปิดรู 2 ชั้น] ปิดสวิตช์แล้วขอบเคสต้องถอยด้วย: เกินเพดานจำนวนใบต้องไม่ถูกตัด',
  withEnv('0', () => {
    const big = Array.from({ length: 25 }, (_, i) => 'ใบที่' + i);
    return flattenList(big, ' | ').split(' | ').length === 25;
  }));

// 🔴 รูที่ผู้ตรวจฝั่งรันจริงเจอเพิ่ม: ตัวคัดของว่างในตัวประกอบโครงเรื่อง ไม่มีข้อสอบคุมเลย
//    ถอดทิ้งแล้วเขียวทั้งข้อสอบเก่าและใหม่ — ผลคือพรอมต์มีบรรทัดเปล่า/ตัวคั่นลอยให้ AI งง
t('57 [ปิดรู filter] ของว่าง/null ในช่องต่างๆ ต้องไม่กลายเป็นบรรทัดเปล่าหรือตัวคั่นลอยในพรอมต์',
  withEnv(undefined, () => {
    const p = buildPrompt({
      ...REAL_BD,
      pain_points: [{ pain_point: 'ของจริง' }, {}, null, { emotion: {} }],
      key_facts: { people: ['อ้น ศรีพรรณ', {}, null], dates: [], places: [] },
      quotes: ['คำพูดจริง', '', null, {}],
    }, BODY_WITH_DATE);
    // อาการที่ต้องไม่มี: ตัวคั่นลอยทั้งแบบ " | " และ ", " · รายการเลขที่ว่าง · คำพูดว่าง ""
    return !/\|\s*\|/.test(p) && !/:\s*\|/.test(p) && !/\|\s*\n/.test(p) &&   // ตัวคั่นแท่ง
      !/,\s*,/.test(p) && !/:\s*,/.test(p) && !/,\s*\n/.test(p) &&            // ตัวคั่นจุลภาค (👤 บุคคลสำคัญ)
      !/\d+\.\s*\n/.test(p) && !/\d+\.\s*""/.test(p) &&                       // รายการเลข/คำพูดว่าง (💬 คำพูดสำคัญ)
      !p.includes('[object Object]');
  }));

console.log(`\n${fail === 0 ? '🎉' : '🔴'} ผ่าน ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);

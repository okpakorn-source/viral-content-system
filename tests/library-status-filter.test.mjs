// ★ 3 ก.ย. 69 (F7 แบบ FINAL card-library §2) — ตัวกรองสถานะการ์ดในท่อข่าว: src/lib/ai/libraryStatus.js (isCardSelectable · selectableCards)
//   รันได้โดยไม่ต้องตั้ง env: node --test tests/library-status-filter.test.mjs
//   โหลด helper จริงด้วย dynamic import (ไฟล์ไม่มี import '@/…') · ไฟล์บริการ 2 ตัว (~3,000 บรรทัด import '@/…') อ่านเป็นข้อความ
//   แล้ว "ดึงตัวกรองจริง" ออกมารันด้วย new Function — snapshot จึงทดสอบ predicate ที่อยู่ในไฟล์จริง ไม่ใช่สำเนาในเทส
//
//   สัญญาที่คุ้มครอง:
//   1. isCardSelectable: ไม่มี status / '' / null / 'active' → true · archived/proposed/ค่าอื่น → false · card null/undefined → false (ไม่โยน)
//      CARD_LIBRARY_V2='0' → true ทุกใบ (รวม null) · อ่าน env สดทุกครั้ง (flip ไปกลับใน process เดียว ไม่ต้อง import ใหม่)
//      selectableCards(list): ปิดสวิตช์ → คืน list "ตัวเดิม" (=== reference เดียวกัน ไม่ใช่สำเนา) · เปิด → อาเรย์ใหม่ตัด archived/proposed · ไม่ใช่อาเรย์ → คืนค่าเดิม
//      (ผู้ตรวจไขว้ byte-identical: mix ที่ HEAD sort() ทับอาเรย์ที่ getAll คืน = reference เดียวกับ persistStore._memCache → ปิดสวิตช์ต้อง sort ทับตัวเดิมเหมือน HEAD
//       ถ้าคืนสำเนา ลำดับใน memCache/ไฟล์ที่ sync จะต่างจาก HEAD → analyze/getTopPrompts/ToneFilter-fallback หยิบคนละใบตอน Supabase ล่ม)
//   2. source contract ต่อไฟล์ (summarizeServiceText.js · summarizeService.js): import { isCardSelectable, selectableCards } จาก '@/lib/ai/libraryStatus' 1 บรรทัด +
//      ทางเข้าตามแบบ F7 = filter(p => p.promptText …) 3 จุด (analyze · getTopPrompts cached · getTopPrompts load) + mix 1 จุด
//      (promptLib = selectableCards(promptLib) ทันทีหลัง mixPromptStore.getAll — คลุมทั้ง matched และ fallback sort()[0] · ห้ามใช้ .filter สำเนาที่ mix)
//      + ToneFilter fallback ที่อ่าน data/prompt-library.json ตรง (.find(p => p.promptText …)) 1 จุด = 5 จุด/ไฟล์ · รวม 10 จุด
//      ห้ามเหลือ filter/find(p => p.promptText ที่ไม่มี isCardSelectable(p) · จำนวนจุดโหลดคลัง (getAll/prompt-library.json/createStore) ตรึงไว้
//      — ถ้าใครเพิ่มทางเข้าใหม่ ตัวนับจะแดงให้มาทบทวน F7 (trackStore = สถิติ usageCount ไม่กรอง — จงใจ)
//   3. snapshot: CARD_LIBRARY_V2='0' → ผลกรองรายการตัวอย่าง (มี archived/proposed ปน) เท่ากับตัวกรองเดิมทุกไบต์ (stringify เท่ากัน)
//      ทุก predicate ที่ดึงจากไฟล์จริง · mix ปิดสวิตช์: selectableCards คืน reference เดิม + sort() ของ fallback ทับอาเรย์ต้นทาง (ลำดับ viralScore-desc เหมือน HEAD)
//      เปิดสวิตช์ → archived/proposed หายทุกทางเข้า (analyze · getTopPrompts+exclude · tone-fallback · mix best) · mix เปิด = sort ทับสำเนา อาเรย์ต้นทางลำดับเดิม
//
// ผลการทุบโค้ด (mutation) — ทุบแล้วต้องแดง แล้วคืนไฟล์ byte-exact (md5 ตรงต้นฉบับทุกรอบ · ยิงจริง 3 ก.ย. 69 รอบแก้ข้อหักล้าง · baseline 15/15 เขียวก่อน-หลัง):
//   M1 summarizeServiceText.js analyze ตัด ` && isCardSelectable(p)`                       → แดง 3 (contract Text + snapshot Text ปิด/เปิด — extract ไม่เจอ predicate)
//   M2 libraryStatus.js สลับสวิตช์ `=== '0'` → `!== '0'` (default กลายเป็นปิด)            → แดง 10 (ก ทั้ง 5 + ข libraryStatus + snapshot ปิด/เปิด ทั้ง 2 ไฟล์)
//   M3 libraryStatus.js selectableCards ตัด `if (libV2Off()) return list;` (สำเนาเสมอ)     → แดง 5 (ก selectableCards 2 + ข libV2Off นับ 1/2 + snapshot ปิด ทั้ง 2 ไฟล์: mixed !== fromStore)
//   M4 summarizeService.js mix ถอยกลับเป็น `promptLib.filter(p => isCardSelectable(p))`     → แดง 3 (contract Svc: MIX_OK 0/1 · COPY_LEFTOVER 1/0 · นับ call ผิด + snapshot Svc 2 เทส extract mix ไม่เจอ)
//   M5 libraryStatus.js ให้ archived ผ่าน (`status === SELECTABLE_STATUS` → `true`)      → แดง 5 (ก เปิด + flip + selectableCards เปิด + snapshot เปิด ทั้ง 2 ไฟล์)
//   M6 summarizeService.js tone-fallback ตัด ` && isCardSelectable(p)`                     → แดง 3 (contract Svc find 0/1 + snapshot Svc 2 เทส)
//   M7 summarizeServiceText.js mix ส่งสำเนา `selectableCards(promptLib.slice())`           → แดง 3 (contract Text MIX_OK 0/1 + snapshot Text ปิด: reference หลุด · เปิด: extract ไม่เจอ)
//   ยืนยันอิสระ: probe ของผู้ตรวจไขว้ (persistStore สำเนา + stub supabase · CARD_LIBRARY_V2=0 · บล็อก mix ตัดจากไฟล์จริง) หลังแก้:
//   orderGetAllWhenSupabaseDown / fileOrderAfterUsageUpdate = [c3,c2,c4,c1] ทั้ง HEAD และ working tree ทั้ง 2 ไฟล์ (รอบก่อน work = [c1,c2,c3,c4] ต่างจาก HEAD)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const { isCardSelectable, selectableCards } = await import('../src/lib/ai/libraryStatus.js');

const FILES = ['src/lib/services/summarizeServiceText.js', 'src/lib/services/summarizeService.js'];
const readSrc = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const count = (src, re) => (src.match(re) || []).length;

const ORIGINAL_ENV = process.env.CARD_LIBRARY_V2;
const setSwitch = (value) => { if (value === undefined) delete process.env.CARD_LIBRARY_V2; else process.env.CARD_LIBRARY_V2 = value; };
const restoreEnv = () => setSwitch(ORIGINAL_ENV);

// ── (ก) isCardSelectable ─────────────────────────────────────────────────────
const CASES = [
  ['ไม่มี status', { id: 'n', promptText: 'x' }, true],
  ['status undefined', { id: 'u', promptText: 'x', status: undefined }, true],
  ['status null', { id: 'nl', promptText: 'x', status: null }, true],
  ['status ว่าง', { id: 'e', promptText: 'x', status: '' }, true],
  ['active', { id: 'a', promptText: 'x', status: 'active' }, true],
  ['archived', { id: 'x', promptText: 'x', status: 'archived' }, false],
  ['proposed', { id: 'p', promptText: 'x', status: 'proposed' }, false],
  // ค่าที่ไม่รู้จักตีความเหมือนหน้า UI (page.js statusOf): ไม่ใช่ archived/proposed = ใช้งาน — ผู้ตรวจไขว้ F7 รอบ 2
  ['ค่าเพี้ยน (ไม่ใช่ archived/proposed = หยิบได้ เหมือน UI)', { id: 'w', promptText: 'x', status: 'Active ' }, true],
  ['ค่าที่ไม่รู้จัก paused', { id: 'w2', promptText: 'x', status: 'paused' }, true],
  ['card null', null, false],
  ['card undefined', undefined, false],
  ['card ไม่ใช่ object', 'archived', false],
];

test('(ก) สวิตช์เปิด (ไม่ตั้ง): ไม่มี status/active/ค่าที่ไม่รู้จัก → true · archived/proposed → false · card null/undefined → false ไม่โยน', () => {
  try {
    setSwitch(undefined);
    for (const [label, card, expected] of CASES) assert.equal(isCardSelectable(card), expected, `ไม่ตั้ง env: ${label}`);
    setSwitch('1');
    for (const [label, card, expected] of CASES) assert.equal(isCardSelectable(card), expected, `env=1: ${label}`);
    setSwitch('true');
    for (const [label, card, expected] of CASES) assert.equal(isCardSelectable(card), expected, `env=true: ${label}`);
  } finally { restoreEnv(); }
});

test('(ก) CARD_LIBRARY_V2=0: true ทุกใบ รวม archived/proposed/null (พฤติกรรมเดิม)', () => {
  try {
    setSwitch('0');
    for (const [label, card] of CASES) assert.equal(isCardSelectable(card), true, `env=0: ${label}`);
  } finally { restoreEnv(); }
});

test('(ก) อ่าน env สดทุกครั้ง: flip 0 → เปิด → 0 ใน process เดียวโดยไม่ import ใหม่', () => {
  const archived = { id: 'x', promptText: 'x', status: 'archived' };
  try {
    setSwitch('0'); assert.equal(isCardSelectable(archived), true);
    setSwitch(undefined); assert.equal(isCardSelectable(archived), false);
    setSwitch('0'); assert.equal(isCardSelectable(archived), true);
    setSwitch('1'); assert.equal(isCardSelectable(archived), false);
  } finally { restoreEnv(); }
});

test('(ก) selectableCards: CARD_LIBRARY_V2=0 → คืน reference เดิม (=== ไม่ใช่สำเนา) แม้มี archived/proposed ปน · ไม่ใช่อาเรย์ → คืนค่าเดิม', () => {
  const arr = [{ id: 'a', status: 'active' }, { id: 'x', status: 'archived' }, { id: 'p', status: 'proposed' }, null];
  try {
    setSwitch('0');
    assert.equal(selectableCards(arr), arr, 'ปิดสวิตช์ต้องคืนอาเรย์ตัวเดิม (sort() ของ mix จะได้ทับ memCache เหมือน HEAD)');
    assert.equal(arr.length, 4, 'ไม่แตะเนื้อ');
    const empty = [];
    assert.equal(selectableCards(empty), empty);
    assert.equal(selectableCards(null), null);
    assert.equal(selectableCards(undefined), undefined);
  } finally { restoreEnv(); }
});

test('(ก) selectableCards: สวิตช์เปิด → อาเรย์ใหม่ตัด archived/proposed/null · ต้นทางไม่ถูกแตะ · ไม่ใช่อาเรย์ → คืนค่าเดิม · flip สด', () => {
  const arr = [{ id: 'a', status: 'active' }, { id: 'x', status: 'archived' }, { id: 'n' }, { id: 'p', status: 'proposed' }, null, { id: 'e', status: '' }];
  const before = JSON.stringify(arr);
  try {
    setSwitch(undefined);
    const out = selectableCards(arr);
    assert.notEqual(out, arr, 'เปิด = อาเรย์ใหม่');
    assert.deepEqual(out.map(c => c.id), ['a', 'n', 'e']);
    assert.equal(JSON.stringify(arr), before, 'ต้นทางไม่ถูกแตะ');
    assert.equal(selectableCards(null), null);
    assert.equal(selectableCards('archived'), 'archived');
    setSwitch('1');
    assert.deepEqual(selectableCards(arr).map(c => c.id), ['a', 'n', 'e'], 'env=1 เท่ากับไม่ตั้ง');
    setSwitch('0');
    assert.equal(selectableCards(arr), arr, 'flip กลับเป็น 0 ใน process เดียว → reference เดิมทันที');
  } finally { restoreEnv(); }
});

// ── (ข) source contract ──────────────────────────────────────────────────────
const IMPORT_RE = /^import \{ isCardSelectable, selectableCards \} from '@\/lib\/ai\/libraryStatus';/mg;
const FILTER_OK_RE = /\.filter\(p => p\.promptText && isCardSelectable\(p\)/g;
const FILTER_LEFTOVER_RE = /\.filter\(p => p\.promptText(?! && isCardSelectable\(p\))/g;
const FIND_OK_RE = /\.find\(p => p\.promptText && isCardSelectable\(p\) && p\.toneClass !== 'negative'\)/g;
const FIND_LEFTOVER_RE = /\.find\(p => p\.promptText(?! && isCardSelectable\(p\))/g;
const MIX_OK_RE = /promptLib = await mixPromptStore\.getAll\(\);[^\n]*\n\s*promptLib = selectableCards\(promptLib\);/g;
const MIX_COPY_LEFTOVER_RE = /promptLib\.filter\(p => isCardSelectable\(p\)\)/g;   // แบบเก่าที่คืนสำเนาแม้ปิดสวิตช์ — ห้ามกลับมา
const CALL_RE = /\bisCardSelectable\(/g;
const SEL_CALL_RE = /\bselectableCards\(/g;
// จุดโหลดคลังที่ตรึงไว้ (ถ้าเปลี่ยน = มีทางเข้าใหม่/หาย → ต้องทบทวนว่ากรองครบไหม)
const LOAD_GETALL_RE = /promptLib = await (?:mix)?[pP]romptStore\.getAll\(\)/g;   // analyze · mix · getTopPrompts
const LOAD_JSON_RE = /'data', 'prompt-library\.json'\)/g;                          // analyze fallback · tone fallback · getTopPrompts fallback
const STORE_RE = /createStore\('prompt-library'\)/g;                               // analyze · trackStore(สถิติ ไม่กรอง) · mix · getTopPrompts

for (const relative of FILES) {
  test(`(ข) ${relative}: import + ทางเข้า 5 จุด (filter 3 · find 1 · mix 1 ผ่าน selectableCards) ครบ ไม่เหลือจุดไม่กรอง`, () => {
    const src = readSrc(relative);
    assert.equal(count(src, IMPORT_RE), 1, 'import { isCardSelectable, selectableCards } from \'@/lib/ai/libraryStatus\' ต้องมี 1 บรรทัด (แบบ @/ เหมือนเพื่อนบ้าน)');
    assert.equal(count(src, FILTER_OK_RE), 3, 'filter(p => p.promptText && isCardSelectable(p) ต้องมี 3 จุด (analyze · getTopPrompts cached · getTopPrompts load)');
    assert.equal(count(src, FILTER_LEFTOVER_RE), 0, 'ห้ามเหลือ filter(p => p.promptText ที่ไม่มี isCardSelectable(p)');
    assert.equal(count(src, FIND_OK_RE), 1, 'ToneFilter fallback (.find(p => p.promptText …)) ต้องกรองสถานะด้วย 1 จุด');
    assert.equal(count(src, FIND_LEFTOVER_RE), 0, 'ห้ามเหลือ find(p => p.promptText ที่ไม่มี isCardSelectable(p)');
    assert.equal(count(src, MIX_OK_RE), 1, 'mix: หลัง mixPromptStore.getAll() ต้องมี promptLib = selectableCards(promptLib) ทันที');
    assert.equal(count(src, MIX_COPY_LEFTOVER_RE), 0, 'mix ห้ามใช้ promptLib.filter(p => isCardSelectable(p)) — คืนสำเนาแม้ปิดสวิตช์ ทำให้ sort() ไม่ทับ memCache เหมือน HEAD');
    assert.equal(count(src, CALL_RE), 4, 'จำนวนจุดเรียก isCardSelectable( ต้อง = 4 (3 filter + 1 find)');
    assert.equal(count(src, SEL_CALL_RE), 1, 'จำนวนจุดเรียก selectableCards( ต้อง = 1 (mix)');
    assert.equal(count(src, /process\.env\.CARD_LIBRARY_V2/g), 0, 'ไฟล์บริการห้ามอ่าน env เอง — ต้องผ่าน libraryStatus.js เท่านั้น');
  });

  test(`(ข) ${relative}: จุดโหลดคลังตรึงจำนวน (getAll 3 · prompt-library.json 3 · createStore 4) — เปลี่ยนแล้วต้องทบทวน F7`, () => {
    const src = readSrc(relative);
    assert.equal(count(src, LOAD_GETALL_RE), 3);
    assert.equal(count(src, LOAD_JSON_RE), 3);
    assert.equal(count(src, STORE_RE), 4);
  });
}

test('(ข) libraryStatus.js: อ่าน env จุดเดียว เทียบ === \'0\' (แบบเดียวกับ isCardLibV2 ใน route.js) และไม่ cache · export 2 ตัว', () => {
  const src = readSrc('src/lib/ai/libraryStatus.js');
  assert.equal(count(src, /process\.env\.CARD_LIBRARY_V2 === '0'/g), 1);
  assert.equal(count(src, /process\.env\./g), 1, 'อ่าน env ตัวเดียว จุดเดียว (libV2Off) — isCardSelectable/selectableCards เรียกผ่านมัน');
  assert.equal(count(src, /\blibV2Off\(\)/g), 2, 'isCardSelectable + selectableCards เช็คสวิตช์ผ่าน libV2Off() ทั้งคู่');
  assert.equal(count(src, /export function isCardSelectable\(card\)/g), 1);
  assert.equal(count(src, /export function selectableCards\(list\)/g), 1);
  assert.doesNotMatch(src, /const \w+ = process\.env\.CARD_LIBRARY_V2/, 'ห้าม cache ค่า env ไว้ระดับโมดูล');
});

// ── (ค) snapshot: ดึง predicate จริงจากไฟล์มารัน ─────────────────────────────
// ลำดับจงใจ: ใบ non-negative ใบแรก = archived (x1) เพื่อพิสูจน์ tone-fallback ข้ามใบพักเมื่อเปิด · archived มี viralScore สูงสุดเพื่อพิสูจน์ mix
const SAMPLE = [
  { id: 'a1', promptText: 'A', toneClass: 'negative', category: 'ช่วยเหลือกัน', viralScore: 70 },
  { id: 'x1', promptText: 'C', status: 'archived', category: 'ช่วยเหลือกัน', viralScore: 99 },
  { id: 'p1', promptText: 'D', status: 'proposed', category: 'คดีความ', viralScore: 95 },
  { id: 'a2', promptText: 'B', status: 'active', category: 'ช่วยเหลือกัน', viralScore: 80 },
  { id: 'e1', promptText: '', status: 'active', category: 'ช่วยเหลือกัน', viralScore: 90 },
  { id: 'e2', status: 'archived', category: 'ช่วยเหลือกัน', viralScore: 91 },
  { id: 'a3', promptText: 'E', status: 'active', toneClass: 'negative', category: 'ดราม่าสังคม', viralScore: 60 },
  { id: 'a4', promptText: 'F', status: '', category: 'ดราม่าสังคม', viralScore: 65 },
  { id: 'x2', promptText: 'G', status: 'archived', toneClass: 'positive', category: 'ดราม่าสังคม', viralScore: 98 },
];
const clone = () => SAMPLE.map(c => ({ ...c }));
const ids = (list) => list.map(c => c.id);
const BY_SCORE_DESC = ['x1', 'x2', 'p1', 'e2', 'e1', 'a2', 'a1', 'a4', 'a3']; // ลำดับหลัง sort viralScore desc ทั้งชุด (stable sort — ไม่มีคะแนนซ้ำ)

function extract(src, re, label) {
  const m = src.match(re);
  assert.ok(m, `หา predicate ไม่เจอ: ${label}`);
  return m[1];
}
const mkFn = (body, ...params) => new Function(...params, `return (${body});`);

// ตัวกรองเดิมก่อน F7 (ไบต์ที่เคยอยู่ในไฟล์) — ตัวเทียบสำหรับกรณีปิดสวิตช์
const LEGACY = {
  analyze: (p) => p.promptText,
  top: (excludePromptIds) => (p) => p.promptText && !excludePromptIds.includes(p.id),
  tone: (p) => p.promptText && p.toneClass !== 'negative',
};

// ดึง predicate จริง 3 แบบจากไฟล์ + บรรทัด mix จริง (เรียกในเทส — ถ้าหาไม่เจอ = แดงที่เทสนั้นพร้อมข้อความ ไม่ล้มทั้งไฟล์)
function realPredicates(relative) {
  const src = readSrc(relative);
  const analyzePred = mkFn(extract(src, /\.filter\((p => p\.promptText && isCardSelectable\(p\))\); \/\/ ★ F7/, 'analyze'), 'isCardSelectable')(isCardSelectable);
  const topPredSrc = extract(src, /_cachedPromptLib\.filter\((p => p\.promptText && isCardSelectable\(p\) && !excludePromptIds\.includes\(p\.id\))\)/, 'getTopPrompts');
  const topPred = (excludePromptIds) => mkFn(topPredSrc, 'isCardSelectable', 'excludePromptIds')(isCardSelectable, excludePromptIds);
  const tonePred = mkFn(extract(src, /_allPrompts\.find\((p => p\.promptText && isCardSelectable\(p\) && p\.toneClass !== 'negative')\)/, 'tone'), 'isCardSelectable')(isCardSelectable);
  // mix: บรรทัดจริง `promptLib = selectableCards(promptLib);` → รันเป็นฟังก์ชัน (promptLib) => ผลลัพธ์ ด้วย selectableCards จริง
  const mixLine = extract(src, /promptLib = (selectableCards\(promptLib\));/, 'mix');
  const mixApply = (promptLib) => mkFn(mixLine, 'selectableCards', 'promptLib')(selectableCards, promptLib);
  return { analyzePred, topPred, tonePred, mixApply };
}
// จำลองบล็อก mix ตามโค้ดจริง: matched ตามหมวด → sort viralScore → matched[0] || promptLib.sort()[0] (sort ทับอาเรย์ที่รับมา — เหมือน HEAD)
const mixBest = (lib, detectedCategory) => {
  const matched = lib.filter(p => p.category && detectedCategory.includes(p.category)).sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));
  return matched[0] || lib.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0))[0];
};

for (const relative of FILES) {
  test(`(ค) ${relative}: CARD_LIBRARY_V2=0 → ผลกรองทุกทางเข้าเท่าตัวกรองเดิมทุกไบต์ · mix คืน reference เดิม + sort ทับต้นทางเหมือน HEAD`, () => {
    const { analyzePred, topPred, tonePred, mixApply } = realPredicates(relative);
    try {
      setSwitch('0');
      assert.equal(JSON.stringify(clone().filter(analyzePred)), JSON.stringify(clone().filter(LEGACY.analyze)), 'analyze');
      for (const ex of [[], ['a2'], ['x1', 'a1']]) {
        assert.equal(JSON.stringify(clone().filter(topPred(ex))), JSON.stringify(clone().filter(LEGACY.top(ex))), `getTopPrompts exclude=${ex}`);
      }
      assert.equal(JSON.stringify(clone().find(tonePred) || null), JSON.stringify(clone().find(LEGACY.tone) || null), 'tone fallback');
      assert.equal(clone().find(tonePred)?.id, 'x1', 'ปิดสวิตช์: tone fallback ยังหยิบใบพักได้เหมือนเดิม');
      // mix: อาเรย์ "จาก getAll" ต้องเป็นตัวเดียวกับที่ sort() ทับ (HEAD: promptLib.sort(...)[0] ทับ reference ของ memCache)
      const fromStore = clone();
      const mixed = mixApply(fromStore);
      assert.equal(mixed, fromStore, 'mix ปิดสวิตช์: selectableCards ต้องคืนอาเรย์ตัวเดิม ไม่ใช่สำเนา');
      assert.equal(JSON.stringify(mixed), JSON.stringify(clone()), 'mix: ทุกใบผ่านเหมือนไม่มีตัวกรอง (ลำดับเดิม)');
      assert.equal(mixBest(mixed, 'ช่วยเหลือกัน')?.id, mixBest(clone(), 'ช่วยเหลือกัน')?.id, 'mix best (มีหมวด)');
      assert.deepEqual(ids(fromStore), ids(SAMPLE), 'มีหมวด: matched เป็นสำเนา → ต้นทางลำดับเดิม (เหมือน HEAD)');
      assert.equal(mixBest(mixed, 'ไม่มีหมวดนี้')?.id, mixBest(clone(), 'ไม่มีหมวดนี้')?.id, 'mix best (fallback sort)');
      assert.deepEqual(ids(fromStore), BY_SCORE_DESC, 'fallback sort ทับอาเรย์จาก getAll (= memCache) ให้เป็น viralScore-desc เหมือน HEAD');
      assert.equal(mixBest(clone(), 'ช่วยเหลือกัน')?.id, 'x1');
    } finally { restoreEnv(); }
  });

  test(`(ค) ${relative}: สวิตช์เปิด → archived/proposed หายทุกทางเข้า · ใบไม่มี status/'' ยังอยู่ · mix sort ทับสำเนา ต้นทางไม่ขยับ`, () => {
    const { analyzePred, topPred, tonePred, mixApply } = realPredicates(relative);
    try {
      setSwitch(undefined);
      assert.deepEqual(ids(clone().filter(analyzePred)), ['a1', 'a2', 'a3', 'a4'], 'analyze');
      assert.deepEqual(ids(clone().filter(topPred([]))), ['a1', 'a2', 'a3', 'a4'], 'getTopPrompts');
      assert.deepEqual(ids(clone().filter(topPred(['a2']))), ['a1', 'a3', 'a4'], 'getTopPrompts + exclude');
      assert.equal(clone().find(tonePred)?.id, 'a2', 'tone fallback ข้าม x1 (archived) ไป a2');
      const fromStore = clone();
      const mixed = mixApply(fromStore);
      assert.notEqual(mixed, fromStore, 'mix เปิดสวิตช์: อาเรย์ใหม่');
      assert.deepEqual(ids(mixed), ['a1', 'a2', 'e1', 'a3', 'a4'], 'mix: กรองสถานะอย่างเดียว (promptText เช็คทีหลังในโค้ดจริง)');
      assert.equal(mixBest(mixed, 'ช่วยเหลือกัน')?.id, 'e1', 'mix best ตามหมวด: x1(99)/e2(91) หาย → e1(90)');
      assert.equal(mixBest(mixApply(clone()), 'ไม่มีหมวดนี้')?.id, 'e1', 'mix fallback sort: x1(99)/x2(98)/p1(95)/e2(91) หาย → e1(90)');
      mixBest(mixed, 'ไม่มีหมวดนี้');
      assert.deepEqual(ids(fromStore), ids(SAMPLE), 'เปิดสวิตช์: sort ทับสำเนา อาเรย์จาก getAll ลำดับเดิม (ไม่ leak ลง memCache — ทางใหม่ จงใจ)');
      setSwitch('1');
      assert.deepEqual(ids(clone().filter(analyzePred)), ['a1', 'a2', 'a3', 'a4'], 'env=1 เท่ากับไม่ตั้ง');
    } finally { restoreEnv(); }
  });
}

test('(ค) ทุกใบไม่มี status (ยังไม่ migrate) → เปิดสวิตช์ = no-op ทุกไบต์ (ตามแบบ §3: no-op จน data มี flag)', () => {
  const legacyLib = SAMPLE.map(({ status, ...rest }) => ({ ...rest }));
  try {
    setSwitch(undefined);
    const on = JSON.stringify(legacyLib.filter(p => p.promptText && isCardSelectable(p)));
    assert.equal(JSON.stringify(selectableCards(legacyLib)), JSON.stringify(legacyLib), 'selectableCards เปิด: ไม่มี flag = ทุกใบอยู่ (ลำดับเดิม)');
    setSwitch('0');
    const off = JSON.stringify(legacyLib.filter(p => p.promptText && isCardSelectable(p)));
    assert.equal(on, off);
    assert.equal(on, JSON.stringify(legacyLib.filter(LEGACY.analyze)));
  } finally { restoreEnv(); }
});

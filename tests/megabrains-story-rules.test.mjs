// ============================================================
// megabrains-story-rules.test.mjs — TIER3 ก: กติกาเล่าเรื่องตามสูตรเพจ (memory igdara-cover-formula)
//   src/lib/megaBrains.js: artBriefBrain (S6a) + slotDirectorBrain (S6, ทั้ง legacy system + systemSem)
//   (1) parity: storyRulesOn=false → prompt byte-identical กับก่อน TIER3 (golden string ที่ capture จาก
//       megaBrains.js.bak-tier3 ไว้ก่อนแก้ — ฝังเป็น literal กันเทสพังถ้า .bak ถูกกวาดทิ้งภายหลัง)
//   (2) default ON: ไม่ส่ง storyRulesOn เลย = เหมือน storyRulesOn=true (ต้องเห็นกติกาใหม่)
//   (3) เนื้อหากติกาใหม่ต้องมีครบ 4 ข้อ (hero=อารมณ์พีค / ไทม์ไลน์ช่องรอง / circle=บุคคลที่สอง / เลี่ยงฉากรายการ)
//   (4) งบ prompt: กติกาใหม่ไม่กระทบ IMG_META_BUDGET (default 45000 — ขึ้นกับ env MEGA_IMG_META_BUDGET, ข้อ 6
//       27 ก.ค. 69 ยกจาก 18000 เดิม) การตัดท้ายรายใบ + delta ความยาวต้องไม่บวมเกินเหตุ
//   ไม่ยิง LLM จริง (stub callBrain แค่ "จับ args" แล้วตอบ JSON ว่างพอ parseJson ผ่าน) · deterministic ล้วน
// ============================================================
import assert from 'node:assert/strict';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
// stub callBrain: เก็บ args ล่าสุดไว้ที่ globalThis.__CAPTURED แล้วตอบ JSON ขั้นต่ำที่ parseJson ของทั้งสองฟังก์ชันแกะผ่าน
const AI_STUB = _mod('export function callBrain(a){ globalThis.__CAPTURED = a; return { text: JSON.stringify({ orders: [], storyNote: "x", slots: {} }) }; }');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js'), ${JSON.stringify(SRC_ROOT)}).href;
    return nextResolve(mapped, context);
  }
  return nextResolve(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { artBriefBrain, slotDirectorBrain } = await import('../src/lib/megaBrains.js');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${passed} - ${name}`); };

// ── golden "ก่อน TIER3" — capture ครั้งเดียวจาก megaBrains.js.bak-tier3 (27 ก.ค. 69, ก่อนเพิ่มกติกาเล่าเรื่อง)
//   ด้วย fixture เดียวกับที่ใช้เรียกจริงด้านล่าง — ฝัง literal กันเทสพังถ้าไฟล์ .bak ถูกกวาดทิ้งภายหลัง
const GOLDEN_ARTBRIEF_SYSTEM_OFF = "คุณคือบรรณาธิการศิลป์ (Art Director) ของเพจข่าวไวรัลไทย งานเดียว: เขียน \"ใบสั่งงาน\" ให้มือคัดภาพ\nโจทย์: ปกต้นแบบ (ref) จัดช่องไว้แบบหนึ่ง — คุณต้องสั่งว่า \"ข่าวนี้\" แต่ละช่องควรใส่ภาพแบบไหน (ใคร/ช็อตอะไร/อารมณ์ไหน) ให้เล่าเรื่องแบบเดียวกับ ref แต่เป็นคนและเหตุการณ์ของข่าวนี้\nกฎเหล็ก: (1) hero = หน้าเดี่ยวตัวเอกของข่าวเสมอ ห้ามภาพหมู่ (2) สั่งเฉพาะภาพที่ข่าวนี้มีโอกาสมีจริง (3) ช่องไหน ref ใส่โมเมนต์/หลักฐาน ให้แปลงเป็นโมเมนต์/หลักฐานของข่าวนี้\nตอบ JSON เท่านั้น: {\"orders\":[{\"i\":<ดัชนีช่องตาม ref>,\"want\":\"สั่ง 1 ประโยค: ใคร+ช็อต+อารมณ์\",\"personHint\":\"ชื่อคนที่ควรอยู่ช่องนี้ หรือ null\"}],\"storyNote\":\"ปกนี้เล่าเรื่องยังไง 1 ประโยค\"}";
const GOLDEN_SLOTDIR_SYSTEM_LEGACY_OFF = "คุณคือผู้กำกับภาพปกข่าวไวรัลไทย จับคู่ \"ภาพ → ช่องปก\" ตามสูตรปกแสนไลค์ (5 ช่อง 5 บทบาท):\n- hero: ตัวเอกของข่าว อารมณ์ตรงเรื่อง หน้าชัด (สำคัญสุด) — เลือกภาพแนวตั้ง/จัตุรัส (orient=tall/sq) หน้าใหญ่คมชัด · ⛔ภาพแนวนอนกว้าง (orient=wide เช่นแบนเนอร์เว็บข่าว) ห้ามเป็น hero ถ้ามีตัวเลือกอื่นของตัวเอก (ช่อง hero สูง — แบนเนอร์ถูกยืดจนเบลอ)\n- reaction: บุคคลที่สอง/ปฏิกิริยาต่อเหตุการณ์ — เลือก \"ภาพเดี่ยว\" ของคนนั้นถ้ามี (ภาพคู่/กลุ่มครอปเหลือคนเดียวแล้วเศษตัวคนข้างค้างขอบ ไม่เนียน — เก็บภาพคู่ไว้ช่อง action/context ที่โชว์ทั้งภาพ)\n- action: เหตุการณ์กำลังเกิด/โมเมนต์เคลื่อนไหว\n- context: บริบท สถานที่ สิ่งของ ที่เล่าเรื่อง\n- circle: โมเมนต์-หลักฐานเด็ด (ภาพวงกลมที่คนต้องซูมดู)\nกฎเหล็ก: (1) ถูกคน 100% เหนือทุกข้อ — hero ต้องเป็น \"ตัวเอกอันดับหนึ่ง\" (mainCharacters role=hero) เท่านั้น ห้ามใช้ตัวละครรอง/คนอื่นในข่าวเป็น hero เด็ดขาด (2) ทุกช่องคนละภาพ ห้ามซ้ำ และควรคนละฉาก (3) เลือกจาก id ในรายการเท่านั้น (4) quality ต่ำ (<4) ใช้เมื่อจำเป็นจริงๆ (5) ช่องไหนไม่มีภาพเข้าเกณฑ์จริงๆ ให้ id=null พร้อมเหตุผล — ห้ามฝืนยัดภาพผิดคน (6) ภาพ clean=false (มีลายน้ำ/ตัวหนังสือทับ) ห้ามขึ้นช่อง เลือกภาพ clean=true ก่อนเสมอ — ยอมใช้ clean=false เฉพาะเมื่อไม่มีภาพสะอาดที่ถูกคน/เข้าเกณฑ์จริงๆ (hero ยังยึด \"ถูกคน 100%\" เหนือข้อนี้) (7) ภาพ newsScene=false = ภาพแฟ้มจากงาน/บริบทอื่น (เช่น ชุดกาล่า/พรมแดง ทั้งที่ข่าวคือเรื่องครอบครัว) — เลี่ยงเสมอ ใช้เฉพาะไม่มีภาพเหตุการณ์จริงให้เลือก\n(8) ★ปกทั้งใบต้องเล่าเรื่องครบ: 5 ช่องรวมกันต้องเห็น \"คน → กำลังทำอะไร → หลักฐาน/สถานที่\" — ห้ามเป็นพอร์ตเทรตล้วนทุกช่อง ใช้ note แยก \"โมเมนต์จริง\" (กำลังมอบ/ทำ/ยก/ไหว้) จาก \"ยืนโพสเฉยๆ\"\n(9) ★ฉากห้ามซ้ำข้ามช่อง: สองช่องห้ามมาจากฉาก/โมเมนต์เดียวกัน (เทียบจาก note — เฟรมจากคลิปเดียวกัน/เวทีเดียวกันหลายรูป = ฉากเดียวกัน)\n(10) ★circle ควรเป็น \"บุคคลที่สอง\" ของเรื่อง (person คนละคนกับ hero) ถ้าพูลมีให้เลือก — วงกลมซ้ำหน้าคนเดียวกับ hero = ปกดูจน\n(11) ★ภาพที่คนหันหลัง/ก้มกราบ/เห็นแต่แผ่นหลัง (สังเกตจาก note เช่น \"กราบ/หันหลัง/มองจากด้านหลัง\") ใช้ได้เฉพาะช่องฉากกว้าง (context) เท่านั้น — ห้ามลงช่องเล็ก/ช่องคน เพราะครอปแล้วหัวขาดง่ายและไม่เห็นว่าเป็นใคร\nตอบ JSON เท่านั้น:\n{\"slots\":{\"hero\":{\"id\":\"...\",\"reason\":\"สั้นๆ\",\"backups\":[\"id\",\"id\"]},\"reaction\":{...},\"action\":{...},\"context\":{...},\"circle\":{...}},\"note\":\"ข้อสังเกตรวม 1 ประโยค\"}";
const GOLDEN_SLOTDIR_SYSTEM_SEM_OFF = "คุณคือผู้กำกับภาพปกข่าวไวรัลไทย จับคู่ \"ภาพ → ช่องปก\" ตามช่องจริงของปกเป้า (ref) ใบนี้ทีละช่อง:\n- main (ช่องตัวเอกหลัก): บท hero\n- sub_a: บท context\n- sub_b: บท context\n- circle_a (วงกลม): บท circle\nกฎเหล็ก: (1) ถูกคน 100% เหนือทุกข้อ — main ต้องเป็น \"ตัวเอกอันดับหนึ่ง\" ของข่าวเท่านั้น และช่องที่ระบุ \"คน:\" ต้องได้ภาพของคนนั้นจริงตามป้าย person ห้ามคนอื่นเด็ดขาด (2) ทุกช่องคนละภาพ ห้ามซ้ำ และควรคนละฉาก (3) เลือกจาก id ในรายการเท่านั้น (4) quality ต่ำ (<4) ใช้เมื่อจำเป็นจริงๆ (5) ช่องไหนไม่มีภาพเข้าเกณฑ์จริงๆ ให้ id=null พร้อมเหตุผล — ห้ามฝืนยัดภาพผิดคน (6) ภาพ clean=false (มีลายน้ำ/ตัวหนังสือทับ) ห้ามขึ้นช่องถ้ามีตัวเลือกสะอาด (7) ภาพ newsScene=false = ภาพแฟ้มจากงาน/บริบทอื่น — เลี่ยงเสมอ ใช้เฉพาะไม่มีภาพเหตุการณ์จริง\n(8) ★ปกทั้งใบต้องเล่าเรื่องครบ: ทุกช่องรวมกันต้องเห็น \"คน → กำลังทำอะไร → หลักฐาน/สถานที่\" — ห้ามเป็นพอร์ตเทรตล้วนทุกช่อง (9) ★ฉากห้ามซ้ำข้ามช่อง (เทียบจาก note — เฟรมคลิปเดียวกัน/เวทีเดิม = ฉากเดียวกัน) (10) ★main เลือกภาพ \"หน้าเดี่ยว\" (faces=1) หน้าใหญ่คมชัด แนวตั้ง/จัตุรัส (orient=tall/sq) ก่อนเสมอ — ห้ามภาพแนวนอนกว้าง/แบนเนอร์ถ้ามีตัวเลือกอื่นของตัวเอก (11) ★ช่องวงกลม (circle_a) ควรเป็นคนละคนกับ main เมื่อช่องนั้นไม่ได้ระบุ \"คน:\" ไว้ (12) ★ภาพคนหันหลัง/ก้มกราบ/เห็นแต่แผ่นหลัง ใช้ได้เฉพาะช่องฉากกว้างเท่านั้น\nตอบ JSON เท่านั้น:\n{\"slots\":{\"main\":{\"id\":\"...\",\"reason\":\"สั้นๆ\",\"backups\":[\"id\",\"id\"]},\"sub_a\":{\"id\":\"...\",\"reason\":\"สั้นๆ\",\"backups\":[\"id\",\"id\"]},\"sub_b\":{\"id\":\"...\",\"reason\":\"สั้นๆ\",\"backups\":[\"id\",\"id\"]},\"circle_a\":{\"id\":\"...\",\"reason\":\"สั้นๆ\",\"backups\":[\"id\",\"id\"]}},\"note\":\"ข้อสังเกตรวม 1 ประโยค\"}";

// ── fixtures คงที่ (system prompt ทั้งสองฟังก์ชันไม่พึ่ง compass/refDNA content เลย — เห็นได้จาก golden ด้านบน
//   ที่ไม่มีคำจาก compass/deskTitle ปนมา — เปลี่ยนได้อิสระโดยไม่กระทบผล assertion) ──
const FIXED_COMPASS = { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: ['sad'], mainCharacters: [{ name: 'ทดสอบ', role: 'hero' }], visualDreamShots: [] };
const REF_DNA = { slots: [{ role: 'hero', pos: 'ซ้าย', shot: 'closeup', emotion: 'warm', faceSizePct: 60 }, { role: 'context', pos: 'ขวา' }] };
const META_NO_FLAGS = [{ id: 'A', category: 'context', quality: 7, note: 'test' }];
const SLOT_CONTRACT = [
  { id: 'main', refRole: 'hero', shape: 'rect' },
  { id: 'sub_a', refRole: 'context', shape: 'rect' },
  { id: 'sub_b', refRole: 'context', shape: 'rect' },
  { id: 'circle_a', refRole: 'circle', shape: 'circle' },
];

const captureSystem = async (fn) => { await fn(); return globalThis.__CAPTURED.system; };
const captureUser = async (fn) => { await fn(); return globalThis.__CAPTURED.user; };
const countIds = (userStr) => (userStr.match(/"id":"IMG\d{4}"/g) || []).length;

// ═══════════════════════ (1) parity: storyRulesOn=false → byte-identical กับก่อน TIER3 ═══════════════════════

// ★ ตรวจซ้ำ (28 ก.ค. 69 — คัมภีร์เพจฉบับเต็ม): golden ทั้ง 3 ก้อนถูก capture ก่อนคัมภีร์เพจมีอยู่ด้วย ⇒ ต้องปิด
//   pagePlaybookOn ด้วย (ไม่ใช่แค่ storyRulesOn) ไม่งั้น default ON ใหม่จะแทรกคัมภีร์เข้ามาทำให้ golden ไม่ตรง
await test('parity: artBriefBrain storyRulesOn=false → system เหมือน golden ก่อน TIER3 เป๊ะ', async () => {
  const sys = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, storyRulesOn: false, pagePlaybookOn: false }));
  assert.equal(sys, GOLDEN_ARTBRIEF_SYSTEM_OFF);
});

await test('parity: slotDirectorBrain (legacy system) storyRulesOn=false → เหมือน golden ก่อน TIER3 เป๊ะ', async () => {
  const sys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: false, pagePlaybookOn: false }));
  assert.equal(sys, GOLDEN_SLOTDIR_SYSTEM_LEGACY_OFF);
});

await test('parity: slotDirectorBrain (systemSem — SEM-1) storyRulesOn=false → เหมือน golden ก่อน TIER3 เป๊ะ', async () => {
  const sys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT, storyRulesOn: false, pagePlaybookOn: false }));
  assert.equal(sys, GOLDEN_SLOTDIR_SYSTEM_SEM_OFF);
});

// ═══════════════════════ (2) default ON: ไม่ส่งพารามิเตอร์เลย = เหมือน storyRulesOn:true ═══════════════════════

await test('default ON: artBriefBrain ไม่ส่ง storyRulesOn เลย → เหมือน storyRulesOn:true เป๊ะ (ไม่ใช่ :false)', async () => {
  const sysDefault = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false }));
  const sysExplicitOn = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, storyRulesOn: true }));
  assert.equal(sysDefault, sysExplicitOn);
  assert.notEqual(sysDefault, GOLDEN_ARTBRIEF_SYSTEM_OFF, 'default ต้อง "ไม่" เหมือน OFF (แปลว่า default จริงๆ คือ ON)');
});

await test('default ON: slotDirectorBrain ไม่ส่ง storyRulesOn เลย → เหมือน storyRulesOn:true เป๊ะ (ทั้ง legacy + sem)', async () => {
  const legacyDefault = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '' }));
  const legacyOn = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true }));
  assert.equal(legacyDefault, legacyOn);
  assert.notEqual(legacyDefault, GOLDEN_SLOTDIR_SYSTEM_LEGACY_OFF);
});

// ═══════════════════════ (3) เนื้อหากติกาใหม่ครบ 4 ข้อ (storyRulesOn:true) ═══════════════════════

await test('เนื้อหากติกาใหม่: artBriefBrain มีครบ 4 หัวข้อ (อารมณ์พีค/ไทม์ไลน์/บุคคลที่สอง/เลี่ยงฉากรายการ)', async () => {
  const sys = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, storyRulesOn: true }));
  assert.ok(/สูตรเล่าเรื่องตามเพจ/.test(sys), 'ต้องมีชื่อสูตร');
  assert.ok(/อารมณ์หลัก/.test(sys) && /hero/.test(sys), 'ต้องพูดถึง hero=อารมณ์หลัก');
  assert.ok(/ไทม์ไลน์/.test(sys) && /โมเมนต์หัวใจ/.test(sys), 'ต้องพูดถึงไทม์ไลน์เล่าเรื่อง');
  assert.ok(/บุคคลที่สอง/.test(sys), 'ต้องพูดถึง circle=บุคคลที่สอง');
  assert.ok(/ฉากรายการทีวี|สตูดิโอ|ไฟเวที/.test(sys), 'ต้องพูดถึงเลี่ยงฉากรายการ/สตูดิโอ');
});

await test('เนื้อหากติกาใหม่: slotDirectorBrain (legacy) มีครบ 4 หัวข้อ', async () => {
  const sys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true }));
  assert.ok(/สูตรเล่าเรื่องตามเพจ/.test(sys));
  assert.ok(/อารมณ์หลัก/.test(sys));
  assert.ok(/ไทม์ไลน์/.test(sys) && /โมเมนต์หัวใจ/.test(sys));
  assert.ok(/บุคคลที่สอง/.test(sys));
  assert.ok(/ฉากรายการทีวี|สตูดิโอ|ไฟเวที/.test(sys));
});

await test('เนื้อหากติกาใหม่: slotDirectorBrain (systemSem) มีครบ 4 หัวข้อ + อ้างอิงชื่อช่อง instance จริง', async () => {
  const sys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT, storyRulesOn: true }));
  assert.ok(/สูตรเล่าเรื่องตามเพจ/.test(sys));
  assert.ok(sys.includes('main เลือกใบหน้าที่มีอารมณ์ตรง'), 'ต้องอ้างอิง instance id จริง (main) ไม่ใช่คำว่า hero ลอยๆ');
  assert.ok(sys.includes('circle_a'), 'ต้องอ้างอิง instance id วงกลมจริง (circle_a)');
  assert.ok(/บุคคลที่สอง/.test(sys));
  assert.ok(/ฉากรายการทีวี|สตูดิโอ|ไฟเวที/.test(sys));
});

// ═══════ 28 ก.ค. 69 — เคส AC-0201 (ผลเทสจริง): ขยายกติกากันช็อตซ้ำจาก "ช่องบน" เป็น "ทุกช่อง" + เพิ่มกติกา
// ห้ามเลือกภาพหน้าถูกบัง (หมวก/หน้ากาก/มือ) เป็น hero เมื่อพูลมีภาพหน้าเต็มของตัวเอกจริง ═══════

await test('เคส AC-0201: กติกากันช็อตซ้ำต้องครอบ "ทุกช่อง" (ไม่ใช่แค่ช่องบนสุดแบบเดิม) ทั้ง legacy + systemSem', async () => {
  const legacySys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true }));
  assert.ok(/ทุกช่อง.*ห้ามช็อตซ้ำ/.test(legacySys), 'legacy: ต้องเป็น "ทุกช่อง" ห้ามช็อตซ้ำ ไม่ใช่จำกัดแค่ reaction/ช่องบนสุดแบบเดิม');
  assert.ok(!/reaction \(ช่องบนสุด\)/.test(legacySys), 'ถ้อยคำเดิมที่จำกัดแค่ reaction (ช่องบนสุด) ต้องถูกแทนที่แล้ว ไม่ใช่แค่เพิ่มเติม');

  const semSys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT, storyRulesOn: true }));
  assert.ok(/ทุกช่อง.*ห้ามช็อตซ้ำ/.test(semSys), 'systemSem: ต้องเป็น "ทุกช่อง" ห้ามช็อตซ้ำเช่นกัน');
  assert.ok(!/ช่องย่อยอื่น \(ไม่ใช่/.test(semSys), 'ถ้อยคำเดิมที่จำกัดแค่ "ช่องย่อยอื่น (ไม่ใช่ hero/circle)" ต้องถูกแทนที่แล้ว');
});

await test('เคส AC-0201: กติกาใหม่ "ห้ามเลือกภาพหน้าถูกหมวก/หน้ากาก/มือบังเป็น hero เมื่อพูลมีภาพหน้าเต็ม" ต้องมีทั้ง legacy + systemSem (อ้างอิง instance id จริง)', async () => {
  const legacySys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true }));
  assert.ok(/หน้าเต็ม.*ห้ามเลือกภาพหน้าถูกหมวก\/หน้ากาก\/มือบังเป็น hero/.test(legacySys), 'legacy: ต้องมีกติกาห้ามเลือก hero หน้าถูกบังเมื่อมีตัวเลือกหน้าเต็ม');

  const semSys = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT, storyRulesOn: true }));
  assert.ok(semSys.includes('ห้ามเลือกภาพหน้าถูกหมวก/หน้ากาก/มือบังเป็น main เด็ดขาด'), 'systemSem: ต้องอ้างอิง instance id จริง (main) ไม่ใช่คำว่า hero ลอยๆ');
});

// ═══════════════════════ (4) งบ prompt: ไม่กระทบ IMG_META_BUDGET (default 45000) + delta ไม่บวมเกินเหตุ ═══════════════════════

await test('งบ prompt: กติกาใหม่ไม่กระทบจำนวนใบภาพที่ถูกตัดท้ายคิว (IMG_META_BUDGET default 45000 คงเดิม)', async () => {
  // สร้าง imagesMeta ~300 ใบ ให้รวมกันเกิน 45000 ตัวอักษรแน่นอน (บังคับให้เกิดการตัดท้ายจริงแม้งบใหม่ใหญ่กว่าเดิม 18000)
  const bigMeta = Array.from({ length: 300 }, (_, i) => ({
    id: `IMG${String(i).padStart(4, '0')}`, category: 'context', quality: 7,
    note: 'คำบรรยายฉากยาวพอสมควรสำหรับทดสอบงบ prompt ตัดท้ายคิวใบภาพที่คะแนนต่ำสุด'.repeat(2),
    person: null, emotion: 'warm', clean: true, newsScene: true,
  }));

  const userOff = await captureUser(() => slotDirectorBrain({ imagesMeta: bigMeta, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: false }));
  const userOn = await captureUser(() => slotDirectorBrain({ imagesMeta: bigMeta, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true }));

  const nOff = countIds(userOff);
  const nOn = countIds(userOn);
  assert.ok(nOff > 0 && nOff < bigMeta.length, `ต้องเกิดการตัดท้ายจริง (ได้ ${nOff}/${bigMeta.length}) — ไม่งั้น fixture ยังไม่เกินงบจริง`);
  assert.equal(nOn, nOff, `จำนวนใบที่รวมเข้า user ต้องเท่ากันทั้งสองโหมด (ได้ OFF=${nOff} ON=${nOn}) — กติกาใหม่อยู่ที่ system ไม่ใช่ user ห้ามแย่งงบภาพ`);
});

// ★ ข้อ 6 (27 ก.ค. 69 — เจ้าของจับได้จากล็อกจริง: สมองเห็นแค่ 39-58/77-80 ใบ): จำลองพูลจริง 90 ใบพร้อมป้ายครบทุกชนิด
//   (faceH/busy/faceFront/heroDimsAvoid/note ยาวสุดตามเพดานจริงของ megaAdapters.js) → ต้องเข้าครบ 90/90 ภายในงบ
//   default ใหม่ (45000) แม้รวมกันเกินงบเดิม (18000) แน่นอน — พิสูจน์ตัวเลขจริง ไม่ใช่แค่ "ไม่พัง"
await test('ข้อ 6: พูลจริง 90 ใบป้ายครบ (faceH/busy/faceFront/heroDimsAvoid/note 64 ตัวอักษร) → เข้าครบ 90/90 ภายในงบ default 45000 (แม้รวมกันเกินงบเดิม 18000 แน่นอน)', async () => {
  const fullMeta = Array.from({ length: 90 }, (_, i) => ({
    id: `IMG${String(i).padStart(4, '0')}`,
    category: i % 2 === 0 ? 'face-emotional' : 'context',
    quality: 7,
    note: `เฟรมคลิปสัมภาษณ์ที่งานแถลงข่าว มีคนยืนพูดคุยกันอยู่หน้ากล้อง ${i}`.slice(0, 64),
    orient: i % 3 === 0 ? 'tall' : (i % 3 === 1 ? 'wide' : 'sq'),
    person: i % 4 === 0 ? 'ทดสอบ' : null,
    emotion: 'warm',
    clean: true,
    newsScene: true,
    faceH: 0.42,
    busy: 1,
    faceFront: 2,
    ...(i % 5 === 0 ? { heroDimsAvoid: 'เลี่ยง hero: วัดขนาดไม่ได้' } : {}),
  }));
  const totalLen = fullMeta.reduce((s, m) => s + JSON.stringify(m).length + 2, 0);
  assert.ok(totalLen > 18000, `fixture ต้องเกินงบเดิม 18000 แน่นอน (ได้ ${totalLen}) — ไม่งั้นพิสูจน์อะไรไม่ได้`);
  assert.ok(totalLen <= 45000, `fixture ต้องยังอยู่ในงบใหม่ 45000 (ได้ ${totalLen}) — สมมติฐานพูล ~80-100 ใบจริง`);

  const userStr = await captureUser(() => slotDirectorBrain({ imagesMeta: fullMeta, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true }));
  const n = countIds(userStr);
  assert.equal(n, 90, `ต้องเข้าครบ 90/90 ภายในงบ default ใหม่ (ได้ ${n}/90) — รวมข้อความจริง ${totalLen} ตัวอักษร`);
});

await test('ข้อ 6: parametrized imgMetaBudget — ส่ง budget เล็กเจาะจง (2000) กับพูลเดียวกัน → ตัดท้ายจริง (พิสูจน์พารามิเตอร์มีผลจริง ไม่ใช่แค่ default)', async () => {
  const smallMeta = Array.from({ length: 30 }, (_, i) => ({ id: `IMG${String(i).padStart(4, '0')}`, category: 'context', quality: 7, note: 'x'.repeat(50) }));
  const userStr = await captureUser(() => slotDirectorBrain({ imagesMeta: smallMeta, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true, imgMetaBudget: 2000 }));
  const n = countIds(userStr);
  assert.ok(n > 0 && n < 30, `imgMetaBudget=2000 ต้องบังคับตัดท้ายจริง (ได้ ${n}/30)`);
});

await test('งบ prompt: ความยาว system ที่เพิ่มขึ้น (ON เทียบ OFF) อยู่ในเกณฑ์สมเหตุสมผล (<1000 ตัวอักษร/จุด)', async () => {
  const artOff = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, storyRulesOn: false }));
  const artOn = await captureSystem(() => artBriefBrain({ refDNA: REF_DNA, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', typeMatched: false, storyRulesOn: true }));
  const legacyOff = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: false }));
  const legacyOn = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', storyRulesOn: true }));
  const semOff = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT, storyRulesOn: false }));
  const semOn = await captureSystem(() => slotDirectorBrain({ imagesMeta: META_NO_FLAGS, compass: FIXED_COMPASS, deskTitle: 'ข่าวทดสอบ', refDNA: null, artBrief: null, sceneInventory: '', slotContract: SLOT_CONTRACT, storyRulesOn: true }));
  for (const [label, off, on] of [['artBrief', artOff, artOn], ['slotDir-legacy', legacyOff, legacyOn], ['slotDir-sem', semOff, semOn]]) {
    const delta = on.length - off.length;
    assert.ok(delta > 0 && delta < 1000, `${label}: delta=${delta} ควรอยู่ในช่วง (0,1000)`);
  }
});

console.log(`\n1..${passed}`);

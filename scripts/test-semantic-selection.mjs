// ============================================================
// 🧬 SEM-1 harness — semantic-selection adapter-level tests (ไม่ยิง LLM/network จริง)
// ------------------------------------------------------------
// - alias loader แบบ data:URL (ไม่มีไฟล์ loader แยก — คุมเพดาน 3 ไฟล์/batch)
// - '@/lib/aiClient' ถูก stub ให้ throw เสมอ = การันตีว่าไม่มีการยิง LLM จากทุกเส้นทาง
// - brain/fetch ฉีดผ่าน _deps (design v2 ช่องโหว่ 4) · dossier fixture จาก ref จริงในคลัง
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

const SRC_ROOT = new URL('../src/', import.meta.url).href;
const AI_STUB = 'data:text/javascript,export function callBrain(){throw new Error("LLM_FORBIDDEN_IN_TEST")}';
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

// env ที่ module-level const อ่านตอน import — ตั้งก่อน import เท่านั้น (shadow ปิดให้ dossier นิ่ง/ไม่มี solver noise)
process.env.MEGA_SOLVER_SHADOW = '0';
delete process.env.MEGA_SEMANTIC_SELECTION;
delete process.env.MEGA_SELECTION_SPEC;

const { s6_slots, s7_cover } = await import('../src/lib/megaAdapters.js');
const { slotDirectorBrain } = await import('../src/lib/megaBrains.js');
const { buildRefSlotContract } = await import('../src/lib/refSlotContract.js');

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const loadRefDna = (id) => {
  const refs = JSON.parse(fs.readFileSync(new URL('../data/ref-cover-library.json', import.meta.url), 'utf8'));
  const rec = refs.find((r) => r.id === id);
  assert.ok(rec?.dna, `ref ${id} must exist in library`);
  return rec.dna;
};

// ---------- fixtures ----------
const IMG = (id, t = {}, top = {}) => ({
  id,
  imageUrl: `https://cdn.test/${id}.jpg`,
  thumbnailUrl: '',
  width: 800,
  height: 1000,
  realWidth: 900,
  realHeight: 1200,
  ...top,
  triage: {
    relevant: true, clean: true, faceCount: 1, person: null, persons: [],
    category: 'context', emotion: 'warm', note: '', newsScene: true, quality: 7,
    ...t,
  },
});

const mkJob = ({ dna, orders = [], chars, storyTitle = 'ข่าวทดสอบ SEM-1', refId }) => ({
  dossier: {
    images: { caseId: 'SEM-TEST' },
    compass: { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: chars, visualDreamShots: [], doNotUse: [] },
    desk: { title: storyTitle },
    // refId ใส่เฉพาะ fixture semantic (SPEC=1) — OFF fixture ห้ามมี field ใหม่ (เหมือน legacy จริงที่ constructor gate ด้วยสวิตช์)
    refMatch: { dna, styleName: 'ref-test', typeMatched: true, imagePath: '/ref-covers/test.jpg', ...(refId ? { refId } : {}) },
    artBrief: { storyNote: 'เรื่องทดสอบ', orders },
  },
});

const mkDeps = ({ pool, brainAnswer, captures }) => ({
  slotDirectorBrain: async (args) => {
    captures.brainArgs.push(args);
    return { slots: brainAnswer, note: 'mock' };
  },
  fetchJson: async (url, opts) => {
    captures.fetches.push(url);
    if (String(url).includes('/api/images/')) return { success: true, images: pool };
    if (String(url).includes('/api/queue/add')) {
      captures.payload = JSON.parse(opts.body);
      return { success: true, jobId: 'JOB-SEM-TEST' };
    }
    throw new Error('unexpected fetch in test: ' + url);
  },
});

const withEnv = async (on, fn) => {
  if (on) { process.env.MEGA_SEMANTIC_SELECTION = '1'; process.env.MEGA_SELECTION_SPEC = '1'; }
  else { delete process.env.MEGA_SEMANTIC_SELECTION; delete process.env.MEGA_SELECTION_SPEC; }
  try { return await fn(); } finally { delete process.env.MEGA_SEMANTIC_SELECTION; delete process.env.MEGA_SELECTION_SPEC; }
};

// พูลมาตรฐาน: ดวงเดือน 4 ใบ (หน้าเดี่ยว) + สรพงศ์ 2 ใบ + บริบทไร้หน้า 2 ใบ — สะอาดหมด (ด่าน gate เงียบ)
const POOL_A = [
  IMG('P1', { person: 'ดวงเดือน', category: 'face-emotional', note: 'ดวงเดือนยืนหน้าวิหารกำลังไหว้พระอย่างสงบ' }),
  IMG('P2', { person: 'ดวงเดือน', category: 'context', note: 'ดวงเดือนกำลังก่อสร้างวิหารกับช่างหลายคนกลางแดด' }),
  IMG('P3', { person: 'ดวงเดือน', category: 'context', note: 'ดวงเดือนถือแบบแปลนคุยกับวิศวกรในเต็นท์งาน' }),
  IMG('P4', { person: 'ดวงเดือน', category: 'face-neutral', note: 'ดวงเดือนหน้าตรงยิ้มบางในชุดขาวริมระเบียง' }),
  IMG('P5', { person: 'สรพงศ์ ชาตรี', category: 'face-neutral', note: 'สรพงศ์ภาพเก่าหน้าตรงในชุดสูทสีเข้มสมัยหนุ่ม' }),
  IMG('P6', { person: 'สรพงศ์ ชาตรี', category: 'face-emotional', note: 'สรพงศ์ยิ้มกว้างถือพวงมาลัยหน้าโรงถ่ายภาพยนตร์' }),
  IMG('P7', { person: null, category: 'context', faceCount: 0, note: 'วิหารสีทองกลางแสงเย็นถ่ายมุมกว้างเห็นนั่งร้าน' }),
  IMG('P8', { person: null, category: 'document', faceCount: 0, note: 'แบบแปลนวิหารวางบนโต๊ะไม้มีตะเกียงเก่าข้างกัน' }),
];
const CHARS_A = [{ name: 'ดวงเดือน', role: 'hero' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }];

// REF-mrbqalpo-h1r1 (เคส AC-0066 จริง): บท hero/context/action/moment/reaction — reaction เป็น shape=circle
const DNA_ALPO = loadRefDna('REF-mrbqalpo-h1r1');
const ORDERS_ALPO = [
  { i: 0, role: 'hero', want: 'ตัวเอกโคลสอัพ', personHint: 'ดวงเดือน', shot: 'closeup' },
  { i: 4, role: 'reaction', want: 'คนที่เรื่องพาดถึง', personHint: 'สรพงศ์ ชาตรี', shot: 'closeup' },
];
const ANSWER_ALPO = {
  hero: { id: 'P1', reason: 'ตัวเอก', backups: ['P4'] },
  context: { id: 'P7', reason: 'วิหาร', backups: [] },
  action: { id: 'P2', reason: 'กำลังสร้าง', backups: [] },
  moment: { id: 'P8', reason: 'หลักฐานแปลน', backups: [] },
  reaction: { id: 'P5', reason: 'สรพงศ์ในวง', backups: ['P6'] },
};

await test('semantic ON: activeSlots = instance ids ตามลำดับ sourceIndex และ dossier keys เป็น instance เดิมหลังทุกด่าน', async () => {
  await withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    const out = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    assert.equal(out.status, 'done');
    const pi = out.dossierPatch.pickImages;
    assert.equal(pi.semanticSelection, true);
    assert.deepEqual(Object.keys(pi.slots), ['hero', 'context', 'action', 'moment', 'reaction']); // instance ids จาก contract
    assert.deepEqual(pi.slotOrder, ['hero', 'context', 'action', 'moment', 'reaction']); // ★ ลำดับ sourceIndex ตรงๆ ห้าม sort/ย้าย hero
    assert.equal(pi.heroSlotId, 'hero'); // authority ให้ S7 หา hero โดยไม่พึ่งลำดับ
    assert.equal(pi.slots.reaction.id, 'P5'); // วงกลม (บท reaction) = สรพงศ์ตาม wantPerson — ไม่โดน hero lock
    assert.equal(pi.slots.moment.id, 'P8');   // บท moment (นอกคลังศัพท์ legacy) ยังอยู่ครบหลังด่าน
    for (const [k, v] of Object.entries(pi.slots)) assert.equal(v.refSlotId, k, 'ทุก entry ต้องพก refSlotId ตัวเอง');
    // brain ได้รับ slotContract จริง
    assert.ok(Array.isArray(captures.brainArgs[0].slotContract) && captures.brainArgs[0].slotContract.length === 5);
  });
});

await test('semantic ON: S7 ส่ง primary URL ครบทุก instance — reaction-circle ไม่หาย และ refSlotId เป็น authority', async () => {
  await withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job.dossier, s6.dossierPatch); // จำลอง tick merge
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    assert.equal(s7.status, 'done');
    const plan = captures.payload.slotPlan;
    const primaries = plan.filter((p) => p.refSlotId);
    assert.deepEqual(primaries.map((p) => p.refSlotId).sort(), ['action', 'context', 'hero', 'moment', 'reaction']);
    const byRef = Object.fromEntries(primaries.map((p) => [p.refSlotId, p]));
    assert.equal(byRef.reaction.url, 'https://cdn.test/P5.jpg'); // circle-shape instance ถูกส่งจริง
    assert.equal(byRef.hero.isHero, true);
    assert.equal(byRef.moment.url, 'https://cdn.test/P8.jpg');
    // slot legacy = projection เชิงความหมายแบบ unique (fix ผู้ตรวจ P1 — ห้ามใช้ contract.legacySlot ตำแหน่ง):
    //   circle-instance ต้องได้ 'circle' เสมอ · canonical hero ได้ 'hero' · บทนอกคลังศัพท์ไล่ป้ายว่าง deterministic
    const lbls = primaries.map((p) => p.slot).filter(Boolean);
    assert.equal(new Set(lbls).size, lbls.length, 'ป้าย legacy ห้ามซ้ำข้ามช่อง');
    assert.equal(byRef.hero.slot, 'hero');
    assert.equal(byRef.reaction.slot, 'circle');  // instance วงกลม (บท reaction) → composer เห็นเป็นวงจริง
    assert.equal(byRef.context.slot, 'context');
    assert.equal(byRef.action.slot, 'action');
    assert.equal(byRef.moment.slot, 'reaction');  // บทนอกคลังศัพท์ → ป้ายว่างถัดไป (deterministic)
    // links[0] = canonical hero URL (ลำดับ boost)
    assert.equal(captures.payload.slotPlan[0].url, 'https://cdn.test/P1.jpg');
  });
});

await test('semantic ON: ref 4 ช่องที่มี circle (REF-mrbq660y-la4b) — primary ครบทุก instance รวม moment-circle', async () => {
  await withEnv(true, async () => {
    const dna = loadRefDna('REF-mrbq660y-la4b');
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: [] },
      context: { id: 'P7', reason: 'x', backups: [] },
      victim: { id: 'P4', reason: 'x', backups: [] },
      moment: { id: 'P6', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna, orders: [{ i: 0, role: 'hero', want: 'ตัวเอก', personHint: 'ดวงเดือน' }], chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    assert.deepEqual(Object.keys(s6.dossierPatch.pickImages.slots), ['hero', 'context', 'victim', 'moment']);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    assert.equal(s7.status, 'done');
    const primaries = captures.payload.slotPlan.filter((p) => p.refSlotId);
    assert.deepEqual(primaries.map((p) => p.refSlotId).sort(), ['context', 'hero', 'moment', 'victim']);
    assert.equal(primaries.find((p) => p.refSlotId === 'moment').url, 'https://cdn.test/P6.jpg'); // วงกลมไม่หาย
  });
});

await test('semantic ON: REF-mrbq6pds-3dil hero+hero_2 คนละ subject — hero_2 ไม่โดน global hero lock และไม่โดนบังคับหน้าเดี่ยว', async () => {
  await withEnv(true, async () => {
    const dna = loadRefDna('REF-mrbq6pds-3dil');
    // hero_2 ตาม ref เป็นผู้หญิง (สมหญิง) — เข็มทิศ role=hero มีแต่ สมชาย → legacy lock เดิมจะฆ่า hero_2
    const pool = [
      IMG('M1', { person: 'สมชาย', category: 'face-emotional' }),
      IMG('M2', { person: 'สมชาย', category: 'face-neutral' }),
      IMG('F1', { person: 'สมหญิง', category: 'face-emotional', faceCount: 2 }), // สองหน้า — ต้องไม่โดน force-solo
      IMG('F2', { person: 'สมหญิง', category: 'face-neutral' }),
      IMG('C1', { person: null, faceCount: 0, category: 'context', note: 'ฉากบริบทกว้างเห็นบ้านและถนนยามเย็นชัดเจน' }),
      IMG('C2', { person: null, faceCount: 0, category: 'context', note: 'ภาพมุมสูงของงานพิธีมีผู้คนจำนวนมากร่วมงาน' }),
      IMG('O1', { person: 'สมหญิง', category: 'face-emotional' }),
    ];
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอกชาย', personHint: 'สมชาย' },
      { i: 1, role: 'hero', want: 'ฝ่ายหญิงของเรื่อง', personHint: 'สมหญิง' },
    ];
    const answer = {
      hero: { id: 'M1', reason: 'x', backups: [] },
      hero_2: { id: 'F1', reason: 'x', backups: [] },
      context: { id: 'C1', reason: 'x', backups: [] },
      context_2: { id: 'C2', reason: 'x', backups: [] },
      moment: { id: 'O1', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna, orders, chars: [{ name: 'สมชาย', role: 'hero' }] });
    const out = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const slots = out.dossierPatch.pickImages.slots;
    assert.deepEqual(Object.keys(slots), ['hero', 'hero_2', 'context', 'context_2', 'moment']);
    assert.deepEqual(out.dossierPatch.pickImages.slotOrder, ['hero', 'hero_2', 'context', 'context_2', 'moment']); // sourceIndex ตรงๆ
    assert.equal(slots.hero.id, 'M1');
    assert.equal(slots.hero_2.id, 'F1', 'hero_2 ต้องรอด — person intent ของช่องตัวเอง ไม่ใช่ first-hero lock');
    assert.equal(slots.hero_2.faces, 2, 'hero_2 ห้ามโดน faceCount=1 เหมารวม');
    // สลับ intent: brain ยัดภาพสมชายลง hero_2 → ต้องโดน kill ด้วย intent ของช่อง (สมหญิง) แล้ว fallback หาสมหญิง
    const answer2 = { ...answer, hero_2: { id: 'M2', reason: 'ผิดคน', backups: [] } };
    const cap2 = { brainArgs: [], fetches: [], payload: null };
    const job2 = mkJob({ dna, orders, chars: [{ name: 'สมชาย', role: 'hero' }] });
    const out2 = await s6_slots(job2, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer2, captures: cap2 }) });
    const got2 = out2.dossierPatch.pickImages.slots.hero_2;
    assert.ok(got2 && got2.person === 'สมหญิง', `hero_2 ที่ brain เลือกผิดคนต้องถูกแทนด้วยคนตาม intent (ได้: ${got2?.person})`);
  });
});

await test('determinism: semantic ON รันซ้ำ input เดิม 2 รอบ → dossierPatch + payload byte-identical', async () => {
  const run = async () => withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    const scrub = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'enqueuedAt' || k === 'refBoundAt' ? '<t>' : v)));
    return JSON.stringify({ s6: scrub(s6.dossierPatch), payload: scrub(captures.payload) });
  });
  const a = await run();
  const b = await run();
  assert.equal(a, b);
});

await test('OFF parity (runtime deepEqual): dossier/payload shape = legacy เดิมทุก field — ไม่มี refSlotId/slotOrder/semantic log', async () => {
  await withEnv(false, async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); origLog(...a); };
    let s6, s7r, captures, job;
    try {
      captures = { brainArgs: [], fetches: [], payload: null };
      const answerLegacy = {
        hero: { id: 'P1', reason: 'r1', backups: ['P4'] },
        reaction: { id: 'P5', reason: 'r2', backups: [] },
        action: { id: 'P2', reason: 'r3', backups: [] },
        context: { id: 'P7', reason: 'r4', backups: [] },
        circle: { id: 'P6', reason: 'r5', backups: [] },
      };
      job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
      s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answerLegacy, captures }) });
      Object.assign(job.dossier, s6.dossierPatch);
      s7r = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answerLegacy, captures }) });
    } finally { console.log = origLog; }
    // ★ audit D: ผล s7 ฝั่ง OFF — dossierPatch.cover ต้องไม่มี selectionSpec/semantic field ใดๆ
    assert.equal(s7r.status, 'done');
    assert.deepEqual(Object.keys(s7r.dossierPatch.cover).sort(), ['enqueuedAt', 'queueJobId', 'refStyle', 'sourceLinks'].sort());
    assert.ok(!('selectionSpec' in s7r.dossierPatch.cover));
    // ★ P2 hardening: deepEqual "ทั้งก้อน" เท่าที่ harness ทำได้ — result/dossier/payload เต็มทุก field
    //   ข้อจำกัดรายงานตรงๆ: byte-vs-HEAD runtime เทียบสดไม่ได้โดยไม่มีไฟล์ที่ 4 (ต้อง snapshot โค้ด HEAD
    //   เป็นโมดูลแยก) — จึงใช้ full-value deepEqual จาก fixture คงที่ + source-diff review ของ Codex แทน
    assert.equal(s6.status, 'done');
    assert.equal(s6.nextAction, 'continue');
    assert.equal(s6.summary, 'จับคู่ 5/5 ช่อง — mock');
    assert.deepEqual(Object.keys(s6.dossierPatch).sort(), ['artBrief', 'images', 'pickImages', 'refMatch'].sort());
    assert.equal(s6.dossierPatch.refMatch, job.dossier.refMatch); // echo อ้าง reference เดิม ไม่ clone/แปลง
    assert.equal(s6.dossierPatch.artBrief, job.dossier.artBrief);
    assert.deepEqual(s6.dossierPatch.images.quarantine, { untriaged: 0, sizeUnknown: 0, heroDemoted: false, sample: [] });
    const SLOTX = (id, cat, person, reason, backups = [], faces = 1) => ({
      id, imageUrl: `https://cdn.test/${id}.jpg`, person, category: cat,
      emotion: 'warm', clean: true, newsScene: true, faces, dirtyFallback: false, reason, backups,
    });
    // pickImages ทั้งก้อน — field ใหม่โผล่จุดใดก็แดงทันที
    assert.deepEqual(s6.dossierPatch.pickImages, {
      slots: {
        hero: SLOTX('P1', 'face-emotional', 'ดวงเดือน', 'r1', ['P4']),
        reaction: SLOTX('P5', 'face-neutral', 'สรพงศ์ ชาตรี', 'r2'),
        action: SLOTX('P2', 'context', 'ดวงเดือน', 'r3'),
        context: SLOTX('P7', 'context', null, 'r4', [], 0),
        circle: SLOTX('P6', 'face-emotional', 'สรพงศ์ ชาตรี', 'r5'),
      },
      note: 'mock', poolSize: 8, brainOk: true, fallbackUsed: 0,
    });
    // payload ทั้งก้อน — slotPlan ทุก row ทุก field + refDNA identity เดิม
    const ROWX = (id, slot, person, cat, note, { faces = 1, isHero = false } = {}) => ({
      url: `https://cdn.test/${id}.jpg`, slot, clean: true, newsScene: true, faces, dirtyFallback: false,
      isHero, thumbnailUrl: '', person, category: cat, emotion: 'warm', note, faceBox: null, peopleBox: null,
    });
    assert.deepEqual(captures.payload, {
      jobType: 'cover', composer: 'mega', newsTitle: 'ข่าวทดสอบ SEM-1', userId: 'mega-bot',
      refDNA: DNA_ALPO, refImagePath: '/ref-covers/test.jpg',
      slotPlan: [
        ROWX('P1', 'hero', 'ดวงเดือน', 'face-emotional', 'ดวงเดือนยืนหน้าวิหารกำลังไหว้พระอย่างสงบ', { isHero: true }),
        ROWX('P5', 'reaction', 'สรพงศ์ ชาตรี', 'face-neutral', 'สรพงศ์ภาพเก่าหน้าตรงในชุดสูทสีเข้มสมัยหนุ่ม'),
        ROWX('P2', 'action', 'ดวงเดือน', 'context', 'ดวงเดือนกำลังก่อสร้างวิหารกับช่างหลายคนกลางแดด'),
        ROWX('P7', 'context', null, 'context', 'วิหารสีทองกลางแสงเย็นถ่ายมุมกว้างเห็นนั่งร้าน', { faces: 0 }),
        ROWX('P6', 'circle', 'สรพงศ์ ชาตรี', 'face-emotional', 'สรพงศ์ยิ้มกว้างถือพวงมาลัยหน้าโรงถ่ายภาพยนตร์'),
        ROWX('P4', null, 'ดวงเดือน', 'face-neutral', 'ดวงเดือนหน้าตรงยิ้มบางในชุดขาวริมระเบียง'), // backup ของ hero
      ],
    });
    assert.ok(!logs.some((l) => l.includes('🧬')), 'OFF ห้ามมี semantic log แม้บรรทัดเดียว');
  });
});

await test('activation precondition: เปิดสวิตช์แต่ MEGA_SELECTION_SPEC ไม่ครบ/ref แมตช์หลวม → legacy ปลอดภัย', async () => {
  // ครบสวิตช์เดียว → legacy
  process.env.MEGA_SEMANTIC_SELECTION = '1';
  delete process.env.MEGA_SELECTION_SPEC;
  try {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const answerLegacy = { hero: { id: 'P1', reason: 'x', backups: [] }, reaction: { id: 'P5', reason: 'x', backups: [] }, action: { id: 'P2', reason: 'x', backups: [] }, context: { id: 'P7', reason: 'x', backups: [] }, circle: { id: 'P6', reason: 'x', backups: [] } };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    const out = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answerLegacy, captures }) });
    assert.ok(!out.dossierPatch.pickImages.semanticSelection);
    assert.deepEqual(Object.keys(out.dossierPatch.pickImages.slots), ['hero', 'reaction', 'action', 'context', 'circle']);
  } finally { delete process.env.MEGA_SEMANTIC_SELECTION; }
  // ครบสองสวิตช์แต่ typeMatched=false → legacy
  await withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const answerLegacy = { hero: { id: 'P1', reason: 'x', backups: [] }, reaction: { id: 'P5', reason: 'x', backups: [] }, action: { id: 'P2', reason: 'x', backups: [] }, context: { id: 'P7', reason: 'x', backups: [] }, circle: { id: 'P6', reason: 'x', backups: [] } };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    job.dossier.refMatch.typeMatched = false; // แมตช์หลวม = _refDNA null
    const out = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answerLegacy, captures }) });
    assert.ok(!out.dossierPatch.pickImages.semanticSelection);
    assert.deepEqual(Object.keys(out.dossierPatch.pickImages.slots), ['hero', 'reaction', 'action', 'context', 'circle']);
  });
});

await test('brain prompt: OFF = schema legacy เดิม / ON = schema per-instance (ผ่าน _deps.callBrain — ไม่ยิง LLM)', async () => {
  const seen = [];
  const cb = async ({ system, user }) => { seen.push({ system, user }); return { text: '{"slots":{},"note":""}' }; };
  const base = { imagesMeta: [{ id: 'X1', person: null, category: 'other', quality: 5, faces: 0, clean: true, newsScene: true, src: '' }], compass: { angle: 'a', mainCharacters: [] }, deskTitle: 't', refDNA: null, artBrief: null, sceneInventory: '' };
  await slotDirectorBrain({ ...base, _deps: { callBrain: cb } });
  const contract = buildRefSlotContract({ refDNA: DNA_ALPO, artBriefOrders: ORDERS_ALPO });
  await slotDirectorBrain({ ...base, slotContract: contract.slots, _deps: { callBrain: cb } });
  const [off, on] = seen;
  assert.ok(off.system.includes('"hero":{"id":"...","reason":"สั้นๆ"'), 'OFF ต้องเป็น schema legacy เดิม');
  assert.ok(off.system.includes('- reaction: บุคคลที่สอง'), 'OFF ต้องมีนิยาม 5 บทเดิม');
  assert.ok(!off.system.includes('ช่องจริงของปกเป้า'), 'OFF ห้ามมี marker semantic');
  for (const s of contract.slots) assert.ok(on.system.includes(`"${s.id}":{"id"`), `ON schema ต้องมีช่อง ${s.id}`);
  assert.ok(on.system.includes('คน: สรพงศ์ ชาตรี'), 'ON ต้องพก wantPerson ของช่องวงกลม');
  assert.ok(!on.system.includes('"circle":{"id"') || contract.slots.some((s) => s.id === 'circle'), 'ON ห้ามมี key circle ปลอมที่ไม่อยู่ในสัญญา');
});

await test('story-rescue (STORY_SEL_ON จริง): ห้ามสลับช่องที่มี intent เป็นผิดคน + field instance คงครบหลัง rescue + backups ผ่าน identity', async () => {
  await withEnv(true, async () => {
    // เปิด story-fit จริง: S6_STORY_FIT default ON + storyQueries ในแฟ้ม → STORY_SEL_ON=true
    const pool = [
      ...POOL_A,
      // ภาพ "ผิดคน" (ดวงเดือน) ที่ story สูงกว่า (query ตรง storyQueries → 3+4=7) — เหยื่อล่อ rescue
      IMG('W1', { person: 'ดวงเดือน', category: 'context', note: 'ดวงเดือนโบกมือกลางงานบุญใหญ่ผู้คนล้นหลามรอบวิหาร' }, { query: 'วิหารทดสอบ' }),
    ];
    const answer = {
      ...ANSWER_ALPO,
      reaction: { id: 'P5', reason: 'สรพงศ์ตาม intent', backups: ['P6', 'P4'] }, // P4=ดวงเดือน ต้องถูกกรองทิ้ง (P0-3)
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    job.dossier.images.storyQueries = ['วิหารทดสอบ'];
    const out = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const slots = out.dossierPatch.pickImages.slots;
    // ช่องวงกลม (reaction) มี wantPerson สรพงศ์ — W1 story 7 ต้องแพ้ identity: ห้าม replace (P0-1/P0-2)
    assert.equal(slots.reaction.id, 'P5', 'rescue ห้ามสลับช่องที่ ref ระบุคนเป็นผิดคน');
    assert.equal(slots.reaction.refSlotId, 'reaction');
    assert.equal(slots.reaction.legacySlot, 'circle');
    assert.deepEqual(slots.reaction.backups, ['P6'], 'backups ต้องเหลือเฉพาะคนตาม intent (P4 ผิดคนถูกกรอง)');
    // ช่อง context ไม่มี intent → rescue ทำงานปกติ (W1 story 7 ชนะ) และ field instance ต้องอยู่ครบหลัง rescue (P1 fix)
    assert.equal(slots.context.id, 'W1', 'ช่องไร้ intent ต้องถูก rescue ได้ตามเดิม');
    assert.equal(slots.context.refSlotId, 'context');
    assert.equal(slots.context.legacySlot, 'context');
  });
});

await test('circle same-person ตาม explicit intent: ห้ามโดนกฎ different-person ตัด (ทั้งลูปและ rescue)', async () => {
  await withEnv(true, async () => {
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอกโคลสอัพ', personHint: 'ดวงเดือน', shot: 'closeup' },
      { i: 4, role: 'reaction', want: 'ตัวเอกในวงอีกอารมณ์', personHint: 'ดวงเดือน', shot: 'closeup' }, // วงกลม = คนเดียวกับ hero โดยตั้งใจ
    ];
    const pool = [
      ...POOL_A,
      IMG('W2', { person: 'สรพงศ์ ชาตรี', category: 'face-emotional', note: 'สรพงศ์ในงานบุญคนแน่นหน้าวิหารช่วงเย็นแสงทอง' }, { query: 'วิหารทดสอบ' }),
    ];
    const answer = { ...ANSWER_ALPO, reaction: { id: 'P4', reason: 'ตัวเอกตาม intent', backups: [] } };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders, chars: CHARS_A });
    job.dossier.images.storyQueries = ['วิหารทดสอบ'];
    const out = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const slots = out.dossierPatch.pickImages.slots;
    assert.equal(slots.reaction.id, 'P4', 'วงกลมคนเดียวกับ hero ตาม intent ต้องรอด — intent ชนะกฎ global');
    assert.equal(slots.reaction.person, 'ดวงเดือน');
  });
});

await test('P1-A kill switch end-to-end: S6 ตอน ON → ปิดสวิตช์ก่อน S7 = waiting ไม่มี fetch/enqueue · เปิดกลับ = เดินต่อ', async () => {
  const captures = { brainArgs: [], fetches: [], payload: null };
  const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
  await withEnv(true, async () => {
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
  });
  // สวิตช์ปิดแล้ว (withEnv คืนค่า) — persisted semantic ต้องพัก ห้ามแปลง legacy
  const cap2 = { brainArgs: [], fetches: [], payload: null };
  const held = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap2 }) });
  assert.equal(held.status, 'waiting');
  assert.equal(held.nextAction, 'wait');
  assert.equal(cap2.fetches.length, 0, 'ระหว่าง hold ห้ามแตะ network แม้ครั้งเดียว');
  assert.equal(cap2.payload, null, 'ห้าม enqueue');
  // เปิดสวิตช์กลับ → งานเดิมเดินต่อได้ปกติ
  await withEnv(true, async () => {
    const cap3 = { brainArgs: [], fetches: [], payload: null };
    const ok = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap3 }) });
    assert.equal(ok.status, 'done');
    assert.ok(cap3.payload, 'เปิดกลับต้อง enqueue ได้');
  });
});

await test('P1-B backup owner: same-person circle S6→S7 — backup พก owner/slot ของช่องตัวเอง · ห้ามฉีด/จัดลำดับคนนอกสัญญา', async () => {
  await withEnv(true, async () => {
    const pool = [
      ...POOL_A,
      IMG('P9', { person: 'ดวงเดือน', category: 'face-neutral', note: 'ดวงเดือนยิ้มในสวนหลังบ้านช่วงสายแดดอ่อนสงบ' }),
    ];
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอกโคลสอัพ', personHint: 'ดวงเดือน', shot: 'closeup' },
      { i: 4, role: 'reaction', want: 'ตัวเอกในวงอีกอารมณ์', personHint: 'ดวงเดือน', shot: 'closeup' }, // วง = คนเดียวกับ hero โดย ref
    ];
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: ['P3'] },
      context: { id: 'P7', reason: 'x', backups: [] },
      action: { id: 'P2', reason: 'x', backups: [] },
      moment: { id: 'P8', reason: 'x', backups: [] },
      reaction: { id: 'P4', reason: 'x', backups: ['P9', 'P5'] }, // P5 สรพงศ์ = ผิด intent ต้องหายตั้งแต่ S6
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    assert.deepEqual(s6.dossierPatch.pickImages.slots.reaction.backups, ['P9'], 'S6 ต้องกรอง backup ผิด intent ทิ้งแล้ว');
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    assert.equal(s7.status, 'done');
    const plan = captures.payload.slotPlan;
    // primary 5 ใบ refSlotId ครบ + ไม่มี backupForRefSlotId
    const primaries = plan.filter((p) => p.refSlotId);
    assert.deepEqual(primaries.map((p) => p.refSlotId).sort(), ['action', 'context', 'hero', 'moment', 'reaction']);
    for (const p of primaries) assert.ok(!('backupForRefSlotId' in p));
    // backups: owner ถูกช่อง + ป้าย slot = legacy ของเจ้าของ + ห้ามมี refSlotId
    const backups = plan.filter((p) => 'backupForRefSlotId' in p);
    const byOwn = Object.fromEntries(backups.map((p) => [p.backupForRefSlotId, p]));
    assert.equal(byOwn.hero?.url, 'https://cdn.test/P3.jpg');
    assert.equal(byOwn.hero?.slot, 'hero');
    assert.equal(byOwn.reaction?.url, 'https://cdn.test/P9.jpg');
    assert.equal(byOwn.reaction?.slot, 'circle', 'backup ของช่องวงต้องได้ป้าย circle ของเจ้าของ');
    for (const p of backups) assert.ok(!('refSlotId' in p), 'refSlotId = primary เท่านั้น');
    // ห้ามฉีดคนนอกสัญญา (different-person guarantee ปิดใน semantic): P5/P6 สรพงศ์ ต้องไม่โผล่ทั้งแผน
    assert.ok(!plan.some((p) => /P5|P6/.test(String(p.url))), 'ห้ามมีภาพคนนอกสัญญาในแผน semantic');
  });
});

await test('P2-A semantic: backup คนละคนใน no-intent slot + ลิงก์เกิน 10 — ไม่มี diffP promote/inject, ลำดับ deterministic, ตัดท้ายตามเพดาน', async () => {
  await withEnv(true, async () => {
    const pool = [
      ...POOL_A,
      IMG('P9', { person: 'ดวงเดือน', category: 'face-neutral', note: 'ดวงเดือนยิ้มในสวนหลังบ้านช่วงสายแดดอ่อนสงบ' }),
      IMG('P10', { person: null, faceCount: 0, category: 'context', note: 'ตะเกียงโบราณวางเรียงบนแท่นบูชายามค่ำคืน' }),
      IMG('P11', { person: null, faceCount: 0, category: 'context', note: 'ป้ายบอกทางเข้าวิหารท่ามกลางต้นไม้เขียวขจี' }),
    ];
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอกโคลสอัพ', personHint: 'ดวงเดือน', shot: 'closeup' },
      { i: 4, role: 'reaction', want: 'ตัวเอกในวง', personHint: 'ดวงเดือน', shot: 'closeup' },
    ];
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: ['P3', 'P9'] },
      context: { id: 'P7', reason: 'x', backups: ['P5', 'P11'] }, // P5 สรพงศ์ = คนละคน ใน no-intent slot (ถูกต้อง)
      action: { id: 'P2', reason: 'x', backups: ['P6'] },          // P6 สรพงศ์ อีกใบ
      moment: { id: 'P8', reason: 'x', backups: ['P10'] },
      reaction: { id: 'P4', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    // no-intent slot เก็บ backup คนละคนได้ (identity gate ไม่ยุ่ง)
    assert.deepEqual(s6.dossierPatch.pickImages.slots.context.backups, ['P5', 'P11']);
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    assert.equal(s7.status, 'done');
    const urls = captures.payload.slotPlan.map((p) => p.url.replace('https://cdn.test/', '').replace('.jpg', ''));
    // deterministic: primaries ตาม slotOrder แล้ว backups ตามลำดับช่อง (ไม่มี diffP ดัน P5/P6 ขึ้นหน้า) · 11→10 ตัด P10 ท้ายสุด
    assert.deepEqual(urls, ['P1', 'P7', 'P2', 'P8', 'P4', 'P3', 'P9', 'P5', 'P11', 'P6']);
    const p5row = captures.payload.slotPlan.find((p) => p.url.includes('P5'));
    assert.equal(p5row.backupForRefSlotId, 'context');
    assert.equal(p5row.slot, 'context'); // ป้ายเจ้าของ ไม่ใช่โปรโมทเป็น circle/หน้าแผน
  });
});

await test('P2-B legacy twin (OFF): กฎ different-person sort เดิมยังทำงาน — สรพงศ์ backup ถูกดันขึ้นก่อน', async () => {
  await withEnv(false, async () => {
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: ['P3', 'P5'] }, // ดวงเดือนก่อน สรพงศ์หลัง — sort เดิมต้องสลับ
      reaction: { id: 'P4', reason: 'x', backups: [] },
      action: { id: 'P2', reason: 'x', backups: [] },
      context: { id: 'P7', reason: 'x', backups: [] },
      circle: { id: 'P6', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    const urls = captures.payload.slotPlan.map((p) => p.url);
    const iP5 = urls.findIndex((u) => u.includes('P5'));
    const iP3 = urls.findIndex((u) => u.includes('P3'));
    assert.ok(iP5 >= 5 && iP3 > iP5, `legacy ต้องดันคนละคน (P5) ขึ้นก่อน backup คนเดิม (P3): iP5=${iP5} iP3=${iP3}`);
  });
});

await test('P2-C duplicate owner: backup id เดียวอยู่สอง instance — owner แรกตาม slotOrder ชนะ + slotPlan มี row เดียว', async () => {
  await withEnv(true, async () => {
    const pool = [...POOL_A, IMG('P9', { person: 'ดวงเดือน', category: 'face-neutral', note: 'ดวงเดือนยิ้มในสวนหลังบ้านช่วงสายแดดอ่อนสงบ' })];
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: ['P9'] },
      context: { id: 'P7', reason: 'x', backups: ['P9'] }, // ซ้ำกับ hero — hero มาก่อนใน slotOrder
      action: { id: 'P2', reason: 'x', backups: [] },
      moment: { id: 'P8', reason: 'x', backups: [] },
      reaction: { id: 'P4', reason: 'x', backups: [] },
    };
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอก', personHint: 'ดวงเดือน' },
      { i: 4, role: 'reaction', want: 'ตัวเอกในวง', personHint: 'ดวงเดือน' },
    ];
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const rows = captures.payload.slotPlan.filter((p) => p.url.includes('P9'));
    assert.equal(rows.length, 1, 'URL เดียวต้องมี row เดียว (dedupe)');
    assert.equal(rows[0].backupForRefSlotId, 'hero', 'owner แรกตาม slotOrder ต้องชนะ');
    assert.equal(rows[0].slot, 'hero');
  });
});

await test('P2-D URL alias: สอง candidateId ชี้ URL เดียว — slotPlan dedupe + spec ไม่รายงาน backup ซ้ำ', async () => {
  await withEnv(true, async () => {
    const aliasUrl = 'https://cdn.test/ALIAS.jpg';
    const pool = [
      ...POOL_A,
      IMG('A1', { person: null, faceCount: 0, category: 'context', note: 'ภาพมุมสูงวิหารเวอร์ชันแรกจากโดรนยามเช้าตรู่' }, { imageUrl: aliasUrl }),
      IMG('A2', { person: null, faceCount: 0, category: 'context', note: 'ภาพมุมสูงวิหารเวอร์ชันสองจากโดรนยามเช้าตรู่' }, { imageUrl: aliasUrl }),
    ];
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอก', personHint: 'ดวงเดือน' },
      { i: 4, role: 'reaction', want: 'ตัวเอกในวง', personHint: 'ดวงเดือน' },
    ];
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: [] },
      context: { id: 'P7', reason: 'x', backups: ['A1'] },
      action: { id: 'P2', reason: 'x', backups: ['A2'] }, // alias URL เดียวกับ A1
      moment: { id: 'P8', reason: 'x', backups: [] },
      reaction: { id: 'P4', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const rows = captures.payload.slotPlan.filter((p) => p.url === aliasUrl);
    assert.equal(rows.length, 1, 'alias URL ต้องเหลือ row เดียว deterministic');
    assert.equal(rows[0].backupForRefSlotId, 'context', 'owner แรกตาม slotOrder (context มาก่อน action)');
    // ★ SEM-2: spec เป็น exact-authority แล้ว — backup ผูก owner ของตัวเอง lookup ด้วย refSlotId (ห้ามใช้ slots[0])
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.ok(spec, 'semantic ON + MEGA_SELECTION_SPEC=1 ต้องมี spec ใน dossier');
    assert.equal(spec.mode, 'ref_slot_exact');
    const ctxSlot = spec.slots.find((s) => s.refSlotId === 'context');
    assert.deepEqual(ctxSlot.backups.map((b) => b.candidateId), ['A1'], 'alias อยู่ที่ owner จริง (context) + candidateId แรกชนะ');
    const actSlot = spec.slots.find((s) => s.refSlotId === 'action');
    assert.deepEqual(actSlot.backups, [], 'URL alias ห้ามรั่วข้ามไปช่องอื่น');
    const allBkUrls = spec.slots.flatMap((s) => s.backups.map((b) => b.imageUrl));
    assert.equal(new Set(allBkUrls).size, allBkUrls.length, 'spec backups ห้ามมี URL ซ้ำทั้งสัญญา');
  });
});

// ═══════════ SEM-2: exact authority (plannedByRefSlot) ═══════════

await test('SEM2-1 REF-mrbqalpo contract fixture (AC-0066 family; synthetic, not live) S6→S7: exact ครบ — strictReady=true', async () => {
  await withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.equal(spec.mode, 'ref_slot_exact');
    assert.deepEqual(spec.slots.map((s) => s.refSlotId), ['hero', 'context', 'action', 'moment', 'reaction']);
    assert.deepEqual(spec.counts, { total: 5, mapped: 5, unmapped: 0, missingPrimary: 0, duplicatePrimary: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 });
    assert.equal(spec.strictReady, true);
    for (const s of spec.slots) assert.equal(s.mappingMode, 'ref_slot_exact');
    // primary identity ตรงกับ S6 slots จริง (candidateId จาก slots[refSlotId].id + URL จาก row ที่ส่งจริง)
    for (const s of spec.slots) assert.equal(s.primary.candidateId, String(job.dossier.pickImages.slots[s.refSlotId].id));
    assert.ok(!spec.authorityStale);
    assert.deepEqual(spec.diagnostics.extraPlannedKeys, []);
    // ยัง shadow ล้วน: ห้ามอยู่ใน queue payload
    assert.ok(!('selectionSpec' in captures.payload), 'spec ห้ามเข้า payload');
    assert.ok(!('plannedByRefSlot' in captures.payload), 'plannedByRefSlot ห้ามเข้า payload');
  });
});

await test('SEM2-2 ref 4 ช่อง+moment-circle (REF-mrbq660y): strictReady=true', async () => {
  await withEnv(true, async () => {
    const dna = loadRefDna('REF-mrbq660y-la4b');
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: [] },
      context: { id: 'P7', reason: 'x', backups: [] },
      victim: { id: 'P4', reason: 'x', backups: [] },
      moment: { id: 'P6', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna, orders: [{ i: 0, role: 'hero', want: 'ตัวเอก', personHint: 'ดวงเดือน' }], chars: CHARS_A, refId: 'REF-mrbq660y-la4b' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.equal(spec.strictReady, true);
    assert.equal(spec.counts.missingPrimary, 0);
    assert.equal(spec.counts.semanticFallback, 0);
    const moment = spec.slots.find((s) => s.refSlotId === 'moment');
    assert.equal(moment.composerSlotId, 'circle');
    assert.equal(moment.mappingMode, 'ref_slot_exact');
  });
});

await test('SEM2-3 duplicate roles (REF-mrbq6pds): hero_2/context_2 exact คนละ instance + strictReady=true', async () => {
  await withEnv(true, async () => {
    const dna = loadRefDna('REF-mrbq6pds-3dil');
    const pool = [
      IMG('M1', { person: 'สมชาย', category: 'face-emotional' }),
      IMG('F1', { person: 'สมหญิง', category: 'face-emotional' }),
      IMG('C1', { person: null, faceCount: 0, category: 'context', note: 'ฉากบริบทกว้างเห็นบ้านและถนนยามเย็นชัดเจน' }),
      IMG('C2', { person: null, faceCount: 0, category: 'context', note: 'ภาพมุมสูงของงานพิธีมีผู้คนจำนวนมากร่วมงาน' }),
      IMG('O1', { person: 'สมหญิง', category: 'face-emotional' }),
    ];
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอกชาย', personHint: 'สมชาย' },
      { i: 1, role: 'hero', want: 'ฝ่ายหญิง', personHint: 'สมหญิง' },
      { i: 4, role: 'moment', want: 'วงกลมหญิง', personHint: 'สมหญิง' },
    ];
    const answer = {
      hero: { id: 'M1', reason: 'x', backups: [] },
      hero_2: { id: 'F1', reason: 'x', backups: [] },
      context: { id: 'C1', reason: 'x', backups: [] },
      context_2: { id: 'C2', reason: 'x', backups: [] },
      moment: { id: 'O1', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna, orders, chars: [{ name: 'สมชาย', role: 'hero' }], refId: 'REF-mrbq6pds-3dil' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.deepEqual(spec.slots.map((s) => s.refSlotId), ['hero', 'hero_2', 'context', 'context_2', 'moment']);
    assert.equal(spec.strictReady, true);
    assert.equal(spec.slots.find((s) => s.refSlotId === 'hero').primary.candidateId, 'M1');
    assert.equal(spec.slots.find((s) => s.refSlotId === 'hero_2').primary.candidateId, 'F1');
  });
});

await test('SEM2-4 exact missing primary: ห้ามยืม legacy — fallback=0, missing=1, strictReady=false', async () => {
  await withEnv(true, async () => {
    const pool = [ // 4 ใบพอดีสำหรับ 4 ช่องแรก — moment ไม่มีของให้ fallback = null จริง
      POOL_A[0], POOL_A[6], POOL_A[1], POOL_A[3], // P1, P7, P2, P4
    ];
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอก', personHint: 'ดวงเดือน' },
      { i: 4, role: 'reaction', want: 'ตัวเอกในวง', personHint: 'ดวงเดือน' },
    ];
    const answer = {
      hero: { id: 'P1', reason: 'x', backups: [] },
      context: { id: 'P7', reason: 'x', backups: [] },
      action: { id: 'P2', reason: 'x', backups: [] },
      moment: { id: 'P4', reason: 'x', backups: [] },
      reaction: { id: null, reason: 'ไม่มีของ', backups: [] }, // ช่องท้าย (intent ดวงเดือน) — พูลหมด = ว่างจริง
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    assert.equal(s6.dossierPatch.pickImages.slots.reaction, null, 'fixture ต้องทำให้ reaction ว่างจริง (intent + พูลหมด)');
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.equal(spec.mode, 'ref_slot_exact');
    const missSlot = spec.slots.find((s) => s.refSlotId === 'reaction');
    assert.equal(missSlot.primary, null, 'ห้ามยืมภาพจากบทอื่นมาใส่');
    assert.equal(missSlot.mappingMode, 'ref_slot_exact');
    assert.deepEqual(spec.counts, { total: 5, mapped: 5, unmapped: 0, missingPrimary: 1, duplicatePrimary: 0, duplicatePrimaryUrl: 0, semanticFallback: 0 });
    assert.equal(spec.strictReady, false);
  });
});

await test('SEM2-5 duplicate primary candidate ข้ามช่อง (unit): strictReady=false', async () => {
  const dna = loadRefDna('REF-mrbqalpo-h1r1');
  const contract = buildRefSlotContract({ refDNA: dna, artBriefOrders: [] });
  const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');
  const { buildSelectionSpec } = await import('../src/lib/refSlotContract.js');
  const P = (cid) => ({ candidateId: cid, imageUrl: `https://cdn.test/${cid}.jpg`, backups: [] });
  const spec = buildSelectionSpec({
    contract,
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedByRefSlot: { hero: P('DUP'), context: P('DUP'), action: P('a'), moment: P('m'), reaction: P('r') },
    refId: 'x',
  });
  assert.equal(spec.counts.duplicatePrimary, 1);
  assert.equal(spec.counts.semanticFallback, 0);
  assert.equal(spec.strictReady, false);
});

await test('SEM2-6 multiple circles (unit): moment/moment_2 exact แยก instance + composer ids ไม่ชน + strictReady=true', async () => {
  const dna = {
    template: {
      slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 60, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 60, yPct: 0, wPct: 40, hPct: 100 },
        { role: 'moment', shape: 'circle', xPct: 5, yPct: 60, wPct: 30, hPct: 24 },
        { role: 'moment', shape: 'circle', xPct: 62, yPct: 62, wPct: 30, hPct: 24 },
      ],
    },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');
  const { buildSelectionSpec } = await import('../src/lib/refSlotContract.js');
  const P = (cid) => ({ candidateId: cid, imageUrl: `https://cdn.test/${cid}.jpg`, backups: [] });
  const spec = buildSelectionSpec({
    contract,
    realizedTemplate: dnaToTemplateSpec(dna),
    plannedByRefSlot: { hero: P('h'), context: P('c'), moment: P('m1'), moment_2: P('m2') },
    refId: 'REF-SYN-2CIRCLES',
  });
  assert.deepEqual(spec.slots.map((s) => s.refSlotId), ['hero', 'context', 'moment', 'moment_2']);
  const circles = spec.slots.filter((s) => s.shape === 'circle');
  assert.deepEqual(circles.map((s) => s.primary.candidateId), ['m1', 'm2']);
  assert.equal(new Set(circles.map((s) => s.composerSlotId)).size, 2, 'สองวงต้องได้ composer id คนละตัว');
  assert.equal(spec.strictReady, true);
});

await test('SEM2-7 hero ไม่อยู่ sourceIndex แรก: คง ref order ทั้ง slotOrder/slotPlan — ห้าม force hero-first', async () => {
  await withEnv(true, async () => {
    const dna = {
      layoutType: 'ทดสอบ hero ไม่อยู่ช่องแรก', panelCount: 3,
      template: {
        slots: [
          { role: 'context', shape: 'rect', xPct: 0, yPct: 0, wPct: 45, hPct: 100 },
          { role: 'hero', shape: 'rect', xPct: 45, yPct: 0, wPct: 55, hPct: 100 },
          { role: 'moment', shape: 'circle', xPct: 8, yPct: 62, wPct: 30, hPct: 24 },
        ],
      },
    };
    const orders = [
      { i: 1, role: 'hero', want: 'ตัวเอก', personHint: 'ดวงเดือน' },
      { i: 2, role: 'moment', want: 'วงตัวเอก', personHint: 'ดวงเดือน' },
    ];
    const answer = {
      context: { id: 'P7', reason: 'x', backups: [] },
      hero: { id: 'P1', reason: 'x', backups: [] },
      moment: { id: 'P4', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna, orders, chars: CHARS_A, refId: 'REF-SYN-HERO-MID' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    const pi = s6.dossierPatch.pickImages;
    assert.deepEqual(pi.slotOrder, ['context', 'hero', 'moment'], 'slotOrder ต้องตาม sourceIndex — hero อยู่กลาง');
    assert.equal(pi.heroSlotId, 'hero');
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answer, captures }) });
    const plan = captures.payload.slotPlan;
    assert.deepEqual(plan.slice(0, 3).map((p) => p.refSlotId), ['context', 'hero', 'moment'], 'slotPlan ต้องคง ref order');
    assert.equal(plan[1].isHero, true, 'isHero ชี้ instance hero แม้ไม่ใช่ตัวแรก');
    assert.equal(plan[0].isHero, false);
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.equal(spec.strictReady, true);
  });
});

await test('SEM2-8 contract hash mismatch/missing: fail-closed — strictReady=false + ห้ามถอย legacy join', async () => {
  await withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    job.dossier.pickImages.slotContractHash = 'deadbeef'; // authority เก่า/ถูกแก้กลางทาง
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    assert.equal(s7.status, 'done', 'ท่อ shadow ต้องเดินต่อได้');
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.equal(spec.authorityStale, true);
    assert.equal(spec.strictReady, false);
    assert.equal(spec.mode, 'ref_slot_exact', 'ห้ามถอยไป legacy join');
    assert.equal(spec.counts.missingPrimary, 0, 'ข้อมูล join ยังเห็นครบ (fail-closed เฉพาะ strictReady)');
    // missing hash ก็ต้อง fail-closed เช่นกัน
    delete job.dossier.pickImages.slotContractHash;
    const s7b = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    assert.equal(s7b.dossierPatch.cover.selectionSpec.strictReady, false);
  });
});

await test('SEM2-9 (P1 blocker): extraPlannedKeys ต้อง fail-closed ด้วยเหตุ extra "เท่านั้น" — clean twin ready=true, deterministic', async () => {
  const { buildSelectionSpec } = await import('../src/lib/refSlotContract.js');
  const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');
  // ★ audit A: fixture เดิม (1 ช่อง + realized:null) false อยู่แล้วเพราะ mapped=0 = พิสูจน์ guard ไม่ได้จริง
  //   ใหม่: realized map ได้จริงครบ + refId จริง — ก่อน assert false ต้องพิสูจน์ว่าทุกมิติอื่น "สะอาด"
  const dna = {
    template: {
      slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
        { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
      ],
    },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const realized = dnaToTemplateSpec(dna);
  const P = (cid) => ({ candidateId: cid, imageUrl: `https://cdn.test/${cid}.jpg`, backups: [] });
  const cleanPlanned = { hero: P('H1'), context: P('C1'), moment: P('M1') };
  const build = (planned) => buildSelectionSpec({ contract, realizedTemplate: realized, plannedByRefSlot: planned, refId: 'REF-SYN-EXTRA' });
  // clean twin: input เดียวกันแต่ไม่มี stale → ต้อง ready จริง (พิสูจน์ว่าเงื่อนไขอื่นครบหมด)
  const clean = build(cleanPlanned);
  assert.equal(clean.strictReady, true, 'clean twin ต้อง ready — ไม่งั้นเทสนี้พิสูจน์ guard ไม่ได้');
  // extra case: เพิ่ม stale key อย่างเดียว
  const spec = build({ ...cleanPlanned, stale: P('S1') });
  assert.equal(spec.counts.mapped, spec.counts.total);
  assert.equal(spec.counts.unmapped, 0);
  assert.equal(spec.counts.missingPrimary, 0);
  assert.equal(spec.counts.duplicatePrimary, 0);
  assert.equal(spec.counts.duplicatePrimaryUrl, 0);
  assert.equal(spec.diagnostics.invalidPrimary.length, 0);
  assert.deepEqual(spec.slots.find((s) => s.refSlotId === 'hero').primary, { candidateId: 'H1', imageUrl: 'https://cdn.test/H1.jpg' });
  assert.deepEqual(spec.diagnostics.extraPlannedKeys, ['stale']);
  assert.equal(spec.counts.semanticFallback, 0);
  assert.equal(spec.strictReady, false, 'ต้อง false ด้วยเหตุ extraPlannedKeys เท่านั้น');
  assert.equal(JSON.stringify(build({ ...cleanPlanned, stale: P('S1') })), JSON.stringify(spec), 'input เดิมต้อง deterministic');
});

await test('SEM2-10 (P2): primary URL alias ข้ามช่อง — id ต่าง URL เดียว = ไม่ ready · URL ต่างผ่านปกติ · id+URL ซ้ำไม่นับสองเด้ง', async () => {
  const { buildSelectionSpec } = await import('../src/lib/refSlotContract.js');
  const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');
  const dna = {
    template: {
      slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
        { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
      ],
    },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const realized = dnaToTemplateSpec(dna);
  const mk = (planned) => buildSelectionSpec({ contract, realizedTemplate: realized, plannedByRefSlot: planned, refId: 'x' });
  // เคส 1: candidateId A/B คนละตัว แต่ URL เดียวกัน → duplicatePrimaryUrl=1, duplicatePrimary=0, ไม่ ready
  const alias = mk({
    hero: { candidateId: 'A', imageUrl: 'https://cdn.test/SAME.jpg', backups: [] },
    context: { candidateId: 'B', imageUrl: 'https://cdn.test/SAME.jpg', backups: [] },
    moment: { candidateId: 'M', imageUrl: 'https://cdn.test/M.jpg', backups: [] },
  });
  assert.equal(alias.counts.duplicatePrimary, 0, 'id ไม่ซ้ำ — ห้ามนับใน duplicatePrimary');
  assert.equal(alias.counts.duplicatePrimaryUrl, 1);
  assert.deepEqual(alias.diagnostics.aliasPrimaryUrls, [{ imageUrl: 'https://cdn.test/SAME.jpg', candidateIds: ['A', 'B'] }]);
  assert.equal(alias.strictReady, false);
  // เคส 2: URL ต่างกันครบ → ready ตามปกติ
  const clean = mk({
    hero: { candidateId: 'A', imageUrl: 'https://cdn.test/A.jpg', backups: [] },
    context: { candidateId: 'B', imageUrl: 'https://cdn.test/B.jpg', backups: [] },
    moment: { candidateId: 'M', imageUrl: 'https://cdn.test/M.jpg', backups: [] },
  });
  assert.equal(clean.strictReady, true);
  assert.equal(clean.counts.duplicatePrimaryUrl, 0);
  // เคส 3: ทั้ง id และ URL ซ้ำคู่เดียวกัน → นับเฉพาะ duplicatePrimary (ห้ามนับ URL ซ้ำเด้งที่สอง)
  const both = mk({
    hero: { candidateId: 'X', imageUrl: 'https://cdn.test/X.jpg', backups: [] },
    context: { candidateId: 'X', imageUrl: 'https://cdn.test/X.jpg', backups: [] },
    moment: { candidateId: 'M', imageUrl: 'https://cdn.test/M.jpg', backups: [] },
  });
  assert.equal(both.counts.duplicatePrimary, 1);
  assert.equal(both.counts.duplicatePrimaryUrl, 0, 'id เดียวกัน = นับที่ duplicatePrimary ที่เดียว');
  assert.equal(both.strictReady, false);
});

await test('SEM2-11 (audit B): exact ไร้ ref identity — mapping ครบทุกอย่างแต่ strictReady=false · twin refId valid = true', async () => {
  const { buildSelectionSpec } = await import('../src/lib/refSlotContract.js');
  const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');
  const dna = {
    template: {
      slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
        { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
      ],
    },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const realized = dnaToTemplateSpec(dna);
  const P = (cid) => ({ candidateId: cid, imageUrl: `https://cdn.test/${cid}.jpg`, backups: [] });
  const planned = { hero: P('H'), context: P('C'), moment: P('M') };
  for (const badRefId of [null, '', '   ']) {
    const spec = buildSelectionSpec({ contract, realizedTemplate: realized, plannedByRefSlot: planned, refId: badRefId });
    assert.equal(spec.counts.missingPrimary, 0);
    assert.equal(spec.counts.mapped, spec.counts.total);
    assert.equal(spec.diagnostics.missingRefId, true, `refId=${JSON.stringify(badRefId)} ต้องถูกฟ้อง`);
    assert.equal(spec.strictReady, false, `refId=${JSON.stringify(badRefId)} ต้องไม่ ready`);
  }
  const ok = buildSelectionSpec({ contract, realizedTemplate: realized, plannedByRefSlot: planned, refId: 'REF-SYN-ID' });
  assert.ok(!('missingRefId' in ok.diagnostics));
  assert.equal(ok.strictReady, true, 'twin refId valid ต้อง ready');
});

await test('SEM2-12 (audit C): semantic dossier เสีย — fail-closed ก่อน fetch/enqueue ห้ามไหลกลับ legacy', async () => {
  await withEnv(true, async () => {
    // เตรียมแฟ้ม semantic สมบูรณ์หนึ่งชุด
    const mk = async () => {
      const captures = { brainArgs: [], fetches: [], payload: null };
      const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
      const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
      Object.assign(job.dossier, s6.dossierPatch);
      return job;
    };
    // เคส 1: marker=true แต่ slotOrder หาย
    const j1 = await mk();
    delete j1.dossier.pickImages.slotOrder;
    const cap1 = { brainArgs: [], fetches: [], payload: null };
    const r1 = await s7_cover(j1, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap1 }) });
    assert.equal(r1.status, 'waiting');
    assert.equal(cap1.fetches.length, 0, 'ห้ามแตะ network');
    assert.equal(cap1.payload, null, 'ห้าม enqueue');
    // เคส 2: marker หาย แต่ signal อื่นยังอยู่ (slotContractHash + slots entry มี refSlotId)
    const j2 = await mk();
    delete j2.dossier.pickImages.semanticSelection;
    const cap2 = { brainArgs: [], fetches: [], payload: null };
    const r2 = await s7_cover(j2, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap2 }) });
    assert.equal(r2.status, 'waiting', 'signal ค้าง (hash/refSlotId) แต่ carrier ไม่ valid = ต้องพัก');
    assert.equal(cap2.fetches.length, 0);
    assert.equal(cap2.payload, null);
    // เคส 3 (คงพฤติกรรม SEM2-8): hash หายแต่ carrier ครบ → เดินต่อ + spec stale
    const j3 = await mk();
    delete j3.dossier.pickImages.slotContractHash;
    const cap3 = { brainArgs: [], fetches: [], payload: null };
    const r3 = await s7_cover(j3, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap3 }) });
    assert.equal(r3.status, 'done', 'carrier ครบ = shadow เดินต่อ');
    assert.equal(r3.dossierPatch.cover.selectionSpec.authorityStale, true);
    assert.equal(r3.dossierPatch.cover.selectionSpec.strictReady, false);
  });
});

await test('SEM2-13 (audit E): backup ชน primary (id หรือ URL) ถูก drop พร้อม reason — primary ถูกต้อง strictReady ยัง true ได้', async () => {
  const { buildSelectionSpec } = await import('../src/lib/refSlotContract.js');
  const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');
  const dna = {
    template: {
      slots: [
        { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
        { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
        { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
      ],
    },
  };
  const contract = buildRefSlotContract({ refDNA: dna });
  const realized = dnaToTemplateSpec(dna);
  const build = () => buildSelectionSpec({
    contract,
    realizedTemplate: realized,
    plannedByRefSlot: {
      hero: {
        candidateId: 'H', imageUrl: 'https://cdn.test/H.jpg',
        backups: [
          { candidateId: 'B1', imageUrl: 'https://cdn.test/C.jpg' }, // URL ชน primary ของ context (ข้ามช่อง)
          { candidateId: 'C', imageUrl: 'https://cdn.test/B2.jpg' }, // id ชน primary ของ context
          { candidateId: 'B3', imageUrl: 'https://cdn.test/B3.jpg' }, // สะอาด — ต้องรอด
        ],
      },
      context: { candidateId: 'C', imageUrl: 'https://cdn.test/C.jpg', backups: [] },
      moment: { candidateId: 'M', imageUrl: 'https://cdn.test/M.jpg', backups: [] },
    },
    refId: 'REF-SYN-BKCOLLIDE',
  });
  const spec = build();
  const hero = spec.slots.find((s) => s.refSlotId === 'hero');
  assert.deepEqual(hero.backups.map((b) => b.candidateId), ['B3'], 'backup ที่ชน primary ต้องหายหมด เหลือตัวสะอาด');
  const reasons = spec.diagnostics.duplicateBackupsDropped.map((x) => `${x.candidateId}:${x.reason}`).sort();
  assert.deepEqual(reasons, ['B1:collides_primary', 'C:collides_primary']);
  assert.equal(spec.strictReady, true, 'primary ทุกช่องถูกต้อง — drop backup ไม่ทำให้ตก ready');
  const again = build();
  assert.equal(again.specHash, spec.specHash);
  assert.equal(again.backupPoolHash, spec.backupPoolHash);
  assert.equal(again.replayHash, spec.replayHash);
  assert.equal(JSON.stringify(again), JSON.stringify(spec), 'deterministic');
});

await test('SEM2-14 (P1-1): เหลือแค่ property slotOrder ก็ต้องนับเป็น semantic signal — fail-closed ห้ามตก legacy', async () => {
  await withEnv(true, async () => {
    const mk = async () => {
      const captures = { brainArgs: [], fetches: [], payload: null };
      const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
      const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
      Object.assign(job.dossier, s6.dossierPatch);
      return job;
    };
    // เคสตามสเปก: ลบ marker/hash/heroSlotId แต่คง slotOrder + instance slots
    const j1 = await mk();
    delete j1.dossier.pickImages.semanticSelection;
    delete j1.dossier.pickImages.slotContractHash;
    delete j1.dossier.pickImages.heroSlotId;
    const cap1 = { brainArgs: [], fetches: [], payload: null };
    const r1 = await s7_cover(j1, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap1 }) });
    assert.equal(r1.status, 'waiting');
    assert.equal(cap1.fetches.length, 0);
    assert.equal(cap1.payload, null);
    // เคสโหดกว่า: ตัด refSlotId/legacySlot ใน entries ด้วย — เหลือ slotOrder เพียว (แม้ค่า null ก็ต้องจับ)
    const j2 = await mk();
    delete j2.dossier.pickImages.semanticSelection;
    delete j2.dossier.pickImages.slotContractHash;
    delete j2.dossier.pickImages.heroSlotId;
    for (const v of Object.values(j2.dossier.pickImages.slots)) { if (v) { delete v.refSlotId; delete v.legacySlot; } }
    j2.dossier.pickImages.slotOrder = null; // malformed ก็ยังเป็น signal
    const cap2 = { brainArgs: [], fetches: [], payload: null };
    const r2 = await s7_cover(j2, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap2 }) });
    assert.equal(r2.status, 'waiting', 'slotOrder เพียว (แม้ null) ต้องพัก ไม่ตก legacy');
    assert.equal(cap2.fetches.length, 0);
    assert.equal(cap2.payload, null);
  });
});

await test('SEM2-15 (P1-2): heroSlotId ชี้ช่องที่เป็น null — carrier ไม่ valid ต้องพัก แม้ primary อื่นเหลือ ≥3', async () => {
  await withEnv(true, async () => {
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    job.dossier.pickImages.slots[job.dossier.pickImages.heroSlotId] = null; // hero หาย แต่ยังเหลือ 4 primary
    const cap = { brainArgs: [], fetches: [], payload: null };
    const r = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap }) });
    assert.equal(r.status, 'waiting', 'ปกไร้ hero ห้าม enqueue');
    assert.equal(cap.fetches.length, 0);
    assert.equal(cap.payload, null);
    // clean carrier เดิม (ไม่ tamper) ต้องเดินต่อ — กันเทสหลอก
    const job2 = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
    const s6b = await s6_slots(job2, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
    Object.assign(job2.dossier, s6b.dossierPatch);
    const cap2 = { brainArgs: [], fetches: [], payload: null };
    const r2 = await s7_cover(job2, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures: cap2 }) });
    assert.equal(r2.status, 'done');
    assert.ok(cap2.payload);
  });
});

await test('SEM2-16 (P1-3): authority hash ผูก ref identity — เปลี่ยน refId อย่างเดียว = stale/ไม่ ready · twin เดิม ready', async () => {
  await withEnv(true, async () => {
    const run = async (tamper) => {
      const captures = { brainArgs: [], fetches: [], payload: null };
      const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
      const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
      Object.assign(job.dossier, s6.dossierPatch);
      if (tamper) job.dossier.refMatch.refId = 'REF-TAMPERED'; // DNA/slotPlan ไม่เปลี่ยน — เปลี่ยน identity เท่านั้น
      const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }) });
      return s7.dossierPatch.cover.selectionSpec;
    };
    const tampered = await run(true);
    assert.equal(tampered.mode, 'ref_slot_exact', 'exact spec ยังถูกสร้าง');
    assert.equal(tampered.authorityStale, true);
    assert.equal(tampered.strictReady, false);
    assert.equal(tampered.counts.semanticFallback, 0);
    const clean = await run(false);
    assert.equal(clean.authorityStale ?? false, false);
    assert.equal(clean.strictReady, true, 'twin refId เดิมต้อง ready');
    // refId ต้องอยู่ใน specHash (identity ต่าง → hash ต่าง) + deterministic
    assert.notEqual(tampered.specHash, clean.specHash, 'refId เป็นส่วนหนึ่งของ specHash — ห้ามถอด');
    const clean2 = await run(false);
    assert.equal(clean2.specHash, clean.specHash, 'hash ต้อง deterministic');
  });
});

await test('SEM2-17 (P1-4): ด่านขั้นต่ำต้องนับ URL จริง — 3 primary คนละ id ไฟล์เดียวกัน = failed ไม่ fetch/enqueue · twin 3 ไฟล์จริงเดินต่อ', async () => {
  await withEnv(true, async () => {
    const dna = {
      layoutType: 'ทดสอบ alias ทั้งแผน', panelCount: 3,
      template: {
        slots: [
          { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 55, hPct: 100 },
          { role: 'context', shape: 'rect', xPct: 55, yPct: 0, wPct: 45, hPct: 100 },
          { role: 'moment', shape: 'circle', xPct: 8, yPct: 60, wPct: 30, hPct: 24 },
        ],
      },
    };
    const same = 'https://cdn.test/SAMEFILE.jpg';
    const pool = [
      IMG('S1', { person: 'ดวงเดือน', category: 'face-emotional' }, { imageUrl: same }),
      IMG('S2', { person: null, faceCount: 0, category: 'context', note: 'ภาพเดียวกันจากคนละแหล่งชุดที่สองในคลังทดสอบ' }, { imageUrl: same }),
      IMG('S3', { person: 'ดวงเดือน', category: 'face-neutral' }, { imageUrl: same }),
    ];
    const orders = [
      { i: 0, role: 'hero', want: 'ตัวเอก', personHint: 'ดวงเดือน' },
      { i: 2, role: 'moment', want: 'วงตัวเอก', personHint: 'ดวงเดือน' },
    ];
    const answer = {
      hero: { id: 'S1', reason: 'x', backups: [] },
      context: { id: 'S2', reason: 'x', backups: [] },
      moment: { id: 'S3', reason: 'x', backups: [] },
    };
    const captures = { brainArgs: [], fetches: [], payload: null };
    const job = mkJob({ dna, orders, chars: CHARS_A, refId: 'REF-SYN-SAMEFILE' });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    const cap = { brainArgs: [], fetches: [], payload: null };
    const r = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures: cap }) });
    assert.equal(r.status, 'failed', 'raw 3 แต่ไฟล์จริง 1 = ต้อง fail-closed');
    assert.ok(/unique 1\/3/.test(r.summary), `summary ต้องรายงาน unique ไม่พอ (ได้: ${r.summary})`);
    assert.equal(cap.fetches.length, 0, 'ห้ามแตะ network');
    assert.equal(cap.payload, null, 'ห้าม enqueue');
    // clean twin: 3 ไฟล์จริงต่างกัน → เดินต่อ enqueue ปกติ
    const pool2 = [
      IMG('T1', { person: 'ดวงเดือน', category: 'face-emotional' }),
      IMG('T2', { person: null, faceCount: 0, category: 'context', note: 'ภาพบริบทไฟล์ที่สองของชุดทดสอบต่างไฟล์ชัดเจน' }),
      IMG('T3', { person: 'ดวงเดือน', category: 'face-neutral' }),
    ];
    const answer2 = { hero: { id: 'T1', reason: 'x', backups: [] }, context: { id: 'T2', reason: 'x', backups: [] }, moment: { id: 'T3', reason: 'x', backups: [] } };
    const job2 = mkJob({ dna, orders, chars: CHARS_A, refId: 'REF-SYN-SAMEFILE' });
    const s6b = await s6_slots(job2, { origin: 'http://mock', _deps: mkDeps({ pool: pool2, brainAnswer: answer2, captures }) });
    Object.assign(job2.dossier, s6b.dossierPatch);
    const cap2 = { brainArgs: [], fetches: [], payload: null };
    const r2 = await s7_cover(job2, { origin: 'http://mock', _deps: mkDeps({ pool: pool2, brainAnswer: answer2, captures: cap2 }) });
    assert.equal(r2.status, 'done');
    assert.ok(cap2.payload);
    // alias บางช่องแต่ unique ≥3 → ยังเดินต่อ (batch boundary: แก้เฉพาะด่านเลขหลอก) และ spec ฟ้องผ่าน strictReady=false
    const pool3 = [
      ...POOL_A,
      IMG('AL1', { person: null, faceCount: 0, category: 'context', note: 'ไฟล์ซ้ำสำหรับช่อง moment ในเทส alias บางช่อง' }, { imageUrl: 'https://cdn.test/P7.jpg' }),
    ];
    const answer3 = { ...ANSWER_ALPO, moment: { id: 'AL1', reason: 'x', backups: [] } }; // moment ใช้ไฟล์เดียวกับ context(P7)
    const job3 = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: 'REF-mrbqalpo-h1r1' });
    const s6c = await s6_slots(job3, { origin: 'http://mock', _deps: mkDeps({ pool: pool3, brainAnswer: answer3, captures }) });
    Object.assign(job3.dossier, s6c.dossierPatch);
    const cap3 = { brainArgs: [], fetches: [], payload: null };
    const r3 = await s7_cover(job3, { origin: 'http://mock', _deps: mkDeps({ pool: pool3, brainAnswer: answer3, captures: cap3 }) });
    assert.equal(r3.status, 'done', 'unique ≥3 = เดินต่อ (shadow)');
    const sp3 = r3.dossierPatch.cover.selectionSpec;
    assert.equal(sp3.strictReady, false, 'alias ข้ามช่องยังถูกฟ้องผ่าน spec');
    // กลไกจริงของ integration: URL-dedupe ที่ allLinks ตัด row ไฟล์ซ้ำ → instance ที่ชนหายจาก slotPlan
    // → spec ฟ้องเป็น missingPrimary (ด่าน duplicatePrimaryUrl เป็นการ์ดชั้น builder ตรง — คุมแล้วใน SEM2-10)
    assert.ok(sp3.counts.missingPrimary >= 1, `instance ที่ไฟล์ชนต้องโผล่เป็น missing (counts=${JSON.stringify(sp3.counts)})`);
  });
});

console.log(`1..${passed}`);

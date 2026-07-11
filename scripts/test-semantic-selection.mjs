// ============================================================
// 🧬 SEM-1 harness — semantic-selection adapter-level tests (ไม่ยิง LLM/network จริง)
// ------------------------------------------------------------
// - alias loader แบบ data:URL (ไม่มีไฟล์ loader แยก — คุมเพดาน 3 ไฟล์/batch)
// - '@/lib/aiClient' ถูก stub ให้ throw เสมอ = การันตีว่าไม่มีการยิง LLM จากทุกเส้นทาง
// - brain/fetch ฉีดผ่าน _deps (design v2 ช่องโหว่ 4) · dossier fixture จาก ref จริงในคลัง
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
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
delete process.env.MEGA_STRICT_PRODUCER; // ★ Checkpoint C: เริ่มเทสด้วย strict switches สะอาดเสมอ
delete process.env.MEGA_STRICT_RENDER;
delete process.env.MEGA_REF_SHOT_AUTHORITY; // ★ D3-B2: เริ่มด้วยสวิตช์ ref-shot สะอาด

const { s6_slots, s7_cover } = await import('../src/lib/megaAdapters.js');
const { slotDirectorBrain, artBriefBrain, templateV1PersonAuthority } = await import('../src/lib/megaBrains.js');
const { buildRefSlotContract, validateStrictRenderActivation, resolveRefSlotView } = await import('../src/lib/refSlotContract.js');

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
      captures.rawBody = opts.body; // ★ Checkpoint C: เก็บ body ดิบไว้เทียบ byte-parity (JSON.parse ซ่อน key order ไม่ได้)
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

// ═══════════ 🔐 Checkpoint C — S7 STRICT PRODUCER WIRING (11 ก.ค.) ═══════════
// กุญแจสองชั้น: _sem+_semEnvOn (semantic จริง) + MEGA_STRICT_PRODUCER=1 + MEGA_STRICT_RENDER=1
// OFF ทุกรูปแบบ = payload เดิม byte-identical · ON = แนบคู่ selectionSpec+realizedTemplate หลัง validator ไฟเขียว

const STRICT_KEYS = ['MEGA_SEMANTIC_SELECTION', 'MEGA_SELECTION_SPEC', 'MEGA_STRICT_PRODUCER', 'MEGA_STRICT_RENDER', 'MEGA_REF_SHOT_AUTHORITY'];
// snapshot/restore env แบบ exact prior value (undefined = ลบคืน) — finally เสมอ ห้ามรั่วข้ามเทส
const withStrictEnv = async (states, fn) => {
  const prior = STRICT_KEYS.map((k) => [k, process.env[k]]);
  try {
    for (const k of STRICT_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(states || {})) { if (v !== undefined) process.env[k] = v; }
    return await fn();
  } finally {
    for (const [k, v] of prior) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
const SEM_ON = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1' };
const ALL_ON = { ...SEM_ON, MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1' };
const REF_ID_C = 'REF-mrbqalpo-h1r1';
// flow มาตรฐาน: s6 ใต้ semantic ON → merge dossier → s7 ใต้ env ที่กำหนด — fresh job/deps ทุก call
const runStrictFlow = async ({ s7Env = SEM_ON, deps = null, mutateAfterS6 = null } = {}) => {
  const captures = { brainArgs: [], fetches: [], payload: null, rawBody: null };
  const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: REF_ID_C });
  const mk = () => ({ ...mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }), ...(deps || {}) });
  const s6 = await withStrictEnv(SEM_ON, () => s6_slots(job, { origin: 'http://mock', _deps: mk() }));
  assert.equal(s6.status, 'done', `s6 ต้องผ่าน: ${s6.summary}`);
  Object.assign(job.dossier, s6.dossierPatch);
  if (mutateAfterS6) mutateAfterS6(job);
  const s7 = await withStrictEnv(s7Env, () => s7_cover(job, { origin: 'http://mock', _deps: mk() }));
  const queueCalls = captures.fetches.filter((u) => String(u).includes('/api/queue/add')).length;
  return { job, s6, s7, captures, queueCalls };
};

const { dnaToTemplateSpec } = await import('../src/lib/refTemplate.js');

await test('C0 withStrictEnv คืน env exact ทั้ง 4 key: ปกติ / nested / throw', async () => {
  const outer = STRICT_KEYS.map((k) => [k, process.env[k]]);
  try {
    // sentinel หลากชนิด: มีค่า/ไม่มี/string ว่าง — ต้องคืน exact ทุกแบบ
    process.env.MEGA_SEMANTIC_SELECTION = 'sent-a';
    delete process.env.MEGA_SELECTION_SPEC;
    process.env.MEGA_STRICT_PRODUCER = 'sent-c';
    process.env.MEGA_STRICT_RENDER = '';
    const snap = () => STRICT_KEYS.map((k) => [k, process.env[k]]);
    const before = snap();
    await withStrictEnv(ALL_ON, async () => {
      assert.equal(process.env.MEGA_STRICT_PRODUCER, '1');
      await withStrictEnv({ MEGA_STRICT_RENDER: '1' }, async () => {
        assert.equal(process.env.MEGA_STRICT_PRODUCER, undefined, 'nested ล้างก่อนตั้ง');
      });
      assert.equal(process.env.MEGA_STRICT_PRODUCER, '1', 'nested คืนค่าชั้นนอกของมัน');
    });
    assert.deepStrictEqual(snap(), before, 'เส้นปกติ: คืน exact');
    await assert.rejects(withStrictEnv(ALL_ON, async () => { throw new Error('boom'); }), /boom/);
    assert.deepStrictEqual(snap(), before, 'เส้น throw: finally ต้องคืน exact เหมือนกัน');
  } finally {
    for (const [k, v] of outer) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ── golden payload: สร้าง "explicit จาก fixture" ล้วน (POOL_A/ANSWER_ALPO/DNA_ALPO) — ห้าม copy จาก captures ──
//   key order ทุกชั้นตามสัญญา producer เป๊ะ → เทียบ rawBody ด้วย JSON.stringify(golden) ได้ตรงตัว
const GROW = (id, { slot, refSlotId, backupForRefSlotId, isHero = false }) => {
  const img = POOL_A.find((p) => p.id === id);
  const t = img.triage;
  assert.ok(t.note.length <= 64 && !/\s\s/.test(t.note), `fixture note ${id} ต้องสั้น/normalized แล้ว (golden ไม่จำลอง slice)`);
  return {
    url: img.imageUrl,
    slot,
    ...(refSlotId ? { refSlotId } : {}),
    ...(backupForRefSlotId ? { backupForRefSlotId } : {}),
    clean: true,
    newsScene: true,
    faces: t.faceCount,
    dirtyFallback: false,
    isHero,
    thumbnailUrl: '',
    person: t.person,
    category: t.category,
    emotion: t.emotion,
    note: t.note,
    faceBox: null,
    peopleBox: null,
  };
};
const goldenSemanticPayload = () => ({
  jobType: 'cover',
  composer: 'mega',
  newsTitle: 'ข่าวทดสอบ SEM-1',
  slotPlan: [
    GROW('P1', { slot: 'hero', refSlotId: 'hero', isHero: true }),
    GROW('P7', { slot: 'context', refSlotId: 'context' }),
    GROW('P2', { slot: 'action', refSlotId: 'action' }),
    GROW('P8', { slot: 'reaction', refSlotId: 'moment' }),
    GROW('P5', { slot: 'circle', refSlotId: 'reaction' }),
    GROW('P4', { slot: 'hero', backupForRefSlotId: 'hero' }),
    GROW('P6', { slot: 'circle', backupForRefSlotId: 'reaction' }),
  ],
  userId: 'mega-bot',
  refDNA: DNA_ALPO,
  refImagePath: '/ref-covers/test.jpg',
});
const GOLDEN_RAW = () => JSON.stringify(goldenSemanticPayload());

await test('C1 producer OFF golden: shadow states ทุกแบบ → rawBody = golden byte-identical (key order ด้วย) · queue=1 · shadow dossier อยู่', async () => {
  const golden = GOLDEN_RAW();
  // states ที่ต้องเป็น shadow เดิม: ไม่มี strict switch / RENDER อย่างเดียว / PRODUCER ปิด-junk คู่ RENDER
  const states = [
    SEM_ON,
    { ...SEM_ON, MEGA_STRICT_RENDER: '1' },                               // โรงพร้อมแต่ยังไม่ส่ง = shadow
    { ...SEM_ON, MEGA_STRICT_PRODUCER: '0', MEGA_STRICT_RENDER: '1' },
    { ...SEM_ON, MEGA_STRICT_PRODUCER: 'junk', MEGA_STRICT_RENDER: '1' },
  ];
  for (const st of states) {
    const r = await runStrictFlow({ s7Env: st });
    assert.equal(r.s7.status, 'done', JSON.stringify(st));
    assert.equal(r.queueCalls, 1, JSON.stringify(st));
    assert.equal(r.captures.rawBody, golden, `rawBody ต้องเท่ากับ golden explicit (${JSON.stringify(st)})`);
    assert.ok(!Object.prototype.hasOwnProperty.call(r.captures.payload, 'selectionSpec'), JSON.stringify(st));
    assert.ok(!Object.prototype.hasOwnProperty.call(r.captures.payload, 'realizedTemplate'), JSON.stringify(st));
    assert.ok(r.s7.dossierPatch.cover.selectionSpec, 'shadow spec ใน dossier ต้องยังอยู่');
  }
});

await test('C2 producer เปิดแต่ render ไม่ armed (unset/0/junk): waiting strict_render_not_armed · queue=0 · payload/raw null', async () => {
  for (const rend of [undefined, '0', 'junk']) {
    const st = { ...SEM_ON, MEGA_STRICT_PRODUCER: '1', ...(rend !== undefined ? { MEGA_STRICT_RENDER: rend } : {}) };
    const r = await runStrictFlow({ s7Env: st });
    assert.equal(r.s7.status, 'waiting', JSON.stringify(st));
    assert.equal(r.s7.nextAction, 'wait');
    assert.ok(r.s7.summary.includes('strict_render_not_armed'), r.s7.summary);
    assert.equal(r.queueCalls, 0, 'ห้ามส่งงาน strict เข้าโรง legacy');
    assert.equal(r.captures.payload, null);
    assert.equal(r.captures.rawBody, null);
  }
});

await test('C3 producer ON happy: own คู่ท้าย payload · realized deepStrictEqual builder จริง · ตัด 2 key แล้วเท่า golden · validator+binding exact', async () => {
  const r = await runStrictFlow({ s7Env: ALL_ON });
  assert.equal(r.s7.status, 'done', r.s7.summary);
  assert.equal(r.queueCalls, 1);
  const p = r.captures.payload;
  assert.ok(Object.prototype.hasOwnProperty.call(p, 'selectionSpec'), 'ต้องมี own selectionSpec');
  assert.ok(Object.prototype.hasOwnProperty.call(p, 'realizedTemplate'), 'ต้องมี own realizedTemplate (both-or-neither)');
  assert.deepEqual(Object.keys(p).slice(-2), ['selectionSpec', 'realizedTemplate'], 'strict keys ต้อง append ท้ายสุด');
  assert.deepEqual(p.selectionSpec, r.s7.dossierPatch.cover.selectionSpec, 'payload spec ต้องเท่ากับ dossier spec');
  assert.equal(p.selectionSpec.strictReady, true);
  // realized ทั้งก้อนต้องเท่ากับผล builder จริงจาก DNA fixture เป๊ะ — expected ห้ามผ่าน JSON-normalize
  // (structuredClone รักษา undefined/-0/NaN ตามจริง — ถ้า builder มีค่าพวกนั้น wire จะไม่เท่าและต้องพังให้เห็น)
  assert.deepStrictEqual(p.realizedTemplate, structuredClone(dnaToTemplateSpec(DNA_ALPO)), 'realizedTemplate = dnaToTemplateSpec(DNA_ALPO)');
  // ตัดแค่ 2 strict keys → payload ที่เหลือต้องเท่า golden ทุก byte (พิสูจน์ non-strict ไม่ถูกแตะ)
  const minus = JSON.parse(r.captures.rawBody);
  delete minus.selectionSpec;
  delete minus.realizedTemplate;
  assert.equal(JSON.stringify(minus), GOLDEN_RAW(), 'payload ส่วน non-strict ต้องเท่า golden byte-identical');
  const decision = validateStrictRenderActivation({ selectionSpec: p.selectionSpec, realizedTemplate: p.realizedTemplate });
  assert.equal(decision.decision, 'strict_ready', `validator ต้องไฟเขียว (ได้: ${(decision.reasons || []).join(',')})`);
  assert.equal(p.realizedTemplate.canvasW, 1080);
  assert.equal(p.realizedTemplate.canvasH, 1350);
  assert.deepEqual(
    p.realizedTemplate.slots.map((s) => String(s.id)).sort(),
    p.selectionSpec.slots.map((s) => s.composerSlotId).sort(),
    'realized slot ids = composerSlotId set เป๊ะ'
  );
  for (const cs of p.selectionSpec.slots) {
    const rows = p.slotPlan.filter((row) => row.url === cs.primary.imageUrl);
    assert.equal(rows.length, 1, `primary ของ ${cs.refSlotId} ต้อง bind slotPlan หนึ่งต่อหนึ่ง (URL exact)`);
    assert.equal(rows[0].refSlotId, cs.refSlotId, `refSlotId row ต้องตรง authority (${cs.refSlotId})`);
  }
});

await test('C4 producer deterministic: fresh run 2 รอบ → rawBody byte เท่ากัน · done+queue1 · dossier ตรง (scrub เฉพาะ enqueuedAt)', async () => {
  const a = await runStrictFlow({ s7Env: ALL_ON });
  const b = await runStrictFlow({ s7Env: ALL_ON });
  assert.equal(a.s7.status, 'done');
  assert.equal(b.s7.status, 'done');
  assert.equal(a.queueCalls, 1);
  assert.equal(b.queueCalls, 1);
  assert.equal(a.captures.rawBody, b.captures.rawBody, 'rawBody ต้อง byte-identical');
  assert.deepStrictEqual(a.captures.payload, b.captures.payload, 'queue payload (spec/template/slotPlan/refDNA) ต้องเท่ากันเป๊ะ');
  const scrub = (dp) => { const c = structuredClone(dp); delete c.cover.enqueuedAt; return c; };
  assert.deepStrictEqual(scrub(a.s7.dossierPatch), scrub(b.s7.dossierPatch), 'dossier เท่ากันยกเว้น enqueuedAt (volatile ตัวเดียวที่ scrub)');
});

await test('C5 ordinary strictReady=false (authority สด — สองช่อง URL เดียว, unique≥3): OFF done stale!==true · ON waiting strict_ready_false queue0', async () => {
  const dupUrl = (job) => { job.dossier.pickImages.slots.action.imageUrl = job.dossier.pickImages.slots.context.imageUrl; };
  const off = await runStrictFlow({ s7Env: SEM_ON, mutateAfterS6: dupUrl });
  assert.equal(off.s7.status, 'done', off.s7.summary);
  assert.equal(off.queueCalls, 1);
  const shadowSpec = off.s7.dossierPatch.cover.selectionSpec;
  assert.equal(shadowSpec.strictReady, false, 'primary หาย/ซ้ำ = ไม่ ready');
  assert.notEqual(shadowSpec.authorityStale, true, 'authority ต้องยังสด — เคสนี้คือ not-ready ธรรมดา');
  const on = await runStrictFlow({ s7Env: ALL_ON, mutateAfterS6: dupUrl });
  assert.equal(on.s7.status, 'waiting', on.s7.summary);
  assert.ok(on.s7.summary.includes('strict_ready_false'), on.s7.summary);
  assert.equal(on.queueCalls, 0);
  assert.equal(on.captures.rawBody, null);
});

await test('C6 authority stale: OFF dossier spec authorityStale=true · ON waiting reason authority_stale · queue0', async () => {
  const tamper = (job) => { job.dossier.pickImages.slotContractHash = 'HACKED-HASH'; };
  const on = await runStrictFlow({ s7Env: ALL_ON, mutateAfterS6: tamper });
  assert.equal(on.s7.status, 'waiting', on.s7.summary);
  assert.equal(on.s7.nextAction, 'wait');
  assert.ok(on.s7.summary.includes('authority_stale'), on.s7.summary);
  assert.equal(on.queueCalls, 0, 'ห้ามแตะ queue');
  assert.equal(on.captures.payload, null);
  const off = await runStrictFlow({ s7Env: SEM_ON, mutateAfterS6: tamper });
  assert.equal(off.s7.status, 'done', 'OFF twin = shadow เดิม enqueue ปกติ');
  assert.equal(off.queueCalls, 1);
  assert.equal(off.s7.dossierPatch.cover.selectionSpec.strictReady, false, 'shadow spec fail-closed ใน dossier ตามเดิม');
  assert.equal(off.s7.dossierPatch.cover.selectionSpec.authorityStale, true, 'shadow ต้องบันทึกว่า stale จริง');
  assert.ok(!Object.prototype.hasOwnProperty.call(off.captures.payload, 'selectionSpec'));
});

await test('C7 builder null/throw: reason คงที่ strict_realized_template_missing / strict_carrier_build_failed (ห้ามพก TEMPLATE_BOOM) · queue0 · OFF twins เดิม', async () => {
  // null → reason เฉพาะของ producer ก่อนถึง validator
  const onNull = await runStrictFlow({ s7Env: ALL_ON, deps: { dnaToTemplateSpec: () => null } });
  assert.equal(onNull.s7.status, 'waiting', onNull.s7.summary);
  assert.equal(onNull.s7.nextAction, 'wait');
  assert.ok(onNull.s7.summary.includes('strict_realized_template_missing'), onNull.s7.summary);
  assert.equal(onNull.queueCalls, 0);
  assert.equal(onNull.captures.payload, null);
  assert.equal(onNull.captures.rawBody, null);
  // throw → failed/retry ด้วย reason คงที่ — summary ห้ามมีข้อความ exception (ลง log เท่านั้น)
  const onThrow = await runStrictFlow({ s7Env: ALL_ON, deps: { dnaToTemplateSpec: () => { throw new Error('TEMPLATE_BOOM'); } } });
  assert.equal(onThrow.s7.status, 'failed', onThrow.s7.summary);
  assert.equal(onThrow.s7.nextAction, 'retry');
  assert.ok(onThrow.s7.summary.includes('strict_carrier_build_failed'), onThrow.s7.summary);
  assert.ok(!onThrow.s7.summary.includes('TEMPLATE_BOOM'), 'summary ห้ามพกข้อความ exception');
  assert.equal(onThrow.queueCalls, 0);
  assert.equal(onThrow.captures.rawBody, null);
  // OFF twins: shadow behavior เดิม — enqueue ต่อ ไม่มี own strict fields
  const offNull = await runStrictFlow({ s7Env: SEM_ON, deps: { dnaToTemplateSpec: () => null } });
  assert.equal(offNull.s7.status, 'done');
  assert.equal(offNull.queueCalls, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(offNull.captures.payload, 'selectionSpec'));
  const offThrow = await runStrictFlow({ s7Env: SEM_ON, deps: { dnaToTemplateSpec: () => { throw new Error('TEMPLATE_BOOM'); } } });
  assert.equal(offThrow.s7.status, 'done', 'shadow catch เดิมกลืนเงียบ — งานเดินต่อ');
  assert.equal(offThrow.queueCalls, 1);
  assert.equal(offThrow.s7.dossierPatch.cover.selectionSpec, undefined, 'spec ล้ม = ไม่มี field ใน dossier (เดิม)');
});

await test('C8 builder เพี้ยน (canvas 1200 / noninteger / out-of-bounds): waiting strict_template_invalid · queue0 ทุกเคส', async () => {
  const mkBad = (mut) => (dna) => { const t = structuredClone(dnaToTemplateSpec(dna)); mut(t); return t; };
  const cases = [
    [mkBad((t) => { t.canvasW = 1200; }), 'canvas'],
    [mkBad((t) => { t.slots[0].x = 10.5; }), 'geom:0'],
    [mkBad((t) => { t.slots[0].w = (1080 - t.slots[0].x) + 1; }), 'bounds:0'],
  ];
  for (const [builder, hint] of cases) {
    const r = await runStrictFlow({ s7Env: ALL_ON, deps: { dnaToTemplateSpec: builder } });
    assert.equal(r.s7.status, 'waiting', `${hint}: ${r.s7.summary}`);
    assert.ok(r.s7.summary.includes('strict_template_invalid'), r.s7.summary);
    assert.ok(r.s7.summary.includes(hint), `ต้องบอกจุดพัง ${hint} (ได้: ${r.s7.summary})`);
    assert.equal(r.queueCalls, 0);
    assert.equal(r.captures.rawBody, null);
  }
});

await test('C9 โครง valid แต่คู่สัญญา serialize ไม่ได้ (cyclic/BigInt/toJSON-throw): failed/retry strict_payload_not_serializable · queue0 · ไม่ throw หลุด', async () => {
  const mkPoison = (mut) => (dna) => { const t = dnaToTemplateSpec(dna); mut(t); return t; };
  const cases = [
    ['cyclic', mkPoison((t) => { t._cyc = t; })],
    ['bigint', mkPoison((t) => { t._big = 10n; })],
    ['toJSON-throw', mkPoison((t) => { t._tj = { toJSON() { throw new Error('TOJSON_BOOM'); } }; })],
  ];
  for (const [name, builder] of cases) {
    const r = await runStrictFlow({ s7Env: ALL_ON, deps: { dnaToTemplateSpec: builder } });
    assert.equal(r.s7.status, 'failed', `${name}: ${r.s7.summary}`);
    assert.equal(r.s7.nextAction, 'retry');
    assert.ok(r.s7.summary.includes('strict_payload_not_serializable'), `${name}: ${r.s7.summary}`);
    assert.ok(!r.s7.summary.includes('TOJSON_BOOM'), 'summary ห้ามพกข้อความ exception');
    assert.equal(r.queueCalls, 0, `${name}: ห้ามแตะ queue`);
    assert.equal(r.captures.rawBody, null);
  }
});

await test('C10 legacy แท้: OFF ล้วน vs strict switches ล้วน (ไม่มี SEM/SPEC) → rawBody byte เท่ากัน + dossier ตรง (scrub enqueuedAt) · queue1 ทั้งคู่', async () => {
  const answerLegacy = {
    hero: { id: 'P1', reason: 'x', backups: ['P4'] },
    reaction: { id: 'P5', reason: 'x', backups: [] },
    action: { id: 'P2', reason: 'x', backups: [] },
    context: { id: 'P7', reason: 'x', backups: [] },
    circle: { id: 'P6', reason: 'x', backups: [] },
  };
  const runLegacy = async (s7Env) => {
    const captures = { brainArgs: [], fetches: [], payload: null, rawBody: null };
    const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A }); // legacy fixture: ไม่มี refId
    const mk = () => mkDeps({ pool: POOL_A, brainAnswer: answerLegacy, captures });
    const s6 = await withStrictEnv({}, () => s6_slots(job, { origin: 'http://mock', _deps: mk() }));
    assert.equal(s6.status, 'done', s6.summary);
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await withStrictEnv(s7Env, () => s7_cover(job, { origin: 'http://mock', _deps: mk() }));
    const queueCalls = captures.fetches.filter((u) => String(u).includes('/api/queue/add')).length;
    return { s7, captures, queueCalls };
  };
  const off = await runLegacy({});
  const strictOnly = await runLegacy({ MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1' });
  assert.equal(off.s7.status, 'done');
  assert.equal(strictOnly.s7.status, 'done', `legacy ต้องเดินเดิมแม้ strict switches เปิด: ${strictOnly.s7.summary}`);
  assert.equal(off.queueCalls, 1);
  assert.equal(strictOnly.queueCalls, 1);
  assert.equal(strictOnly.captures.rawBody, off.captures.rawBody, 'rawBody legacy ต้อง byte-identical');
  assert.deepStrictEqual(strictOnly.captures.payload, off.captures.payload, 'parsed payload เท่ากันเป๊ะ');
  const scrub = (dp) => { const c = structuredClone(dp); delete c.cover.enqueuedAt; return c; };
  assert.deepStrictEqual(scrub(strictOnly.s7.dossierPatch), scrub(off.s7.dossierPatch), 'dossier เท่ากัน (scrub เฉพาะ enqueuedAt)');
  assert.ok(!Object.prototype.hasOwnProperty.call(strictOnly.captures.payload, 'selectionSpec'));
  assert.ok(!Object.prototype.hasOwnProperty.call(strictOnly.captures.payload, 'realizedTemplate'));
});

await test('C12 stateful toJSON (TOCTOU): stringify ครั้งเดียว-ตรวจ-ส่งก้อนเดิม · wire เพี้ยนรอบแรก = reject ก่อน queue · throw รอบแรกยัง failed เดิม', async () => {
  // ① toJSON valid รอบแรก + ระเบิดถ้าโดนเรียกรอบสอง → done + queue1 + ถูกเรียกครั้งเดียว + body ที่ส่ง = ก้อนที่ตรวจแล้ว
  const onceBuilder = (dna) => {
    const t = dnaToTemplateSpec(dna);
    globalThis.__TOJSON_CALLS = 0;
    return {
      ...t,
      toJSON() {
        globalThis.__TOJSON_CALLS += 1;
        if (globalThis.__TOJSON_CALLS > 1) throw new Error('SECOND_CALL_BOOM');
        return t;
      },
    };
  };
  try {
    const r1 = await runStrictFlow({ s7Env: ALL_ON, deps: { dnaToTemplateSpec: onceBuilder } });
    assert.equal(r1.s7.status, 'done', r1.s7.summary);
    assert.equal(r1.queueCalls, 1);
    assert.equal(globalThis.__TOJSON_CALLS, 1, 'strict payload ต้องถูก stringify ครั้งเดียวเท่านั้น (รอบสอง = ระเบิด)');
    // body ที่ขึ้นสาย = wire ที่ validator เห็นจริง — พิสูจน์ซ้ำจากฝั่งเทส
    const wire = JSON.parse(r1.captures.rawBody);
    assert.deepStrictEqual(wire.realizedTemplate, structuredClone(dnaToTemplateSpec(DNA_ALPO)), 'wire realized = ค่านิ่งจาก toJSON รอบแรก');
    const d = validateStrictRenderActivation({ selectionSpec: wire.selectionSpec, realizedTemplate: wire.realizedTemplate });
    assert.equal(d.decision, 'strict_ready', 'body ที่ส่งต้องเป็นก้อนเดียวกับที่ validate ผ่าน');
  } finally { delete globalThis.__TOJSON_CALLS; }
  // ② toJSON รอบแรกคืนโครง canvas ผิด — จุด TOCTOU เดิม (ตรวจ object ผ่านแต่ wire เพี้ยน) ต้องโดนจับก่อน queue
  const badWireBuilder = (dna) => {
    const t = dnaToTemplateSpec(dna);
    const bad = structuredClone(t);
    bad.canvasW = 1200;
    return { ...t, toJSON() { return bad; } };
  };
  const r2 = await runStrictFlow({ s7Env: ALL_ON, deps: { dnaToTemplateSpec: badWireBuilder } });
  assert.equal(r2.s7.status, 'waiting', r2.s7.summary);
  assert.ok(r2.s7.summary.includes('strict_template_invalid'), r2.s7.summary);
  assert.ok(r2.s7.summary.includes('canvas'), r2.s7.summary);
  assert.equal(r2.queueCalls, 0, 'wire เพี้ยนห้ามถึง queue');
  assert.equal(r2.captures.rawBody, null);
  // ③ regression: throw ตั้งแต่ stringify รอบแรก → failed deterministic เดิม (คู่กับ C9)
  const r3 = await runStrictFlow({
    s7Env: ALL_ON,
    deps: { dnaToTemplateSpec: (dna) => { const t = dnaToTemplateSpec(dna); t._tj = { toJSON() { throw new Error('FIRST_BOOM'); } }; return t; } },
  });
  assert.equal(r3.s7.status, 'failed', r3.s7.summary);
  assert.ok(r3.s7.summary.includes('strict_payload_not_serializable'), r3.s7.summary);
  assert.ok(!r3.s7.summary.includes('FIRST_BOOM'), 'summary ห้ามพกข้อความ exception');
  assert.equal(r3.queueCalls, 0);
});

await test('C11 worker forward โปร่งใส (static guard เสริม — runtime proof อยู่ C1/C3): spread ...job.payload ทั้งก้อน', async () => {
  const src = fs.readFileSync(new URL('../src/app/api/queue/worker/route.js', import.meta.url), 'utf8');
  assert.ok(src.includes('JSON.stringify({ ...job.payload, _queueJobId: job.id })'), 'worker ต้อง forward payload ทั้งก้อนแบบ spread');
  assert.ok(!src.includes('selectionSpec'), 'worker ไม่รู้จัก/ไม่แตะ strict fields = transparent จริง');
});

// ═══════════ 🎯 D3-B2 — RUNTIME WIRING ของ REF-SHOT AUTHORITY (11 ก.ค.) ═══════════
// switch MEGA_REF_SHOT_AUTHORITY=1 + SEM/SPEC + strong ref = arm template_v1 · marker lifecycle + S7 gate
const REFSHOT_S6 = { MEGA_SEMANTIC_SELECTION: '1', MEGA_SELECTION_SPEC: '1', MEGA_REF_SHOT_AUTHORITY: '1' };
const REFSHOT_ALL = { ...REFSHOT_S6, MEGA_STRICT_PRODUCER: '1', MEGA_STRICT_RENDER: '1' };
// fake artBriefBrain: mirror ของจริง — template_v1 → orders(view)+marker แท้ (คำนวณจาก pure resolver) · legacy → ไม่มี marker
// ★ D3-B3: template_v1 fake ใช้ helper เดียวกับ brain จริง → personHint canonical (ไม่ null-fail guard) ·
//   legacy branch คงเดิม (personHint null) byte-exact
const artBriefFake = ({ refDNA, compass, mode }) => {
  if (mode === 'template_v1') {
    const c = buildRefSlotContract({ refDNA, mode: 'template_v1' });
    const view = resolveRefSlotView(refDNA, { mode: 'template_v1' });
    const auth = templateV1PersonAuthority(compass);
    return {
      storyNote: 'v1',
      orders: view.views.map((v) => ({ i: v.index, role: v.role, pos: v.pos || '', shot: v.shot || '', emotion: v.emotion || '', faceSizePct: v.faceSizePct || null, want: 'สั่ง', personHint: auth.resolveHint(v.role, null) })),
      refShotAuthority: { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: c.authority.effectiveViewHash },
    };
  }
  return { storyNote: 'legacy', orders: (refDNA?.slots || []).map((s, i) => ({ i, role: s.role, pos: s.pos || '', shot: s.shot || '', emotion: s.emotion || '', faceSizePct: Number(s.faceSizePct) || null, want: 'สั่ง', personHint: null })) };
};
const markedArtBrief = (chars = CHARS_A) => artBriefFake({ refDNA: DNA_ALPO, compass: { mainCharacters: chars }, mode: 'template_v1' });
// flow: s6 ใต้ s6Env → merge → s7 ใต้ s7Env · fresh (ลบ artBrief) หรือ preMark ได้ · inject artBriefFake
const runRefShotFlow = async ({ s6Env, s7Env = null, deleteArtBrief = true, preMarkArtBrief = null, prePickImages = undefined, deps = {}, s7Deps = null, mutateAfterS6 = null, mutateJob = null, dna = DNA_ALPO, chars = CHARS_A }) => {
  const captures = { brainArgs: [], fetches: [], payload: null, rawBody: null };
  const job = mkJob({ dna, orders: ORDERS_ALPO, chars, refId: REF_ID_C });
  if (deleteArtBrief) delete job.dossier.artBrief;
  if (preMarkArtBrief) job.dossier.artBrief = preMarkArtBrief;
  if (prePickImages !== undefined) job.dossier.pickImages = prePickImages;
  if (mutateJob) mutateJob(job); // ★ D3-B3.2: ฉีด getter/สภาพ job ก่อน s6 (เทส throwing compass/orders getter)
  const mk = (extra) => ({ ...mkDeps({ pool: POOL_A, brainAnswer: ANSWER_ALPO, captures }), artBriefBrain: artBriefFake, ...extra });
  const s6 = await withStrictEnv(s6Env, () => s6_slots(job, { origin: 'http://mock', _deps: mk(deps) }));
  if (s6.status === 'done') Object.assign(job.dossier, s6.dossierPatch);
  if (mutateAfterS6) mutateAfterS6(job);
  const s7 = (s7Env && s6.status === 'done') ? await withStrictEnv(s7Env, () => s7_cover(job, { origin: 'http://mock', _deps: mk(s7Deps || deps) })) : null;
  const queueCalls = captures.fetches.filter((u) => String(u).includes('/api/queue/add')).length;
  return { job, s6, s7, captures, queueCalls };
};

await test('D3B2-A OFF parity: refshot unset/0/junk → artBrief/pickImages/S7 rawBody เท่า baseline · ไม่มี marker', async () => {
  const base = await runRefShotFlow({ s6Env: SEM_ON, s7Env: SEM_ON });
  assert.equal(base.s6.status, 'done', base.s6.summary);
  assert.ok(!('refShotAuthority' in base.s6.dossierPatch.pickImages), 'baseline pickImages ห้ามมี marker');
  assert.ok(base.s7.status === 'done' && base.captures.rawBody, 'baseline S7 ต้อง enqueue');
  const basePick = JSON.stringify(base.s6.dossierPatch.pickImages);
  const baseBrief = JSON.stringify(base.job.dossier.artBrief);
  for (const rv of ['0', 'junk']) {
    const r = await runRefShotFlow({ s6Env: { ...SEM_ON, MEGA_REF_SHOT_AUTHORITY: rv }, s7Env: { ...SEM_ON, MEGA_REF_SHOT_AUTHORITY: rv } });
    assert.equal(r.s6.status, 'done', `refshot=${rv}`);
    assert.ok(!('refShotAuthority' in r.s6.dossierPatch.pickImages), `refshot=${rv}: ห้ามมี marker`);
    assert.equal(JSON.stringify(r.s6.dossierPatch.pickImages), basePick, `refshot=${rv}: pickImages เท่า baseline`);
    assert.equal(JSON.stringify(r.job.dossier.artBrief), baseBrief, `refshot=${rv}: artBrief เท่า baseline`);
    assert.equal(r.captures.rawBody, base.captures.rawBody, `refshot=${rv}: S7 rawBody byte เท่า baseline`);
    assert.ok(!Object.prototype.hasOwnProperty.call(r.captures.payload, 'refShotAuthority'), 'ไม่มี key ใหม่ใน queue');
  }
});

await test('D3B2-B ON fresh armed: marker แนบ artBrief+pickImages (deep equal) · hero template shot · S7 one queue ไม่มี key ใหม่', async () => {
  const r = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL });
  assert.equal(r.s6.status, 'done', r.s6.summary);
  const m = r.s6.dossierPatch.pickImages.refShotAuthority;
  assert.ok(m && m.v === 1 && m.mode === 'template_v1' && m.axis === 'template.slots' && /^[0-9a-f]{8}$/.test(m.effectiveViewHash), 'pickImages marker ถูก schema');
  assert.deepStrictEqual(r.job.dossier.artBrief.refShotAuthority, m, 'artBrief marker == pickImages echo (deep)');
  assert.ok(r.s6.dossierPatch.pickImages.slotContractHash, 'มี slotContractHash (whole-contract)');
  // hero template shot ชนะ dna medium (REF-mrbqalpo-h1r1) — ยืนยันผ่าน contract template_v1 จริง
  const heroContract = buildRefSlotContract({ refDNA: DNA_ALPO, mode: 'template_v1' });
  assert.equal(heroContract.slots.find((s) => s.refRole === 'hero').refShot, 'closeup', 'hero=closeup (template ชนะ)');
  assert.equal(heroContract.authority.effectiveViewHash, m.effectiveViewHash, 'marker hash == contract authority hash');
  // S7 armed → enqueue เดียว · payload มี strict pair · ไม่มี refShotAuthority key ใน queue
  assert.equal(r.s7.status, 'done', r.s7.summary);
  assert.equal(r.queueCalls, 1);
  assert.ok(Object.prototype.hasOwnProperty.call(r.captures.payload, 'selectionSpec'), 'strict spec ใน payload');
  assert.ok(!Object.prototype.hasOwnProperty.call(r.captures.payload, 'refShotAuthority'), 'ห้ามมี refShotAuthority key ใน queue payload');
  assert.ok(!r.captures.payload.slotPlan.some((p) => 'refShotAuthority' in p), 'slotPlan row ห้ามพก marker');
});

await test('D3B2-C existing unmarked artBrief + switch ON = legacy (ไม่ auto-upgrade, ไม่มี marker)', async () => {
  const r = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: null, deleteArtBrief: false });
  assert.equal(r.s6.status, 'done', r.s6.summary);
  assert.ok(!('refShotAuthority' in r.s6.dossierPatch.pickImages), 'unmarked artBrief ห้ามถูก upgrade เป็น marker');
  assert.ok(!r.job.dossier.artBrief.refShotAuthority, 'artBrief เดิม (unmarked) ต้องไม่ถูกเติม marker');
});

await test('D3B2-D ON→OFF: marked artBrief resume ใต้สวิตช์ปิด = HOLD · S7 marker+switch off = waiting queue0', async () => {
  // S6 resume ใต้ switch off
  const s6off = await runRefShotFlow({ s6Env: SEM_ON, preMarkArtBrief: markedArtBrief() });
  assert.equal(s6off.s6.status, 'waiting', 'marked + switch off = HOLD');
  assert.ok(s6off.s6.summary.includes('ref-shot authority'), s6off.s6.summary);
  // S7: job ที่ marked (ผ่าน S6 armed) แล้วรัน S7 ใต้ switch off
  const armed = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: SEM_ON });
  assert.equal(armed.s6.status, 'done');
  assert.equal(armed.s7.status, 'waiting', 'S7 marker + switch off = waiting');
  assert.equal(armed.queueCalls, 0, 'ห้ามแตะ queue');
});

await test('D3B2-E corrupt/tampered marker → HOLD (v/mode/axis/hash พัง · artBrief↔pickImages mismatch)', async () => {
  const corrupts = [
    { v: 2, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: 'aaaaaaaa' },
    { v: 1, mode: 'legacy', axis: 'template.slots', effectiveViewHash: 'aaaaaaaa' },
    { v: 1, mode: 'template_v1', axis: 'wrong', effectiveViewHash: 'aaaaaaaa' },
    { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: 'ZZZ' },
  ];
  for (const bad of corrupts) {
    const ab = { ...markedArtBrief(), refShotAuthority: bad };
    const r = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: ab });
    assert.equal(r.s6.status, 'waiting', `corrupt=${JSON.stringify(bad)}`);
  }
  // artBrief valid marker แต่ pickImages echo ถูกแก้ให้ต่าง → S7 waiting
  const armed = await runRefShotFlow({
    s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL,
    mutateAfterS6: (job) => { job.dossier.pickImages.refShotAuthority = { ...job.dossier.pickImages.refShotAuthority, effectiveViewHash: 'deadbeef' }; },
  });
  assert.equal(armed.s7.status, 'waiting', 'artBrief↔pickImages marker mismatch = S7 waiting');
  assert.equal(armed.queueCalls, 0);
});

await test('D3B2-F HOLD ก่อน slotDirector/queue: partial SEM/SPEC · artBrief throw · S7 ไม่มี strict pair', async () => {
  // armed (switch on + strong ref) แต่ SPEC หาย → fail-closed waiting ก่อน slotDirector
  const partial = await runRefShotFlow({ s6Env: { MEGA_SEMANTIC_SELECTION: '1', MEGA_REF_SHOT_AUTHORITY: '1' } });
  assert.equal(partial.s6.status, 'waiting', 'partial prereq = fail-closed');
  assert.ok(partial.captures.brainArgs.length === 0, 'ต้องพักก่อนเรียก slotDirector');
  // artBrief throw → waiting (ไม่ถอย legacy)
  const thrown = await runRefShotFlow({ s6Env: REFSHOT_S6, deps: { artBriefBrain: () => { throw new Error('AUTH_BOOM'); } } });
  assert.equal(thrown.s6.status, 'waiting', 'armed artBrief throw = HOLD');
  assert.equal(thrown.captures.brainArgs.length, 0, 'ยังไม่ถึง slotDirector');
  // S7 marked แต่ strict pair ไม่ครบ (RENDER off) → waiting queue0
  const noStrict = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: { ...REFSHOT_S6, MEGA_STRICT_PRODUCER: '1' } });
  assert.equal(noStrict.s7.status, 'waiting', 'template_v1 job ต้องมี strict pair ก่อน enqueue');
  assert.equal(noStrict.queueCalls, 0);
});

await test('D3B2-G determinism: ON 2 รอบ → marker/slotContractHash/pickImages/scrubbed payload byte-identical', async () => {
  const a = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL });
  const b = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL });
  assert.deepStrictEqual(a.s6.dossierPatch.pickImages.refShotAuthority, b.s6.dossierPatch.pickImages.refShotAuthority, 'marker เท่ากัน');
  assert.equal(a.s6.dossierPatch.pickImages.slotContractHash, b.s6.dossierPatch.pickImages.slotContractHash, 'slotContractHash เท่ากัน');
  assert.deepStrictEqual(a.s6.dossierPatch.pickImages, b.s6.dossierPatch.pickImages, 'pickImages เท่ากันเป๊ะ');
  assert.equal(a.captures.rawBody, b.captures.rawBody, 'S7 rawBody byte-identical');
});

await test('D3B2-H mode guard: source ทั้ง 3 จุด (semContract/diagnostic/selectionSpec+trace) ผูก persisted mode · solver/W3-3 ไม่แตะ', async () => {
  const src = fs.readFileSync(new URL('../src/lib/megaAdapters.js', import.meta.url), 'utf8');
  // S6: semContract + diagnostic ใช้ _jobTemplateV1
  assert.ok(/_jobTemplateV1 \? \{ mode: 'template_v1' \}/.test(src), 'semContract/diagnostic ผูก _jobTemplateV1 mode');
  assert.equal((src.match(/_jobTemplateV1 \? \{ mode: 'template_v1' \} : \{\}/g) || []).length >= 2, true, 'อย่างน้อย 2 จุดใน S6 (semContract+diagnostic)');
  // S7: selectionSpec ใช้ _s7TemplateV1 · s7_wait trace ใช้ _tracePairOk (derive จาก marker pair ไม่ใช่ env)
  assert.ok(src.includes("_s7TemplateV1 ? { mode: 'template_v1' }"), 'S7 selectionSpec ผูก _s7TemplateV1');
  assert.ok(src.includes("_tracePairOk ? { mode: 'template_v1' }"), 's7_wait trace ผูก _tracePairOk (คนละ scope, ไม่พึ่ง env)');
  // TOCTOU: strict switches ใช้ snapshot _envStrictProducer/_envStrictRender (ไม่ re-read process.env หลัง await)
  assert.ok(src.includes('_envStrictProducer') && src.includes('_envStrictRender') && src.includes('_envRefAuth'), 'S7 ใช้ snapshot env (TOCTOU-safe)');
  assert.ok(/const strictProducerRequested = _sem === true && _semEnvOn && _envStrictProducer;/.test(src), 'strictProducerRequested ใช้ snapshot');
  // env ใหม่ที่ D3-B2 เพิ่ม = MEGA_REF_SHOT_AUTHORITY เท่านั้น (W3-3 ไม่ถูก wire) — solver/W3-3 พฤติกรรมเดิม
  //   (ยืนยันเชิงพฤติกรรมผ่าน solver/diagnostic tests ที่ผ่านครบ — ที่นี่แค่การันตีไม่มี W3-3 switch ใหม่)
  assert.ok(!src.includes('MEGA_W3'), 'ไม่มี W3-3 switch');
});

await test('D3B2-I real artBriefBrain (injected callBrain): legacy prompt/return byte-exact · template_v1 marker แท้ + hero closeup + template axis', async () => {
  const cap = {};
  const cb = async ({ system, user }) => { cap.system = system; cap.user = user; return { text: '{"orders":[],"storyNote":"n"}' }; };
  // legacy: prompt system เดิม · return ไม่มี marker · orders มาจาก dna.slots (hero shot=medium)
  const legacy = await artBriefBrain({ refDNA: DNA_ALPO, compass: { angle: 'a', mainCharacters: [] }, deskTitle: 'T', typeMatched: true, _callBrain: cb });
  assert.ok(!('refShotAuthority' in legacy), 'legacy return ห้ามมี marker');
  assert.ok(cap.system.includes('บรรณาธิการศิลป์ (Art Director)'), 'legacy prompt system byte-exact เดิม');
  assert.equal(legacy.orders.length, (DNA_ALPO.slots || []).length, 'legacy orders count = dna.slots');
  assert.equal(legacy.orders.find((o) => o.role === 'hero').shot, 'medium', 'legacy hero shot = dna medium (byte เดิม)');
  // template_v1: marker แท้ (= contract authority) · hero shot closeup (template ชนะ) · orders i = template axis
  const v1 = await artBriefBrain({ refDNA: DNA_ALPO, compass: { angle: 'a', mainCharacters: [] }, deskTitle: 'T', typeMatched: true, mode: 'template_v1', _callBrain: cb });
  const c = buildRefSlotContract({ refDNA: DNA_ALPO, mode: 'template_v1' });
  assert.ok(v1.refShotAuthority && v1.refShotAuthority.mode === 'template_v1' && v1.refShotAuthority.v === 1, 'template_v1 ต้องมี marker');
  assert.equal(v1.refShotAuthority.effectiveViewHash, c.authority.effectiveViewHash, 'marker hash = contract authority (แท้ ไม่ใช่ LLM แต่ง)');
  assert.equal(v1.orders.find((o) => o.role === 'hero').shot, 'closeup', 'hero order shot = closeup (template ชนะ dna medium)');
  assert.deepEqual(v1.orders.map((o) => o.i), c.slots.map((s) => s.sourceIndex), 'orders i = template axis order');
});

await test('D3B2-J whole-contract mutation หลัง S6 (แก้ order.want) → S7 slotContractHash ไม่ตรง = waiting queue0', async () => {
  const r = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, mutateAfterS6: (job) => { job.dossier.artBrief.orders[0].want = 'MUT_' + (job.dossier.artBrief.orders[0].want || ''); } });
  assert.equal(r.s6.status, 'done');
  assert.equal(r.s7.status, 'waiting', 'orders เปลี่ยน → whole-contract hash ไม่ตรง S6');
  assert.equal(r.queueCalls, 0);
});

await test('D3B2-K corrupt marker ละเอียด: missing hash/own undefined/extra key/Date proto → HOLD · reordered keys ผ่าน · both wrong-hash → HOLD', async () => {
  const good = markedArtBrief().refShotAuthority;
  const bads = [
    { v: 1, mode: 'template_v1', axis: 'template.slots' }, // missing hash
    { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: undefined }, // own undefined
    { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: good.effectiveViewHash, extra: 1 }, // extra key
    Object.assign(new Date(), { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: good.effectiveViewHash }), // Date prototype
  ];
  for (const bad of bads) {
    const r = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: { ...markedArtBrief(), refShotAuthority: bad } });
    assert.equal(r.s6.status, 'waiting', `corrupt=${Object.getPrototypeOf(bad) === Object.prototype ? JSON.stringify(bad) : 'Date'}`);
  }
  // reordered keys (schema valid) → validator ไม่พึ่ง order → resume ได้
  const reordered = { effectiveViewHash: good.effectiveViewHash, axis: 'template.slots', mode: 'template_v1', v: 1 };
  const rR = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: { ...markedArtBrief(), refShotAuthority: reordered } });
  assert.equal(rR.s6.status, 'done', 'reordered keys ต้อง resume ได้');
  // both markers schema-valid แต่ hash ผิด → recompute reject (S6 semContract hash mismatch)
  const wrong = { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: 'deadbeef' };
  const rW = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: { ...markedArtBrief(), refShotAuthority: wrong } });
  assert.equal(rW.s6.status, 'waiting', 'schema-valid แต่ hash ผิด → recompute reject = HOLD');
});

await test('D3B2-L geometry/axis HOLD: no template (axisReady false) + geometry out-of-bounds → HOLD ก่อน slotDirector', async () => {
  // no template.slots → axisReady false → semContract okSource=false → HOLD
  const noTpl = { slots: [{ role: 'hero', shot: 'closeup' }, { role: 'context' }, { role: 'moment' }] };
  const rNo = await runRefShotFlow({ s6Env: REFSHOT_S6, dna: noTpl });
  assert.equal(rNo.s6.status, 'waiting', 'no template axis = HOLD');
  assert.equal(rNo.captures.brainArgs.length, 0, 'ก่อน slotDirector');
  // geometry out-of-bounds (x+w>100) → _refShotContractGeomOk false → HOLD
  const oob = { template: { slots: [
    { role: 'hero', shape: 'rect', xPct: 60, yPct: 0, wPct: 60, hPct: 100, shot: 'closeup' }, // 60+60>100
    { role: 'context', shape: 'rect', xPct: 0, yPct: 0, wPct: 40, hPct: 100 },
    { role: 'moment', shape: 'circle', xPct: 5, yPct: 60, wPct: 20, hPct: 20 },
  ] }, slots: [{ role: 'hero' }, { role: 'context' }, { role: 'moment' }] };
  const rOob = await runRefShotFlow({ s6Env: REFSHOT_S6, dna: oob });
  assert.equal(rOob.s6.status, 'waiting', 'geometry out-of-bounds = HOLD');
  assert.equal(rOob.captures.brainArgs.length, 0, 'ก่อน slotDirector');
});

await test('D3B2-M existing-unmarked + switch ON → pickImages + raw S7 body เท่า legacy baseline (byte)', async () => {
  const base = await runRefShotFlow({ s6Env: SEM_ON, s7Env: SEM_ON, deleteArtBrief: false });
  const on = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_S6, deleteArtBrief: false });
  assert.equal(base.s6.status, 'done');
  assert.deepStrictEqual(on.s6.dossierPatch.pickImages, base.s6.dossierPatch.pickImages, 'pickImages เท่า legacy baseline');
  assert.equal(on.captures.rawBody, base.captures.rawBody, 'S7 raw body เท่า legacy baseline');
});

await test('D3B2-N P0-1 fresh armed แต่ brain คืน missing/malformed marker → waiting · ไม่ assign (retry ไม่กลาย unmarked legacy)', async () => {
  const noMarker = await runRefShotFlow({ s6Env: REFSHOT_S6, deps: { artBriefBrain: () => ({ storyNote: 'x', orders: [] }) } });
  assert.equal(noMarker.s6.status, 'waiting', 'armed + brain ไม่มี marker = HOLD');
  assert.equal(noMarker.job.dossier.artBrief, undefined, 'ไม่ assign (fresh คงว่าง — retry ยัง fresh)');
  const badMarker = await runRefShotFlow({ s6Env: REFSHOT_S6, deps: { artBriefBrain: () => ({ storyNote: 'x', orders: [], refShotAuthority: { v: 2, mode: 'x' } }) } });
  assert.equal(badMarker.s6.status, 'waiting', 'armed + brain marker malformed = HOLD');
  assert.equal(badMarker.job.dossier.artBrief, undefined, 'ไม่ assign malformed');
});

await test('D3B2-O (P1 TOCTOU) marker Proxy: descriptor-valid + get-trap-throw → normalize ครั้งเดียว (no raw-get) · persist/echo เป็น plain', async () => {
  const hash = buildRefSlotContract({ refDNA: DNA_ALPO, mode: 'template_v1' }).authority.effectiveViewHash;
  const target = { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: hash };
  let getCalls = 0;
  const proxy = new Proxy(target, {
    get() { getCalls++; throw new Error('RAW_GET_FORBIDDEN'); }, // ถ้ามี raw get = ระเบิด
    getOwnPropertyDescriptor(t, k) { return Object.getOwnPropertyDescriptor(t, k); },
    ownKeys(t) { return Reflect.ownKeys(t); },
  });
  const ab = { storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: proxy };
  const r = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, preMarkArtBrief: ab });
  assert.equal(r.s6.status, 'done', 'descriptor-valid Proxy ต้อง normalize สำเร็จ');
  assert.equal(getCalls, 0, 'ห้ามมี raw get บน marker Proxy เลย (ใช้ descriptor เท่านั้น)');
  const echoed = r.s6.dossierPatch.pickImages.refShotAuthority;
  assert.equal(Object.getPrototypeOf(echoed), Object.prototype, 'echo marker เป็น plain object (ไม่ใช่ Proxy)');
  assert.deepStrictEqual(echoed, { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: hash });
  assert.equal(r.s7.status, 'done', 'S7 ใช้ canonical snapshot สำเร็จ (no raw-get)');
  // ★ D3-B2.4 (Codex P1): persisted artBrief carrier (ตัว 'ab' ที่ผ่านเข้าไป) ต้องถูกแทนด้วย canonical plain clone —
  //   ไม่ใช่ Proxy เดิม (กันหลุด serialize ก่อน patch) · ยังไม่มี raw get
  const canonical = { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: hash };
  assert.notStrictEqual(ab.refShotAuthority, proxy, 'persisted artBrief marker != proxy เดิม');
  assert.equal(Object.getPrototypeOf(ab.refShotAuthority), Object.prototype, 'persisted artBrief marker เป็น plain object');
  assert.deepStrictEqual(ab.refShotAuthority, canonical, 'persisted artBrief marker = canonical แท้');
  assert.equal(getCalls, 0, 'แทน carrier แล้วยังไม่มี raw get');
  // ★ D3-B2.4 (Codex P1): paired artBrief+pickImages ทั้งคู่เป็น Proxy (valid pair) →
  //   ทั้งสอง persisted carrier + echo = canonical plain · raw get คง 0
  let pairGet = 0;
  const mkProxy = () => new Proxy({ v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: hash }, {
    get() { pairGet++; throw new Error('RAW_GET_FORBIDDEN'); },
    getOwnPropertyDescriptor(t, k) { return Object.getOwnPropertyDescriptor(t, k); },
    ownKeys(t) { return Reflect.ownKeys(t); },
  });
  const abP = mkProxy();
  const pickP = mkProxy();
  const abCarrier = { storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: abP };
  const pickCarrier = { slots: {}, semanticSelection: true, refShotAuthority: pickP };
  const rp = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, preMarkArtBrief: abCarrier, prePickImages: pickCarrier });
  assert.equal(rp.s6.status, 'done', 'paired Proxy valid pair → normalize สำเร็จ');
  assert.equal(pairGet, 0, 'paired: ไม่มี raw get บน Proxy ทั้งสอง (descriptor เท่านั้น)');
  // persisted carriers (อ้างอิงเดิมที่ผ่านเข้าไป — S6 แทนในที่ก่อน patch/serialize)
  assert.notStrictEqual(abCarrier.refShotAuthority, abP, 'paired: artBrief carrier แทน proxy แล้ว');
  assert.equal(Object.getPrototypeOf(abCarrier.refShotAuthority), Object.prototype, 'paired: artBrief carrier เป็น plain');
  assert.deepStrictEqual(abCarrier.refShotAuthority, canonical, 'paired: artBrief carrier = canonical');
  assert.notStrictEqual(pickCarrier.refShotAuthority, pickP, 'paired: pickImages carrier แทน proxy แล้ว');
  assert.equal(Object.getPrototypeOf(pickCarrier.refShotAuthority), Object.prototype, 'paired: pickImages carrier เป็น plain');
  assert.deepStrictEqual(pickCarrier.refShotAuthority, canonical, 'paired: pickImages carrier = canonical');
  // returned echo (patch) canonical plain
  const echoP = rp.s6.dossierPatch.pickImages.refShotAuthority;
  assert.equal(Object.getPrototypeOf(echoP), Object.prototype, 'paired: echo เป็น plain');
  assert.deepStrictEqual(echoP, canonical, 'paired: echo = canonical');
  assert.equal(rp.s7.status, 'done', 'paired: S7 ใช้ canonical snapshot สำเร็จ');
  // getter descriptor (ไม่ใช่ data) → invalid → HOLD
  const gt = {};
  Object.defineProperty(gt, 'v', { get() { return 1; }, enumerable: true });
  Object.defineProperty(gt, 'mode', { value: 'template_v1', enumerable: true });
  Object.defineProperty(gt, 'axis', { value: 'template.slots', enumerable: true });
  Object.defineProperty(gt, 'effectiveViewHash', { value: hash, enumerable: true });
  const rG = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: { storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: gt } });
  assert.equal(rG.s6.status, 'waiting', 'getter descriptor → invalid → HOLD');
  // non-enumerable extra → Reflect.ownKeys length !=4 → HOLD
  const ne = { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: hash };
  Object.defineProperty(ne, 'hidden', { value: 1, enumerable: false });
  const rNE = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: { storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: ne } });
  assert.equal(rNE.s6.status, 'waiting', 'non-enumerable extra key → HOLD');
  // symbol extra → HOLD
  const sym = { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: hash, [Symbol('x')]: 1 };
  const rS = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: { storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: sym } });
  assert.equal(rS.s6.status, 'waiting', 'symbol extra key → HOLD');
});

await test('D3B2-P (P1-2) carrier edges: marked artBrief + pickImages(no marker) → HOLD · no artBrief + pickImages unmarked → legacy', async () => {
  // marked artBrief + pickImages object without marker = inconsistent → HOLD
  const r1 = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: markedArtBrief(), prePickImages: { slots: {} } });
  assert.equal(r1.s6.status, 'waiting', 'marked artBrief + pickImages(no marker) = HOLD');
  // no artBrief + existing unmarked pickImages (in-flight) → legacy, never upgrade
  const r2 = await runRefShotFlow({ s6Env: REFSHOT_S6, deleteArtBrief: true, prePickImages: { slots: {}, semanticSelection: true } });
  assert.equal(r2.s6.status, 'done', 'no artBrief + unmarked pickImages = legacy (เดินต่อ)');
  assert.ok(!('refShotAuthority' in r2.s6.dossierPatch.pickImages), 'ห้าม auto-upgrade เป็น marker');
});

await test('D3B2-Q (P1-3) realized gate: S6 armed + bad realized → HOLD · S7 marked + bad realized (s7Deps) → HOLD queue0', async () => {
  const realReal = dnaToTemplateSpec(DNA_ALPO);
  const mkBad = (mut) => { const rr = structuredClone(realReal); mut(rr); return () => rr; };
  const cases = [
    ['wrong-canvas', mkBad((rr) => { rr.canvasW = 1000; })],
    ['fractional', mkBad((rr) => { rr.slots[0].x = 10.5; })],
    ['upper-OOB', mkBad((rr) => { rr.slots[0].w = (1080 - rr.slots[0].x) + 5; })],
    ['dup-id', mkBad((rr) => { rr.slots[1].id = rr.slots[0].id; })],
    ['blank-id', mkBad((rr) => { rr.slots[0].id = ''; })],
  ];
  for (const [name, badFn] of cases) {
    const s6 = await runRefShotFlow({ s6Env: REFSHOT_S6, deps: { dnaToTemplateSpec: badFn } });
    assert.equal(s6.s6.status, 'waiting', `S6 realized ${name} → HOLD`);
    const s7 = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, s7Deps: { dnaToTemplateSpec: badFn } });
    assert.equal(s7.s7.status, 'waiting', `S7 realized ${name} → HOLD`);
    assert.equal(s7.queueCalls, 0, `${name}: queue0`);
  }
});

await test('D3B2-R (P1-5) real artBriefBrain: template reject ก่อน callBrain · full legacy deep-compare · LLM-spoof marker ถูกทับ', async () => {
  // template invalid → reject ก่อนเรียก callBrain
  let cbCalled = false;
  const cbGuard = async () => { cbCalled = true; return { text: '{}' }; };
  await assert.rejects(
    artBriefBrain({ refDNA: { slots: [{ role: 'hero' }] }, compass: {}, deskTitle: 'T', mode: 'template_v1', _callBrain: cbGuard }),
    /AUTHORITY/,
    'template invalid ต้อง throw',
  );
  assert.equal(cbCalled, false, 'reject ก่อนเรียก callBrain (ไม่เปลือง LLM)');
  // full legacy deep-compare: default vs 'legacy' vs 'junk' → call args + return object เท่ากันครบ
  const runLegacy = async (mode) => {
    const cap = {};
    const cb = async (args) => { cap.args = args; return { text: '{"orders":[{"i":0,"want":"w","personHint":null,"refShotAuthority":{"v":9}}],"storyNote":"s","refShotAuthority":{"hacked":true}}' }; };
    const out = await artBriefBrain({ refDNA: DNA_ALPO, compass: { angle: 'a', mainCharacters: [] }, deskTitle: 'T', typeMatched: true, ...(mode !== undefined ? { mode } : {}), _callBrain: cb });
    return { args: cap.args, out };
  };
  const a = await runLegacy(undefined);
  const b = await runLegacy('legacy');
  const c = await runLegacy('junk');
  assert.deepStrictEqual(a.args, b.args, 'default vs legacy: callBrain args ครบเท่ากัน');
  assert.deepStrictEqual(a.args, c.args, 'default vs junk: callBrain args ครบเท่ากัน');
  assert.deepStrictEqual(a.out, b.out, 'default vs legacy: return object ครบเท่ากัน');
  assert.deepStrictEqual(a.out, c.out, 'default vs junk: return object ครบเท่ากัน');
  assert.ok(!('refShotAuthority' in a.out), 'legacy return ไม่มี marker (LLM spoof ไม่รับ)');
  assert.ok(!('refShotAuthority' in (a.out.orders[0] || {})), 'order ไม่พก marker ที่ LLM แอบใส่');
  // template_v1: LLM spoof top-level/nested marker → ต้องถูกทับด้วย canonical แท้เท่านั้น
  const capV = {};
  const cbV = async (args) => { capV.args = args; return { text: '{"orders":[{"i":0,"want":"w","personHint":null}],"storyNote":"s","refShotAuthority":{"hacked":true}}' }; };
  const v1 = await artBriefBrain({ refDNA: DNA_ALPO, compass: { angle: 'a', mainCharacters: [] }, deskTitle: 'T', typeMatched: true, mode: 'template_v1', _callBrain: cbV });
  const contract = buildRefSlotContract({ refDNA: DNA_ALPO, mode: 'template_v1' });
  assert.deepStrictEqual(v1.refShotAuthority, { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: contract.authority.effectiveViewHash }, 'marker = canonical แท้ (LLM spoof ถูกทับ)');
  assert.equal(resolveRefSlotView(DNA_ALPO, { mode: 'template_v1' }).views[0].shotProvenance, 'template', 'hero shot provenance = template (AC-0066)');
});

await test('D3B2-S (P1-2) truly-reordered axis: REAL artBriefBrain — user prompt + orders ตาม template axis · subject/emotion จาก role+occurrence · template shot/provenance ชนะ · direct OOB/missing reject ก่อน callBrain', async () => {
  // DNA slots order/roles ขัด template.slots order: template=[hero,context,reaction] · dna=[reaction,hero,context]
  const REORDER_DNA = {
    template: { slots: [
      { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 50, hPct: 50, shot: 'closeup' },
      { role: 'context', shape: 'rect', xPct: 50, yPct: 0, wPct: 50, hPct: 50, shot: 'wide' },
      { role: 'reaction', shape: 'rect', xPct: 0, yPct: 50, wPct: 50, hPct: 50, shot: 'medium' },
    ] },
    slots: [
      { role: 'reaction', shot: 'DNA_R', subject: 'Person R', emotion: 'shocked' },
      { role: 'hero', shot: 'DNA_H', subject: 'Person H', emotion: 'crying' },
      { role: 'context', shot: 'DNA_C', subject: 'Place C', emotion: 'calm' },
    ],
  };
  const cap = {};
  const cb = async (args) => { cap.args = args; return { text: '{"orders":[{"i":0,"want":"wH","personHint":null},{"i":1,"want":"wC","personHint":null},{"i":2,"want":"wR","personHint":null}],"storyNote":"n"}' }; };
  const out = await artBriefBrain({ refDNA: REORDER_DNA, compass: { angle: 'a', mainCharacters: [] }, deskTitle: 'T', typeMatched: true, mode: 'template_v1', _callBrain: cb });
  // captured full user-prompt role sequence = template axis order (ไม่ใช่ dna array order)
  const promptSlots = JSON.parse(cap.args.user.split('\n').pop());
  assert.deepEqual(promptSlots.map((s) => s.role), ['hero', 'context', 'reaction'], 'user prompt role sequence = template axis (dna order [reaction,hero,context] ไม่ชนะ)');
  // subject/emotion จาก role+occurrence semantics (จับ DNA ตาม role ไม่ใช่ index)
  assert.equal(promptSlots[0].refSubject, 'Person H', 'hero subject = DNA hero (role match)');
  assert.equal(promptSlots[0].emotion, 'crying', 'hero emotion = DNA hero');
  assert.equal(promptSlots[2].refSubject, 'Person R', 'reaction subject = DNA reaction');
  assert.equal(promptSlots[2].emotion, 'shocked', 'reaction emotion = DNA reaction');
  // template shot ชนะ dna shot ทุกช่อง
  assert.deepEqual(promptSlots.map((s) => s.shot), ['closeup', 'wide', 'medium'], 'prompt shot = template (DNA_* ถูกทับ)');
  // returned orders ตาม template axis/order + template shot ในผลด้วย
  assert.deepEqual(out.orders.map((o) => o.i), [0, 1, 2], 'orders index = template axis');
  assert.deepEqual(out.orders.map((o) => o.role), ['hero', 'context', 'reaction'], 'orders role = template axis');
  assert.deepEqual(out.orders.map((o) => o.shot), ['closeup', 'wide', 'medium'], 'orders shot = template ชนะ');
  // provenance ชนะ + marker canonical แท้
  const rv = resolveRefSlotView(REORDER_DNA, { mode: 'template_v1' });
  assert.equal(rv.views[0].shotProvenance, 'template', 'hero shot provenance = template');
  const c = buildRefSlotContract({ refDNA: REORDER_DNA, mode: 'template_v1' });
  assert.deepStrictEqual(out.refShotAuthority, { v: 1, mode: 'template_v1', axis: 'template.slots', effectiveViewHash: c.authority.effectiveViewHash }, 'marker = canonical แท้');

  // ── direct reject ก่อน callBrain: missing template + x+w>100 + y+h>100 ──
  const guarded = async (refDNA) => {
    let called = false;
    const g = async () => { called = true; return { text: '{}' }; };
    let err = null;
    try { await artBriefBrain({ refDNA, compass: {}, deskTitle: 'T', mode: 'template_v1', _callBrain: g }); }
    catch (e) { err = e; }
    return { called, err };
  };
  const missing = await guarded({ slots: [{ role: 'hero' }, { role: 'context' }, { role: 'reaction' }] });
  assert.match(String(missing.err?.message), /AXIS_NOT_READY/, 'missing template → AXIS_NOT_READY');
  assert.equal(missing.called, false, 'missing template: ไม่เรียก callBrain');
  const oobX = await guarded({ template: { slots: [
    { role: 'hero', xPct: 60, yPct: 0, wPct: 50, hPct: 50 }, // x+w=110>100
    { role: 'context', xPct: 0, yPct: 0, wPct: 40, hPct: 50 },
    { role: 'reaction', xPct: 0, yPct: 50, wPct: 40, hPct: 40 },
  ] }, slots: [] });
  assert.match(String(oobX.err?.message), /GEOMETRY_INVALID/, 'x+w>100 → GEOMETRY_INVALID');
  assert.equal(oobX.called, false, 'x+w>100: ไม่เรียก callBrain');
  const oobY = await guarded({ template: { slots: [
    { role: 'hero', xPct: 0, yPct: 60, wPct: 50, hPct: 50 }, // y+h=110>100
    { role: 'context', xPct: 0, yPct: 0, wPct: 40, hPct: 50 },
    { role: 'reaction', xPct: 50, yPct: 0, wPct: 40, hPct: 40 },
  ] }, slots: [] });
  assert.match(String(oobY.err?.message), /GEOMETRY_INVALID/, 'y+h>100 → GEOMETRY_INVALID');
  assert.equal(oobY.called, false, 'y+h>100: ไม่เรียก callBrain');
});

await test('D3B2-T (P1-3) legacy golden: default/legacy/junk → COMPLETE call args + return hash = hard-coded golden (HEAD 0dbd5a0 legacy branch)', async () => {
  // ★ literal golden = sha256(JSON.stringify({args,out})) คำนวณ offline จาก legacy branch —
  //   byte-identical กับ HEAD 0dbd5a0 (git diff พิสูจน์ legacy path เป็น additive-only; template_v1 ต่อยอดไม่แตะ) ·
  //   ห้าม derive จาก output ปัจจุบัน (regression ที่แชร์ทุก mode จะหลุด self-compare แต่ไม่หลุด golden นี้)
  const GOLD_DNA = { slots: [
    { role: 'hero', pos: 'center', shot: 'closeup', emotion: 'crying', faceSizePct: 40, subject: 'Mother' },
    { role: 'reaction', pos: 'left', shot: 'medium', emotion: 'shocked', faceSizePct: 25, subject: 'Son' },
    { role: 'context', pos: 'right', shot: 'wide', emotion: 'calm', faceSizePct: 10, subject: 'House' },
  ] };
  const GOLD_COMPASS = { angle: 'มุมทอง', primaryEmotion: 'เศร้า', mainCharacters: [{ name: 'แม่', role: 'hero' }], visualDreamShots: [] };
  const GOLD_DESK = 'ข่าวทองคำทดสอบ';
  const GOLD_TEXT = '{"orders":[{"i":0,"want":"w0","personHint":"p0"},{"i":1,"want":"w1","personHint":null},{"i":2,"want":"w2","personHint":"p2"}],"storyNote":"sn"}';
  const GOLDEN_SHA256 = '5a0066f07f821cd7cc9fcf6f4b45f8f71e2619bedbe9a97cf55e114919ffcab8';
  const run = async (mode) => {
    const cap = {};
    const cb = async (args) => { cap.args = args; return { text: GOLD_TEXT }; };
    const out = await artBriefBrain({ refDNA: GOLD_DNA, compass: GOLD_COMPASS, deskTitle: GOLD_DESK, typeMatched: true, ...(mode !== undefined ? { mode } : {}), _callBrain: cb });
    return crypto.createHash('sha256').update(JSON.stringify({ args: cap.args, out })).digest('hex');
  };
  assert.equal(await run(undefined), GOLDEN_SHA256, 'default mode = golden (HEAD-anchored)');
  assert.equal(await run('legacy'), GOLDEN_SHA256, 'explicit legacy = golden');
  assert.equal(await run('junk'), GOLDEN_SHA256, 'junk mode → legacy = golden');
});

await test('D3B2-U (P1 fail-closed carrier descriptor) S6: refShotAuthority เป็น getter/non-enumerable/throwing-descriptor Proxy → HOLD · ไม่รัน getter · slotDirector 0', async () => {
  const goodMarker = () => markedArtBrief().refShotAuthority;
  // 1) carrier-level getter → ห้ามถูกรัน (อ่านผ่าน descriptor) → HOLD
  let s6GetterRan = 0;
  const abGetter = { storyNote: 'x', orders: markedArtBrief().orders };
  Object.defineProperty(abGetter, 'refShotAuthority', { get() { s6GetterRan++; return goodMarker(); }, enumerable: true, configurable: true });
  const rG = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abGetter });
  assert.equal(rG.s6.status, 'waiting', 'S6 carrier getter → HOLD (marker corrupt)');
  assert.equal(s6GetterRan, 0, 'S6 carrier getter ห้ามถูก execute (descriptor-only read)');
  assert.equal(rG.captures.brainArgs.length, 0, 'S6 carrier getter: ไม่ถึง slotDirector');
  // 2) non-enumerable property: อ่านได้แต่จะหายตอน JSON persist → ต้อง HOLD (ไม่ใช่ผ่าน)
  const abNonEnum = { storyNote: 'x', orders: markedArtBrief().orders };
  Object.defineProperty(abNonEnum, 'refShotAuthority', { value: goodMarker(), enumerable: false, configurable: true });
  assert.ok(!('refShotAuthority' in JSON.parse(JSON.stringify(abNonEnum))), 'ยืนยัน: non-enumerable หายตอน JSON round-trip');
  const rNE = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abNonEnum });
  assert.equal(rNE.s6.status, 'waiting', 'S6 carrier non-enumerable → HOLD (กันหายเงียบตอน persist)');
  assert.equal(rNE.captures.brainArgs.length, 0, 'S6 non-enum: ไม่ถึง slotDirector');
  // 3) throwing getOwnPropertyDescriptor Proxy (เฉพาะ key refShotAuthority) → caught → HOLD (ไม่ระเบิด)
  let s6Gopd = 0;
  const abTarget = { storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: goodMarker() };
  const abProxy = new Proxy(abTarget, {
    getOwnPropertyDescriptor(t, k) { if (k === 'refShotAuthority') { s6Gopd++; throw new Error('GOPD_FORBIDDEN'); } return Object.getOwnPropertyDescriptor(t, k); },
  });
  const rTP = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abProxy });
  assert.equal(rTP.s6.status, 'waiting', 'S6 throwing-descriptor Proxy → HOLD (caught fail-closed)');
  assert.ok(s6Gopd >= 1, 'S6 อ่านผ่าน getOwnPropertyDescriptor จริง (trap ถูกเรียก)');
  assert.equal(rTP.captures.brainArgs.length, 0, 'S6 throwing-descriptor: ไม่ถึง slotDirector');
});

await test('D3B2-V (P1 fail-closed carrier descriptor) S7: pickImages.refShotAuthority getter/non-enumerable/throwing-descriptor Proxy หลัง S6 armed → HOLD · ไม่รัน getter · queue0', async () => {
  // getter บน pickImages carrier หลัง S6 done → S7 HOLD · getter ไม่ถูกรัน · queue0
  let s7GetterRan = 0;
  const rG = await runRefShotFlow({
    s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL,
    mutateAfterS6: (job) => {
      const pick = job.dossier.pickImages;
      const cur = Object.getOwnPropertyDescriptor(pick, 'refShotAuthority').value;
      delete pick.refShotAuthority;
      Object.defineProperty(pick, 'refShotAuthority', { get() { s7GetterRan++; return cur; }, enumerable: true, configurable: true });
    },
  });
  assert.equal(rG.s6.status, 'done', 'S6 armed done');
  assert.equal(rG.s7.status, 'waiting', 'S7 carrier getter → HOLD');
  assert.equal(s7GetterRan, 0, 'S7 carrier getter ห้ามถูก execute');
  assert.equal(rG.queueCalls, 0, 'S7 getter: queue0');
  // non-enumerable บน pickImages carrier → S7 HOLD · queue0
  const rNE = await runRefShotFlow({
    s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL,
    mutateAfterS6: (job) => {
      const pick = job.dossier.pickImages;
      const cur = Object.getOwnPropertyDescriptor(pick, 'refShotAuthority').value;
      delete pick.refShotAuthority;
      Object.defineProperty(pick, 'refShotAuthority', { value: cur, enumerable: false, configurable: true });
    },
  });
  assert.equal(rNE.s7.status, 'waiting', 'S7 carrier non-enumerable → HOLD');
  assert.equal(rNE.queueCalls, 0, 'S7 non-enum: queue0');
  // throwing getOwnPropertyDescriptor Proxy wrap pickImages (เฉพาะ key refShotAuthority) → S7 HOLD · queue0
  let s7Gopd = 0;
  const rTP = await runRefShotFlow({
    s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL,
    mutateAfterS6: (job) => {
      const target = job.dossier.pickImages;
      job.dossier.pickImages = new Proxy(target, {
        getOwnPropertyDescriptor(t, k) { if (k === 'refShotAuthority') { s7Gopd++; throw new Error('GOPD_FORBIDDEN'); } return Object.getOwnPropertyDescriptor(t, k); },
      });
    },
  });
  assert.equal(rTP.s7.status, 'waiting', 'S7 throwing-descriptor Proxy → HOLD (caught)');
  assert.ok(s7Gopd >= 1, 'S7 อ่านผ่าน getOwnPropertyDescriptor จริง (trap ถูกเรียก)');
  assert.equal(rTP.queueCalls, 0, 'S7 throwing-descriptor: queue0');
});

await test('D3B2-W (P1 fail-closed write-back) S6 resume: frozen/non-writable carrier · Proxy throwing/swallowed set trap → HOLD (ไม่ throw) · slotDirector0 · queue0 · deterministic retry', async () => {
  const M = () => markedArtBrief().refShotAuthority;
  // 1) frozen artBrief carrier ทั้งก้อน (refShotAuthority non-writable) → write-back throw → caught → HOLD
  const abFrozen = Object.freeze({ storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: M() });
  const rF1 = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abFrozen });
  assert.equal(rF1.s6.status, 'waiting', 'frozen carrier → HOLD (ไม่ throw หลุด S6)');
  assert.equal(rF1.captures.brainArgs.length, 0, 'frozen: slotDirector 0');
  // deterministic: carrier เดิม รอบสอง → waiting เหมือนเดิม (frozen ไม่เปลี่ยน)
  const rF2 = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abFrozen });
  assert.equal(rF2.s6.status, 'waiting', 'frozen carrier retry → waiting (deterministic)');
  assert.equal(rF2.captures.brainArgs.length, 0, 'frozen retry: slotDirector 0');
  // 2) non-writable property เดี่ยว (object ไม่ frozen ทั้งก้อน) → write-back throw → HOLD
  const abNW = { storyNote: 'x', orders: markedArtBrief().orders };
  Object.defineProperty(abNW, 'refShotAuthority', { value: M(), enumerable: true, writable: false, configurable: false });
  const rNW = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abNW });
  assert.equal(rNW.s6.status, 'waiting', 'non-writable property → HOLD');
  assert.equal(rNW.captures.brainArgs.length, 0, 'non-writable: slotDirector 0');
  // 3) Proxy throwing set trap → write-back throw → caught → HOLD
  let throwSet = 0;
  const abThrow = new Proxy({ storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: M() }, {
    set(t, k, v) { if (k === 'refShotAuthority') { throwSet++; throw new Error('SET_FORBIDDEN'); } t[k] = v; return true; },
  });
  const rT = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abThrow });
  assert.equal(rT.s6.status, 'waiting', 'throwing set trap → HOLD (caught)');
  assert.ok(throwSet >= 1, 'write-back พยายามเขียนจริง (set trap ถูกเรียก)');
  assert.equal(rT.captures.brainArgs.length, 0, 'throwing set: slotDirector 0');
  // 4) Proxy swallowed/lying set trap (คืน true แต่ไม่เซ็ต) → readback identity ไม่ตรง → HOLD
  let lyingSet = 0;
  const abLie = new Proxy({ storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: M() }, {
    set(t, k, v) { if (k === 'refShotAuthority') { lyingSet++; return true; } t[k] = v; return true; },
  });
  const rL = await runRefShotFlow({ s6Env: REFSHOT_S6, preMarkArtBrief: abLie });
  assert.equal(rL.s6.status, 'waiting', 'lying set trap → HOLD (readback identity ไม่ตรง)');
  assert.ok(lyingSet >= 1, 'lying set trap ถูกเรียกจริง');
  assert.equal(rL.captures.brainArgs.length, 0, 'lying set: slotDirector 0');
  // 5) paired: pickImages frozen → write-back pickImages ล้ม → HOLD · queue0 (artBrief เขียนผ่านก่อนก็ยัง HOLD)
  const abPair = { storyNote: 'x', orders: markedArtBrief().orders, refShotAuthority: M() };
  const pickFrozen = Object.freeze({ slots: {}, refShotAuthority: M() });
  const rP = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, preMarkArtBrief: abPair, prePickImages: pickFrozen });
  assert.equal(rP.s6.status, 'waiting', 'paired frozen pickImages → HOLD');
  assert.equal(rP.captures.brainArgs.length, 0, 'paired frozen: slotDirector 0');
  assert.equal(rP.queueCalls, 0, 'paired frozen: queue0');
});

// ═══════════ D3-B3: template person authority (identity correction) ═══════════
// synthetic DNA: hero/context/reaction · reaction refSubject = female (the AC-0066 poison)
const PERSON_DNA = {
  template: { slots: [
    { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 50, hPct: 50, shot: 'closeup' },
    { role: 'context', shape: 'rect', xPct: 50, yPct: 0, wPct: 50, hPct: 50, shot: 'wide' },
    { role: 'reaction', shape: 'rect', xPct: 0, yPct: 50, wPct: 50, hPct: 50, shot: 'medium' },
  ] },
  slots: [
    { role: 'hero', subject: 'ชายสวมสูท', emotion: 'สงบ' },
    { role: 'context', subject: 'อาคาร' },
    { role: 'reaction', subject: 'ผู้หญิงยิ้ม', emotion: 'ยิ้ม' }, // ★ female refSubject = poison
  ],
};
const HERO_D = { name: 'ดวงเดือน', role: 'hero' };
const REACT_S = { name: 'สรพงศ์ ชาตรี', role: 'reaction' };
const REL_S = { name: 'สรพงศ์ ชาตรี', role: 'related' };
// call REAL artBriefBrain (template_v1) with a mock LLM that emits personHint per role
const briefWith = async (chars, hintByRole, dna = PERSON_DNA) => {
  const cap = {};
  const cb = async (args) => {
    const rows = JSON.parse(args.user.split('\n').pop());
    cap.rows = rows;
    const orders = rows.map((r) => ({ i: r.i, want: 'w', personHint: Object.prototype.hasOwnProperty.call(hintByRole, r.role) ? hintByRole[r.role] : null }));
    return { text: JSON.stringify({ orders, storyNote: 'n' }) };
  };
  const out = await artBriefBrain({ refDNA: dna, compass: { angle: 'a', mainCharacters: chars }, deskTitle: 'T', typeMatched: true, mode: 'template_v1', _callBrain: cb });
  return { out, rows: cap.rows };
};
const hintOf = (out, role) => (out.orders.find((o) => o.role === role) || {}).personHint;

await test('D3B3-A (Codex) real artBriefBrain identity: reaction poison→canonical · explicit override · same-hero preserve · only-hero · alias/collision · prompt rows own currentPersonAuthority', async () => {
  // #1 AC-0066-like: LLM emits reaction=ดวงเดือน (poison จาก female refSubject) → corrected to สรพงศ์
  const { out: o1, rows: r1 } = await briefWith([HERO_D, REACT_S], { reaction: 'ดวงเดือน' });
  assert.equal(hintOf(o1, 'hero'), 'ดวงเดือน', '#1 hero = canonical hero');
  assert.equal(hintOf(o1, 'reaction'), 'สรพงศ์ ชาตรี', '#1 reaction corrected ดวงเดือน→สรพงศ์');
  const c1 = buildRefSlotContract({ refDNA: PERSON_DNA, artBriefOrders: o1.orders, mode: 'template_v1' });
  assert.equal(c1.slots.find((s) => s.refRole === 'reaction').wantPerson, 'สรพงศ์ ชาตรี', '#1 contract reaction wantPerson = สรพงศ์');
  // every template prompt row owns currentPersonAuthority (string|null)
  assert.ok(r1.every((row) => Object.prototype.hasOwnProperty.call(row, 'currentPersonAuthority')), '#1 ทุกแถว prompt มี key currentPersonAuthority');
  assert.equal(r1.find((row) => row.role === 'hero').currentPersonAuthority, 'ดวงเดือน', '#1 hero row authority');
  assert.equal(r1.find((row) => row.role === 'reaction').currentPersonAuthority, 'สรพงศ์ ชาตรี', '#1 reaction row authority');
  assert.equal(r1.find((row) => row.role === 'context').currentPersonAuthority, null, '#1 context row authority = null');
  // #2 explicit reaction + LLM unknown / hero → override to canonical reaction
  assert.equal(hintOf((await briefWith([HERO_D, REACT_S], { reaction: 'คนแปลกหน้า' })).out, 'reaction'), 'สรพงศ์ ชาตรี', '#2 unknown → override');
  assert.equal(hintOf((await briefWith([HERO_D, REACT_S], { reaction: 'ดวงเดือน' })).out, 'reaction'), 'สรพงศ์ ชาตรี', '#2 hero → override');
  // #3 no explicit reaction (secondary role=related) + intentional known hero → preserve same-hero
  assert.equal(hintOf((await briefWith([HERO_D, REL_S], { reaction: 'ดวงเดือน' })).out, 'reaction'), 'ดวงเดือน', '#3 same-hero preserved');
  // #4 only hero: known same-hero remains · unknown → null (never invent)
  assert.equal(hintOf((await briefWith([HERO_D], { reaction: 'ดวงเดือน' })).out, 'reaction'), 'ดวงเดือน', '#4 only-hero known → remains');
  assert.equal(hintOf((await briefWith([HERO_D], { reaction: 'มนุษย์ต่างดาว' })).out, 'reaction'), null, '#4 only-hero unknown → null');
  // #5 alias/duplicate exclusion + collision (deterministic token match, no prefix-fuzzy)
  const authDup = templateV1PersonAuthority({ mainCharacters: [HERO_D, { name: 'ดวงเดือน', role: 'reaction' }, { name: 'สรพงศ์ ชาตรี', role: 'reaction' }] });
  assert.equal(authDup.reaction, 'สรพงศ์ ชาตรี', '#5 exact-dup of hero excluded → สรพงศ์');
  const authAlias = templateV1PersonAuthority({ mainCharacters: [{ name: 'สรพงศ์ ชาตรี', role: 'hero' }, { name: 'สรพงศ์', role: 'reaction' }, { name: 'ดวงเดือน', role: 'reaction' }] });
  assert.equal(authAlias.reaction, 'ดวงเดือน', '#5 token-alias of hero excluded → ดวงเดือน');
  const authCol = templateV1PersonAuthority({ mainCharacters: [{ name: 'สมหมายเลขหนึ่ง', role: 'hero' }, { name: 'สมหมายเลขสอง', role: 'reaction' }] });
  assert.equal(authCol.reaction, 'สมหมายเลขสอง', '#5 collision: prefix-lookalike NOT excluded (kept)');
  assert.equal(authCol.nameMatch('สมหมายเลขหนึ่ง', 'สมหมายเลขสอง'), false, '#5 collision: nameMatch=false');
  assert.equal(authCol.nameMatch('สรพงศ์ ชาตรี', 'สรพงศ์'), true, '#5 alias: token-subset nameMatch=true');
  // #6 parenthetical schema "ชื่อจริง (ชื่อเล่น)": nickname-dup of hero excluded · realname/nickname match · lookalike false
  const authNick = templateV1PersonAuthority({ mainCharacters: [
    { name: 'จุน วนวิทย์ (อากงจุน)', role: 'hero' },
    { name: 'อากงจุน', role: 'reaction' }, // = hero via nickname → excluded
    { name: 'สมพร ใจดี', role: 'reaction' },
  ] });
  assert.equal(authNick.hero, 'จุน วนวิทย์ (อากงจุน)', '#6 hero keeps exact canonical spelling');
  assert.equal(authNick.reaction, 'สมพร ใจดี', '#6 nickname-dup excluded → first stable non-hero reaction');
  assert.equal(authNick.nameMatch('จุน วนวิทย์ (อากงจุน)', 'อากงจุน'), true, '#6 realname↔nickname match');
  assert.equal(authNick.nameMatch('จุน วนวิทย์ (อากงจุน)', 'จุน วนวิทย์'), true, '#6 realname (no nick) match');
  assert.equal(authNick.nameMatch('จุน วนวิทย์ (อากงจุน)', 'จุน วนวิทยา'), false, '#6 lookalike วนวิทยา = false');
  // #7 other roles (context) personHint byte-unchanged in template_v1 output (authority applies only to hero/main/reaction)
  const { out: o7 } = await briefWith([HERO_D, REACT_S], { context: 'ช่างก่อสร้างนิรนาม' });
  assert.equal(hintOf(o7, 'context'), 'ช่างก่อสร้างนิรนาม', '#7 context personHint byte-unchanged');
  assert.equal(hintOf(o7, 'reaction'), 'สรพงศ์ ชาตรี', '#7 reaction still authority-corrected');
});

// craft a marked template_v1 artBrief then tamper specific role hints (marker stays canonical)
const markedWithHints = (chars, hintByRole) => {
  const base = markedArtBrief(chars);
  return { ...base, orders: base.orders.map((o) => (Object.prototype.hasOwnProperty.call(hintByRole, o.role) ? { ...o, personHint: hintByRole[o.role] } : o)) };
};
const CH_REACT = [HERO_D, REACT_S];

await test('D3B3-B (Codex) defense-in-depth: S6 selects สรพงศ์ · fresh-bad/resume-bad HOLD before slotDirector · main covered · every-order · same-hero PASS', async () => {
  // #1b full S6: real brain (poison reaction=ดวงเดือน) → corrected → wantPerson สรพงศ์ → reaction asset = P5 (สรพงศ์)
  const poisonCb = async (args) => {
    const rows = JSON.parse(args.user.split('\n').pop());
    return { text: JSON.stringify({ orders: rows.map((r) => ({ i: r.i, want: 'w', personHint: r.role === 'reaction' ? 'ดวงเดือน' : null })), storyNote: 'n' }) };
  };
  const sel = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, deps: { artBriefBrain: async (a) => artBriefBrain({ ...a, _callBrain: poisonCb }) } });
  assert.equal(sel.s6.status, 'done', '#1b corrected fresh → done');
  assert.equal(hintOf(sel.job.dossier.artBrief, 'reaction'), 'สรพงศ์ ชาตรี', '#1b persisted reaction = สรพงศ์');
  assert.equal(String(sel.s6.dossierPatch.pickImages.slots.reaction?.id), 'P5', '#1b reaction asset = P5 (สรพงศ์ ชาตรี)');
  assert.ok(sel.captures.brainArgs.length >= 1, '#1b ถึง slotDirector (ผ่าน validation)');

  // bad FRESH generated marked brief (reaction=hero under explicit reaction) → HOLD before persist/slotDirector
  const badBrain = () => ({ storyNote: 'x', orders: [{ i: 0, role: 'hero', want: 'w', personHint: 'ดวงเดือน', shot: '' }, { i: 4, role: 'reaction', want: 'w', personHint: 'ดวงเดือน', shot: '' }], refShotAuthority: markedArtBrief(CH_REACT).refShotAuthority });
  const rbad = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, deps: { artBriefBrain: badBrain } });
  assert.equal(rbad.s6.status, 'waiting', 'bad-fresh → HOLD');
  assert.equal(rbad.job.dossier.artBrief, undefined, 'bad-fresh: ไม่ persist (artBrief คงว่าง)');
  assert.equal(rbad.captures.brainArgs.length, 0, 'bad-fresh: slotDirector 0');

  // #6 explicit reaction expected + persisted null → HOLD (resume) · deterministic retry · queue0
  const mk6 = () => runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: markedWithHints(CH_REACT, { reaction: null }) });
  const r6a = await mk6(); const r6b = await mk6();
  assert.equal(r6a.s6.status, 'waiting', '#6 explicit reaction + null → HOLD');
  assert.equal(r6b.s6.status, 'waiting', '#6 deterministic retry → HOLD');
  assert.equal(r6b.s6.nextAction, r6a.s6.nextAction, '#6 retry nextAction เท่า');
  assert.equal(r6b.s6.summary, r6a.s6.summary, '#6 retry summary เท่า');
  assert.equal(r6a.captures.brainArgs.length, 0, '#6 slotDirector 0');
  assert.equal(r6a.queueCalls, 0, '#6 queue 0');

  // no explicit reaction + persisted unknown → HOLD
  const r7 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CHARS_A, preMarkArtBrief: markedWithHints(CHARS_A, { reaction: 'มนุษย์ล่องหน' }) });
  assert.equal(r7.s6.status, 'waiting', 'no-explicit + unknown → HOLD');
  assert.equal(r7.captures.brainArgs.length, 0, 'unknown: slotDirector 0');

  // no explicit reaction + persisted known hero → PASS (reaches slotDirector, not HELD)
  const r8 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CHARS_A, preMarkArtBrief: markedWithHints(CHARS_A, { reaction: 'ดวงเดือน' }) });
  assert.ok(r8.captures.brainArgs.length >= 1, 'same-hero (no explicit) → ผ่าน validation ถึง slotDirector');

  // two reaction orders, second tampered → HOLD (validate EVERY order, not first)
  const base2r = markedArtBrief(CH_REACT);
  const two = { ...base2r, orders: [...base2r.orders, { i: 99, role: 'reaction', want: 'w', personHint: 'ดวงเดือน', shot: '' }] };
  const r9 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: two });
  assert.equal(r9.s6.status, 'waiting', 'extra second reaction i:99 wrong hint → HOLD (no-extra pass)');
  assert.equal(r9.captures.brainArgs.length, 0, 'two-reaction: slotDirector 0');
  assert.equal(r9.queueCalls, 0, 'two-reaction: queue 0');
  // coercion index: hero order i:'' (Number('')===0) ห้าม coerce ลง hero index 0 → HOLD (strict integer)
  const baseC = markedArtBrief(CH_REACT);
  const coerce = { ...baseC, orders: baseC.orders.map((o) => (o.role === 'hero' ? { ...o, i: '' } : o)) };
  const rCa = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: coerce });
  const rCb = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: coerce });
  assert.equal(rCa.s6.status, 'waiting', 'coercion index i:"" on target row → HOLD (no Number coercion)');
  assert.equal(rCa.captures.brainArgs.length, 0, 'coercion: slotDirector 0');
  assert.equal(rCa.queueCalls, 0, 'coercion: queue 0');
  assert.equal(rCb.s6.summary, rCa.s6.summary, 'coercion: deterministic retry summary เท่า');

  // role=main covered (hero-family): wrong person on main → HOLD
  const baseM = markedArtBrief(CH_REACT);
  const mainWrong = { ...baseM, orders: baseM.orders.map((o) => (o.role === 'hero' ? { ...o, role: 'main', personHint: 'สรพงศ์ ชาตรี' } : o)) };
  const r10 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: mainWrong });
  assert.equal(r10.s6.status, 'waiting', 'role=main wrong person → HOLD');
  assert.equal(r10.captures.brainArgs.length, 0, 'main: slotDirector 0');

  // throwing personHint getter on a resumed marked order → deterministic waiting (fail-closed, no throw escapes s6)
  const mkGetter = () => {
    const base = markedArtBrief(CH_REACT);
    return { ...base, orders: base.orders.map((o) => {
      if (o.role !== 'reaction') return o;
      const bad = { i: o.i, role: 'reaction', want: o.want, shot: o.shot };
      Object.defineProperty(bad, 'personHint', { get() { throw new Error('HINT_GETTER_BOOM'); }, enumerable: true, configurable: true });
      return bad;
    }) };
  };
  const g1 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: mkGetter() });
  const g2 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: mkGetter() });
  assert.equal(g1.s6.status, 'waiting', 'throwing personHint getter → HOLD (ไม่ throw หลุด s6)');
  assert.equal(g1.captures.brainArgs.length, 0, 'throwing getter: slotDirector 0');
  assert.equal(g1.queueCalls, 0, 'throwing getter: queue 0');
  assert.equal(g2.s6.status, g1.s6.status, 'throwing getter retry: status เท่า');
  assert.equal(g2.s6.nextAction, g1.s6.nextAction, 'throwing getter retry: nextAction เท่า');
  assert.equal(g2.s6.summary, g1.s6.summary, 'throwing getter retry: summary เท่า');
  // non-array orders on a marked artBrief → HOLD (total/fail-closed, not []=>true)
  const rNA = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: { ...markedArtBrief(CH_REACT), orders: false } });
  assert.equal(rNA.s6.status, 'waiting', 'non-array orders → HOLD');
  assert.equal(rNA.captures.brainArgs.length, 0, 'non-array: slotDirector 0');
  assert.equal(rNA.queueCalls, 0, 'non-array: queue 0');

  // ── P1-A authoritative-row presence: orders:[] / missing reaction / relabel / duplicate ──
  const badEmpty = () => ({ storyNote: 'x', orders: [], refShotAuthority: markedArtBrief(CH_REACT).refShotAuthority });
  const rE = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, deps: { artBriefBrain: badEmpty } });
  assert.equal(rE.s6.status, 'waiting', 'fresh orders:[] → HOLD');
  assert.equal(rE.job.dossier.artBrief, undefined, 'fresh orders:[]: ไม่ persist');
  assert.equal(rE.captures.brainArgs.length, 0, 'orders:[]: slotDirector 0');
  assert.equal(rE.queueCalls, 0, 'orders:[]: queue 0');
  const baseMiss = markedArtBrief(CH_REACT);
  const rMiss = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: { ...baseMiss, orders: baseMiss.orders.filter((o) => o.role !== 'reaction') } });
  assert.equal(rMiss.s6.status, 'waiting', 'missing expected reaction → HOLD');
  assert.equal(rMiss.captures.brainArgs.length, 0, 'missing reaction: slotDirector 0');
  const rRel = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: { ...baseMiss, orders: baseMiss.orders.map((o) => (o.role === 'reaction' ? { ...o, role: 'context' } : o)) } });
  assert.equal(rRel.s6.status, 'waiting', 'reaction relabel→context → HOLD');
  assert.equal(rRel.captures.brainArgs.length, 0, 'relabel: slotDirector 0');
  const rDup = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: { ...baseMiss, orders: [...baseMiss.orders, { ...baseMiss.orders.find((o) => o.role === 'reaction') }] } });
  assert.equal(rDup.s6.status, 'waiting', 'duplicate expected target row → HOLD');
  assert.equal(rDup.captures.brainArgs.length, 0, 'duplicate: slotDirector 0');

  // ── P1-B unsafe getter: throwing orders getter + throwing compass.mainCharacters getter → deterministic HOLD ──
  const mkOrdersGetter = () => {
    const o = { storyNote: 'x', refShotAuthority: markedArtBrief(CH_REACT).refShotAuthority };
    Object.defineProperty(o, 'orders', { get() { throw new Error('ORDERS_BOOM'); }, enumerable: true, configurable: true });
    return o;
  };
  const og1 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: mkOrdersGetter() });
  const og2 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: mkOrdersGetter() });
  assert.equal(og1.s6.status, 'waiting', 'orders getter throw → HOLD (ไม่หลุด s6)');
  assert.equal(og1.captures.brainArgs.length, 0, 'orders getter: slotDirector 0');
  assert.equal(og1.queueCalls, 0, 'orders getter: queue 0');
  assert.equal(og2.s6.summary, og1.s6.summary, 'orders getter: deterministic retry summary');
  const charsBoom = (job) => { Object.defineProperty(job.dossier.compass, 'mainCharacters', { get() { throw new Error('CHARS_BOOM'); }, configurable: true }); };
  const cg1 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: markedArtBrief(CH_REACT), mutateJob: charsBoom });
  const cg2 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: markedArtBrief(CH_REACT), mutateJob: charsBoom });
  assert.equal(cg1.s6.status, 'waiting', 'compass.mainCharacters getter throw → HOLD');
  assert.equal(cg1.captures.brainArgs.length, 0, 'compass getter: slotDirector 0');
  assert.equal(cg1.queueCalls, 0, 'compass getter: queue 0');
  assert.equal(cg2.s6.summary, cg1.s6.summary, 'compass getter: deterministic retry summary');

  // ── P1-C ambiguous short name: canonicalKnown null + marked resume HOLD; full unique short alias still passes ──
  const authAmb = templateV1PersonAuthority({ mainCharacters: [{ name: 'สมชาย ใจดี', role: 'hero' }, { name: 'สมชาย ใจร้าย', role: 'reaction' }] });
  assert.equal(authAmb.canonicalKnown('สมชาย'), null, 'ambiguous short "สมชาย" → canonicalKnown null');
  assert.equal(authAmb.canonicalKnown('สมชาย ใจดี'), 'สมชาย ใจดี', 'full name → unique canonical');
  const authUniq = templateV1PersonAuthority({ mainCharacters: [HERO_D, REACT_S] });
  assert.equal(authUniq.canonicalKnown('สรพงศ์'), 'สรพงศ์ ชาตรี', 'unique short alias → canonical (ยังผ่าน)');
  const CH_AMB = [{ name: 'สมชาย ใจดี', role: 'hero' }, { name: 'สมชาย ใจร้าย', role: 'reaction' }];
  const rAmb = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_AMB, preMarkArtBrief: markedWithHints(CH_AMB, { reaction: 'สมชาย' }) });
  assert.equal(rAmb.s6.status, 'waiting', 'ambiguous short hint on marked reaction → HOLD');
  assert.equal(rAmb.captures.brainArgs.length, 0, 'ambiguous: slotDirector 0');
});

await test('D3B3-C (Codex TOCTOU) validate-once→plain-snapshot→consume-snapshot: stateful getter/Proxy ห้ามหลอก contract/slotDirector', async () => {
  const reactI = markedArtBrief(CH_REACT).orders.find((o) => o.role === 'reaction').i; // canonical reaction index
  const heroI = markedArtBrief(CH_REACT).orders.find((o) => o.role === 'hero').i;
  const plainOrder = (extra) => ({ i: 0, role: 'x', want: 'w', shot: '', pos: '', emotion: '', faceSizePct: null, personHint: null, ...extra });

  // A) resumed order with stateful personHint GETTER (accessor: good→wrong) → HOLD (accessor rejected; never wrong person)
  const mkAccessor = () => {
    const ro = plainOrder({ i: reactI, role: 'reaction' }); delete ro.personHint;
    let n = 0;
    Object.defineProperty(ro, 'personHint', { get() { n++; return n === 1 ? 'สรพงศ์ ชาตรี' : 'ดวงเดือน'; }, enumerable: true, configurable: true });
    return { getterState: () => n, order: ro };
  };
  const a = mkAccessor();
  const abA = { ...markedArtBrief(CH_REACT), orders: markedArtBrief(CH_REACT).orders.map((o) => (o.role === 'reaction' ? a.order : o)) };
  const rA1 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: abA });
  const rA2 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: { ...markedArtBrief(CH_REACT), orders: markedArtBrief(CH_REACT).orders.map((o) => (o.role === 'reaction' ? mkAccessor().order : o)) } });
  assert.equal(rA1.s6.status, 'waiting', 'A stateful personHint getter → HOLD');
  assert.equal(rA1.captures.brainArgs.length, 0, 'A: slotDirector 0 (never reaches contract with wrong person)');
  assert.equal(a.getterState(), 0, 'A getter not executed (descriptor read only)');
  assert.equal(rA2.s6.summary, rA1.s6.summary, 'A deterministic retry summary');

  // A2) resumed order as Proxy with stateful getOwnPropertyDescriptor (good→wrong) → PASS via snapshot; downstream never re-reads Proxy
  const baseP = markedArtBrief(CH_REACT);
  const reactOrder = baseP.orders.find((o) => o.role === 'reaction');
  let gopd = 0;
  const ptarget = { ...reactOrder, personHint: 'สรพงศ์ ชาตรี' };
  const proxyOrder = new Proxy(ptarget, {
    getOwnPropertyDescriptor(t, k) {
      if (k === 'personHint') { gopd++; return { value: gopd === 1 ? 'สรพงศ์ ชาตรี' : 'ดวงเดือน', writable: true, enumerable: true, configurable: true }; }
      return Object.getOwnPropertyDescriptor(t, k);
    },
  });
  const abP = { ...baseP, orders: baseP.orders.map((o) => (o.role === 'reaction' ? proxyOrder : o)) };
  const rP = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: abP });
  assert.equal(rP.s6.status, 'done', 'A2 Proxy-data stateful → PASS via snapshot');
  const persistedReact = rP.job.dossier.artBrief.orders.find((o) => o.role === 'reaction');
  assert.equal(Object.getPrototypeOf(persistedReact), Object.prototype, 'A2 persisted reaction order = plain (ไม่ใช่ Proxy)');
  assert.equal(persistedReact.personHint, 'สรพงศ์ ชาตรี', 'A2 persisted personHint = canonical snapshot (ไม่ reread wrong)');
  assert.equal(gopd, 1, 'A2 Proxy personHint descriptor อ่านครั้งเดียว (downstream ใช้ snapshot)');
  const cP = buildRefSlotContract({ refDNA: DNA_ALPO, artBriefOrders: rP.job.dossier.artBrief.orders, mode: 'template_v1' });
  assert.equal(cP.slots.find((s) => s.refRole === 'reaction').wantPerson, 'สรพงศ์ ชาตรี', 'A2 contract wantPerson = canonical (never wrong)');
  assert.equal(String(rP.s6.dossierPatch.pickImages.slots.reaction?.id), 'P5', 'A2 reaction asset = P5 (correct person)');

  // B) fresh brain returns stateful personHint getter (good,good,wrong) → must not persist/consume wrong → HOLD
  const bBrain = () => {
    const ro = plainOrder({ i: reactI, role: 'reaction' }); delete ro.personHint;
    let n = 0;
    Object.defineProperty(ro, 'personHint', { get() { n++; return n <= 2 ? 'สรพงศ์ ชาตรี' : 'ดวงเดือน'; }, enumerable: true, configurable: true });
    return { storyNote: 'x', orders: [plainOrder({ i: heroI, role: 'hero', personHint: 'ดวงเดือน' }), ro], refShotAuthority: markedArtBrief(CH_REACT).refShotAuthority };
  };
  const rB = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, deps: { artBriefBrain: bBrain } });
  assert.equal(rB.s6.status, 'waiting', 'B fresh stateful personHint getter → HOLD');
  assert.equal(rB.job.dossier.artBrief, undefined, 'B fresh: ไม่ persist wrong');
  assert.equal(rB.captures.brainArgs.length, 0, 'B fresh: slotDirector 0');

  // C) stateful i GETTER (validate index 4 → contract index 99) → HOLD (accessor rejected; identity ไม่แตก)
  const cOrder = plainOrder({ role: 'reaction', personHint: 'สรพงศ์ ชาตรี' }); delete cOrder.i;
  let ic = 0;
  Object.defineProperty(cOrder, 'i', { get() { ic++; return ic === 1 ? reactI : 99; }, enumerable: true, configurable: true });
  const abC = { ...markedArtBrief(CH_REACT), orders: markedArtBrief(CH_REACT).orders.map((o) => (o.role === 'reaction' ? cOrder : o)) };
  const rC = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: abC });
  assert.equal(rC.s6.status, 'waiting', 'C stateful i getter → HOLD (no wrong/out-of-view target to slotDirector)');
  assert.equal(rC.captures.brainArgs.length, 0, 'C: slotDirector 0');

  // D) valid resume: prove persisted orders plain + contract wantPerson == validated snapshot canonical
  const rD = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: markedWithHints(CH_REACT, { reaction: 'สรพงศ์ ชาตรี' }) });
  assert.equal(rD.s6.status, 'done', 'D valid resume → done');
  for (const o of rD.job.dossier.artBrief.orders) {
    assert.equal(Object.getPrototypeOf(o), Object.prototype, 'D persisted order = plain');
    assert.ok(o.personHint == null || typeof o.personHint === 'string', 'D personHint = plain string/null');
  }
  const cD = buildRefSlotContract({ refDNA: DNA_ALPO, artBriefOrders: rD.job.dossier.artBrief.orders, mode: 'template_v1' });
  assert.equal(cD.slots.find((s) => s.refRole === 'reaction').wantPerson, 'สรพงศ์ ชาตรี', 'D contract wantPerson = snapshot canonical');
  assert.equal(cD.slots.find((s) => s.refRole === 'hero').wantPerson, 'ดวงเดือน', 'D contract hero wantPerson = snapshot canonical');
});

await test('D3B3-D (Codex) JSON-safe snapshot + whole-carrier: BigInt/NaN/Infinity HOLD (no serialize throw) · Proxy set-trap ไม่ถูกพึ่ง · brain/contract/patch = local snapshot', async () => {
  const base = markedArtBrief(CH_REACT);
  const reactIdx = base.orders.find((o) => o.role === 'reaction').i;
  const heroIdx = base.orders.find((o) => o.role === 'hero').i;
  const mkResume = (mut) => ({ ...base, orders: base.orders.map((o) => (o.role === 'reaction' ? mut({ ...o }) : o)) });
  // ── JSON-safe: extra BigInt field / personHint NaN / personHint Infinity → HOLD ก่อน contract/slotDirector/queue, no serialize throw ──
  for (const [name, mut] of [
    ['bigint', (o) => { o.extra = 10n; return o; }],
    ['NaN', (o) => { o.personHint = NaN; return o; }],
    ['Infinity', (o) => { o.personHint = Infinity; return o; }],
    ['undefined', (o) => { o.extra = undefined; return o; }], // ★ own enumerable undefined = HOLD (ห้าม silent drop)
  ]) {
    const r1 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: mkResume(mut) });
    const r2 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: mkResume(mut) });
    assert.equal(r1.s6.status, 'waiting', `${name} → HOLD`);
    assert.equal(r1.captures.brainArgs.length, 0, `${name}: slotDirector 0`);
    assert.equal(r1.queueCalls, 0, `${name}: queue 0`);
    assert.equal(r2.s6.summary, r1.s6.summary, `${name}: deterministic retry`);
    assert.doesNotThrow(() => JSON.stringify(r1.s6), `${name}: result JSON-safe (no serialize throw)`);
  }
  // ── whole-carrier Proxy: set-trap swallow บน orders + stateful orders descriptor (good→wrong) → ใช้ local snapshot, ไม่พึ่ง set ──
  const goodOrders = base.orders;
  const wrongOrders = base.orders.map((o) => (o.role === 'reaction' ? { ...o, personHint: 'ดวงเดือน' } : o));
  let setCalls = 0, ordersReads = 0;
  const artTarget = { storyNote: 'x', orders: goodOrders, refShotAuthority: base.refShotAuthority };
  const artProxy = new Proxy(artTarget, {
    set(t, k, v) { if (k === 'orders') { setCalls++; return true; } t[k] = v; return true; },
    getOwnPropertyDescriptor(t, k) {
      if (k === 'orders') { ordersReads++; return { value: ordersReads === 1 ? goodOrders : wrongOrders, writable: true, enumerable: true, configurable: true }; }
      return Object.getOwnPropertyDescriptor(t, k);
    },
  });
  const rP = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, preMarkArtBrief: artProxy });
  assert.equal(rP.s6.status, 'done', 'whole-carrier Proxy → done via local snapshot');
  assert.equal(setCalls, 0, 'ไม่พึ่ง set-trap (ไม่ mutate raw carrier)');
  assert.equal(ordersReads, 1, 'raw orders descriptor อ่านครั้งเดียว (downstream ใช้ local — ไม่ reread wrong)');
  const patchAB = rP.s6.dossierPatch.artBrief;
  assert.equal(Object.getPrototypeOf(patchAB), Object.prototype, 'dossierPatch.artBrief plain');
  assert.ok(patchAB.orders.every((o) => Object.getPrototypeOf(o) === Object.prototype), 'patch orders plain');
  assert.equal(patchAB.orders.find((o) => o.role === 'reaction').personHint, 'สรพงศ์ ชาตรี', 'patch reaction personHint = canonical (good snapshot)');
  const brainAB = rP.captures.brainArgs[0].artBrief;
  assert.equal(brainAB.orders.find((o) => o.role === 'reaction').personHint, 'สรพงศ์ ชาตรี', '_brainFn artBrief.orders = canonical snapshot (เดียวกับ contract intent)');
  assert.ok(brainAB.orders.every((o) => Object.getPrototypeOf(o) === Object.prototype), '_brainFn artBrief.orders plain');
  const cP = buildRefSlotContract({ refDNA: DNA_ALPO, artBriefOrders: patchAB.orders, mode: 'template_v1' });
  assert.equal(cP.slots.find((s) => s.refRole === 'reaction').wantPerson, 'สรพงศ์ ชาตรี', 'contract wantPerson = canonical (never wrong)');
  assert.equal(String(rP.s6.dossierPatch.pickImages.slots.reaction?.id), 'P5', 'reaction asset = P5 (correct person)');
  // ── fresh stateful Proxy order → persisted/contract/brain/patch = same canonical snapshot ──
  let fGopd = 0;
  const fReactTarget = { i: reactIdx, role: 'reaction', want: 'w', shot: '', pos: '', emotion: '', faceSizePct: null, personHint: 'สรพงศ์ ชาตรี' };
  const fProxy = new Proxy(fReactTarget, { getOwnPropertyDescriptor(t, k) { if (k === 'personHint') { fGopd++; return { value: fGopd === 1 ? 'สรพงศ์ ชาตรี' : 'ดวงเดือน', writable: true, enumerable: true, configurable: true }; } return Object.getOwnPropertyDescriptor(t, k); } });
  const fBrain = () => ({ storyNote: 'x', orders: [{ i: heroIdx, role: 'hero', want: 'w', shot: '', pos: '', emotion: '', faceSizePct: null, personHint: 'ดวงเดือน' }, fProxy], refShotAuthority: base.refShotAuthority });
  const rF = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: CH_REACT, deps: { artBriefBrain: fBrain } });
  assert.equal(rF.s6.status, 'done', 'fresh Proxy-data stateful → done via snapshot');
  assert.equal(fGopd, 1, 'fresh Proxy personHint อ่านครั้งเดียว');
  const fReact = rF.job.dossier.artBrief.orders.find((o) => o.role === 'reaction');
  assert.equal(Object.getPrototypeOf(fReact), Object.prototype, 'fresh persisted reaction plain');
  assert.equal(fReact.personHint, 'สรพงศ์ ชาตรี', 'fresh persisted personHint = canonical snapshot');
  assert.equal(rF.captures.brainArgs[0].artBrief.orders.find((o) => o.role === 'reaction').personHint, 'สรพงศ์ ชาตรี', 'fresh _brainFn artBrief = snapshot');
  const cF = buildRefSlotContract({ refDNA: DNA_ALPO, artBriefOrders: rF.s6.dossierPatch.artBrief.orders, mode: 'template_v1' });
  assert.equal(cF.slots.find((s) => s.refRole === 'reaction').wantPerson, 'สรพงศ์ ชาตรี', 'fresh contract wantPerson = canonical');
});

console.log(`1..${passed}`);

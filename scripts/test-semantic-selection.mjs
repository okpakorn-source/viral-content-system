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

const mkJob = ({ dna, orders = [], chars, storyTitle = 'ข่าวทดสอบ SEM-1' }) => ({
  dossier: {
    images: { caseId: 'SEM-TEST' },
    compass: { angle: 'มุมทดสอบ', primaryEmotion: 'warm', secondaryEmotions: [], mainCharacters: chars, visualDreamShots: [], doNotUse: [] },
    desk: { title: storyTitle },
    refMatch: { dna, styleName: 'ref-test', typeMatched: true, imagePath: '/ref-covers/test.jpg' },
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
    let s6, captures, job;
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
      await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL_A, brainAnswer: answerLegacy, captures }) });
    } finally { console.log = origLog; }
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
    const job = mkJob({ dna: DNA_ALPO, orders, chars: CHARS_A });
    const s6 = await s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    Object.assign(job.dossier, s6.dossierPatch);
    const s7 = await s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) });
    const rows = captures.payload.slotPlan.filter((p) => p.url === aliasUrl);
    assert.equal(rows.length, 1, 'alias URL ต้องเหลือ row เดียว deterministic');
    assert.equal(rows[0].backupForRefSlotId, 'context', 'owner แรกตาม slotOrder (context มาก่อน action)');
    // shadow SelectionSpec ห้ามรายงาน backup ซ้ำจาก URL เดียว (fix _seenBkUrl)
    const spec = s7.dossierPatch.cover.selectionSpec;
    assert.ok(spec, 'semantic ON + MEGA_SELECTION_SPEC=1 ต้องมี spec ใน dossier');
    const bkUrls = spec.slots[0].backups.map((b) => b.imageUrl);
    assert.equal(new Set(bkUrls).size, bkUrls.length, 'spec backups ห้ามมี URL ซ้ำ');
    const aliasEntries = spec.slots[0].backups.filter((b) => b.imageUrl === aliasUrl);
    assert.deepEqual(aliasEntries.map((b) => b.candidateId), ['A1'], 'candidateId แรกชนะ (A2 ต้องไม่โผล่)');
  });
});

console.log(`1..${passed}`);

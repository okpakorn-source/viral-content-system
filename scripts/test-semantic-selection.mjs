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
// callBrain: default = throw (การันตีไม่ยิง LLM ทุกเส้น) · delegate ให้ globalThis.__MEGA_AI ถ้าเทสฉีด fake deterministic
const AI_STUB = 'data:text/javascript,' + encodeURIComponent(
  'export function callBrain(a){ if (globalThis.__MEGA_AI) return globalThis.__MEGA_AI(a); throw new Error("LLM_FORBIDDEN_IN_TEST"); }'
);
// 🔎 PHASE 2B1 — stub 5 โมดูลค้น/คลัง + next/server (delegate ให้ globalThis.__MEGA_SP ที่เทสตั้งต่อเคส)
//   blast radius = 0: โมดูล import ระดับบนของ s6/s7 (megaBrains/coverQcGate/imageQualityConfig/refSlotContract) ไม่แตะ 5 ตัวนี้
//   (import จริงเป็น dynamic ใน s5_profile/s5_gapsearch เท่านั้น) · เทสเดิม 117 ตัวไม่โหลด 5 ตัวนี้ → พฤติกรรมเดิมทุก byte
const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const STUB_IMAGESEARCH = _mod(`
export const PLATFORMS = ['google','google_news','facebook','tiktok','youtube'];
export function buildQueries(kw, maxQ){ const f = globalThis.__MEGA_SP; return f && f.buildQueries ? f.buildQueries(kw, maxQ) : ['q1','q2']; }
export async function searchImages(platform, q, opts){ return globalThis.__MEGA_SP.searchImages(platform, q, opts); }
export async function instagramProfile(){ return { images: [] }; }
export async function facebookProfile(){ return { images: [] }; }
`);
const STUB_TRIAGE = _mod('export async function vetImages(a){ return globalThis.__MEGA_SP.vetImages(a); }');
const STUB_STORE = _mod(`
export async function addImages(caseId, imgs){ return globalThis.__MEGA_SP.addImages(caseId, imgs); }
export async function readImages(caseId){ const f = globalThis.__MEGA_SP; return f && f.readImages ? f.readImages(caseId) : []; }
`);
const STUB_CASE = _mod('export async function getCase(id){ return globalThis.__MEGA_SP.getCase(id); }');
const STUB_JUNK = _mod(`
export function isCatalogSource(x){ const f = globalThis.__MEGA_SP; return f && f.isCatalogSource ? !!f.isCatalogSource(x) : false; }
export function isOwnPageSource(x){ const f = globalThis.__MEGA_SP; return f && f.isOwnPageSource ? !!f.isOwnPageSource(x) : false; }
export function isMismatchedFbMedia(x){ const f = globalThis.__MEGA_SP; return f && f.isMismatchedFbMedia ? !!f.isMismatchedFbMedia(x) : false; }
`);
// next/server stub — NextResponse.json คืน object อ่านง่าย (ไม่ผูก Next runtime) · ไม่มี lib ที่เทสโหลดใช้ next/server (verified)
const STUB_NEXT = _mod('export const NextResponse = { json: (obj, init) => ({ _body: obj, _status: (init && init.status) || 200, status: (init && init.status) || 200, json: async () => obj }) };');
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/aiClient') return { url: ${JSON.stringify(AI_STUB)}, shortCircuit: true };
  if (specifier === '@/lib/imageSearch') return { url: ${JSON.stringify(STUB_IMAGESEARCH)}, shortCircuit: true };
  if (specifier === '@/lib/libraryTriage') return { url: ${JSON.stringify(STUB_TRIAGE)}, shortCircuit: true };
  if (specifier === '@/lib/imageStore') return { url: ${JSON.stringify(STUB_STORE)}, shortCircuit: true };
  if (specifier === '@/lib/caseStore') return { url: ${JSON.stringify(STUB_CASE)}, shortCircuit: true };
  if (specifier === '@/lib/junkSources') return { url: ${JSON.stringify(STUB_JUNK)}, shortCircuit: true };
  if (specifier === 'next/server') return { url: ${JSON.stringify(STUB_NEXT)}, shortCircuit: true };
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
// 🔎 PHASE 2B1 — pin ambient module-level/call-time switches ก่อน import (determinism · ไม่พึ่ง ambient env)
process.env.IMG_GAP_SEARCH = '1';    // GAP_SEARCH_ON (module const megaAdapters)
process.env.SEARCH_VET = '1';        // VET ON (call-time route.js)
process.env.SEARCH_VET_STRICT = '1'; // strict vet ON (call-time)
process.env.PRE_VET_DEDUP = '1';     // pre-vet dedup ON (call-time)
process.env.IMG_QUERY_CONC = '4';    // QUERY_CONC (module const route.js) — wave size
process.env.IMAGES_PER_QUERY = '20'; // PER_QUERY (module const route.js)
process.env.IMAGES_HARD_CAP = '120'; // HARD_CAP (module const route.js)
process.env.IMG_STORY_QUERIES = '1'; // STORY_QUERIES_ON (module const route.js)
process.env.MEGA_SEARCH_INITIAL_BATCH = '4'; // SEARCH_INITIAL_BATCH (module const megaAdapters)
process.env.MEGA_MIN_RELEVANT_IMAGES = '8';  // MIN_RELEVANT_IMAGES (module const megaAdapters)
process.env.MEGA_YT_PARALLEL = '0';          // YT_PARALLEL off — กัน YT fire ใน s5_search (offline)
process.env.MEGA_HERO_GRADE_HARD = '0';      // HERO_GRADE_HARD_ON off — gap คืน baseResult ตรงๆ (deterministic)
delete process.env.MEGA_SEARCH_PROVENANCE; // เริ่มสะอาด — เทสตั้ง/คืนเองต่อเคส
delete process.env.MEGA_SEARCH_SHADOW_V2;  // 🔎 V2 ambient cleanup ก่อน import (deterministic)

const { s6_slots, s7_cover, s5_search, s5_gapsearch } = await import('../src/lib/megaAdapters.js');
const { slotDirectorBrain, artBriefBrain, templateV1PersonAuthority } = await import('../src/lib/megaBrains.js');
const { buildRefSlotContract, validateStrictRenderActivation, resolveRefSlotView } = await import('../src/lib/refSlotContract.js');
// 🔎 PHASE 2B1 — route POST เป็น production wrapper (import stubs ผ่าน loader ข้างบน) + pure helper _searchProvenance
const { POST: searchPOST, _searchProvenance, _sanitizeSearchShadowV2, _buildSearchShadowV2, _buildSearchShadowV2FromSaved } = await import('../src/app/api/images/search/route.js');

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
const runStrictFlow = async ({ s7Env = SEM_ON, deps = null, mutateAfterS6 = null, mutateBeforeS6 = null } = {}) => {
  const captures = { brainArgs: [], fetches: [], payload: null, rawBody: null };
  const job = mkJob({ dna: DNA_ALPO, orders: ORDERS_ALPO, chars: CHARS_A, refId: REF_ID_C });
  if (mutateBeforeS6) mutateBeforeS6(job); // ★ test-only: seed dossier ก่อน S6 (default null = พฤติกรรมเดิมเป๊ะ)
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
  // #3 (D3-B4 case 2) no explicit reaction + exactly ONE distinct non-hero (related สรพงศ์) → reaction override to สรพงศ์
  //   แม้ LLM ให้ hero hint (poison) — ตัวตน non-hero หนึ่งเดียวชนะ (เคส AC-0066)
  assert.equal(hintOf((await briefWith([HERO_D, REL_S], { reaction: 'ดวงเดือน' })).out, 'reaction'), 'สรพงศ์ ชาตรี', '#3 one non-hero → reaction=สรพงศ์');
  // #4 (D3-B4 case 3) only hero (zero non-hero): known same-hero remains · unknown → null (never invent)
  assert.equal((templateV1PersonAuthority({ mainCharacters: [HERO_D] })).reaction, null, '#4 zero non-hero → reactionName null (no forced)');
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

  // zero non-hero (only hero, case 3) + persisted known hero → PASS same-hero (reaches slotDirector, not HELD)
  const r8 = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: [HERO_D], preMarkArtBrief: markedWithHints([HERO_D], { reaction: 'ดวงเดือน' }) });
  assert.ok(r8.captures.brainArgs.length >= 1, 'same-hero (zero non-hero) → ผ่าน validation ถึง slotDirector');

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

await test('D3B4 (Codex) reaction authority matrix: case2 one-nonhero (AC-0066: related สรพงศ์ → reaction+asset P5+strict) · case1/3/4 gates · alias/bridge · determinism', async () => {
  const A = (chars) => templateV1PersonAuthority({ mainCharacters: chars });
  const MANOP = { name: 'มานพ ทองดี', role: 'context' };
  const MULTI = [HERO_D, REL_S, MANOP]; // hero + 2 distinct non-hero (case 4)
  // ── helper matrix (deterministic) ──
  assert.equal(A([HERO_D, { name: 'สรพงศ์ ชาตรี', role: 'reaction' }, MANOP]).reaction, 'สรพงศ์ ชาตรี', 'case1 explicit reaction precedence (แม้มี non-hero อื่น)');
  assert.equal(A([HERO_D, REL_S]).reaction, 'สรพงศ์ ชาตรี', 'case2 exactly-one non-hero (related) → reactionName');
  assert.equal(A([HERO_D]).reaction, null, 'case3 zero non-hero → null');
  assert.equal(A(MULTI).reaction, null, 'case4 >1 non-hero → null (no forced/array-first)');
  const authM = A(MULTI);
  assert.equal(authM.resolveHint('reaction', 'สรพงศ์'), 'สรพงศ์ ชาตรี', 'case4 unique non-hero (alias) → resolves full');
  assert.equal(authM.resolveHint('reaction', 'มานพ'), 'มานพ ทองดี', 'case4 other unique non-hero → resolves');
  assert.equal(authM.resolveHint('reaction', 'ดวงเดือน'), null, 'case4 hero hint → null (unresolved)');
  assert.equal(authM.resolveHint('reaction', 'คนแปลก'), null, 'case4 unknown → null');
  assert.equal(authM.resolveHint('reaction', null), null, 'case4 null → null');
  // alias dedup: [related สรพงศ์, related สรพงศ์ ชาตรี] collapse → one identity (full spelling) → case2
  assert.equal(A([HERO_D, { name: 'สรพงศ์', role: 'related' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }]).reaction, 'สรพงศ์ ชาตรี', 'alias dup collapse → one non-hero (full spelling)');
  // bridging short alias matches 2 distinct non-hero → ambiguous → null
  const authBridge = A([HERO_D, { name: 'สมชาย ใจดี', role: 'related' }, { name: 'สมชาย ใจร้าย', role: 'related' }]);
  assert.equal(authBridge.reaction, null, 'bridge: 2 non-hero → reactionName null');
  assert.equal(authBridge.resolveHint('reaction', 'สมชาย'), null, 'bridge: short alias matches 2 → ambiguous null');
  assert.equal(authBridge.resolveHint('reaction', 'สมชาย ใจดี'), 'สมชาย ใจดี', 'bridge: full name → unique resolves');
  // parenthetical hero alias excluded from non-hero set
  assert.equal(A([{ name: 'จุน วนวิทย์ (อากงจุน)', role: 'hero' }, { name: 'อากงจุน', role: 'related' }, { name: 'สมพร ใจดี', role: 'related' }]).reaction, 'สมพร ใจดี', 'parenthetical hero alias excluded → other non-hero');

  // ── case 2 AC-0066 full flow (S6+S7): related สรพงศ์, LLM poison hero → reaction=สรพงศ์, wantPerson=สรพงศ์, asset P5, strict binding ──
  const poisonCb = async (args) => {
    const rows = JSON.parse(args.user.split('\n').pop());
    return { text: JSON.stringify({ orders: rows.map((r) => ({ i: r.i, want: 'w', personHint: r.role === 'reaction' ? 'ดวงเดือน' : null })), storyNote: 'n' }) };
  };
  const mkSel = () => runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, chars: [HERO_D, REL_S], deps: { artBriefBrain: async (a) => artBriefBrain({ ...a, _callBrain: poisonCb }) } });
  const sel = await mkSel();
  assert.equal(sel.s6.status, 'done', 'case2 S6 done');
  assert.equal(sel.s7.status, 'done', 'case2 S7 done (strict wire)');
  assert.equal(hintOf(sel.job.dossier.artBrief, 'reaction'), 'สรพงศ์ ชาตรี', 'case2 persisted reaction = สรพงศ์ (override hero poison)');
  const cSel = buildRefSlotContract({ refDNA: DNA_ALPO, artBriefOrders: sel.job.dossier.artBrief.orders, mode: 'template_v1' });
  assert.equal(cSel.slots.find((s) => s.refRole === 'reaction').wantPerson, 'สรพงศ์ ชาตรี', 'case2 contract wantPerson = สรพงศ์');
  assert.equal(String(sel.s6.dossierPatch.pickImages.slots.reaction?.id), 'P5', 'case2 S6 reaction asset = P5 (secondary)');
  // ── P1-4: exact URL chain S6 == unique slotPlan reaction row == SelectionSpec primary + strict consumer accepts ──
  const spec = sel.captures.payload.selectionSpec;
  const s6React = sel.s6.dossierPatch.pickImages.slots.reaction;
  const specReact = spec.slots.find((s) => s.refSlotId === 'reaction');
  const planReact = (sel.captures.payload.slotPlan || []).filter((p) => p.refSlotId === 'reaction');
  assert.equal(planReact.length, 1, 'P1-4 unique reaction slotPlan row (refSlotId=reaction)');
  assert.equal(String(s6React.id), 'P5', 'P1-4 S6 reaction candidate = P5 (secondary)');
  assert.equal(String(specReact.primary.candidateId), String(s6React.id), 'P1-4 SelectionSpec candidateId == S6 reaction id');
  assert.equal(specReact.primary.imageUrl, s6React.imageUrl, 'P1-4 SelectionSpec imageUrl == S6 reaction imageUrl');
  assert.equal(planReact[0].url, s6React.imageUrl, 'P1-4 slotPlan reaction url == S6 reaction imageUrl');
  const dec = validateStrictRenderActivation({ selectionSpec: spec, realizedTemplate: sel.captures.payload.realizedTemplate });
  assert.equal(dec.decision, 'strict_ready', 'P1-4 strict consumer accepts spec (strict_ready, no legacy fallback)');
  // NOTE: strict-manifest / no-later-change (Eye/QC) สงวนพิสูจน์ที่ isolated canary gate — unit นี้ไม่ compose (ไม่แตะ consumer/composer)
  // ── P1-3: real fresh→resume — RUN2 ใช้ structuredClone ของ artBrief ที่ RUN1 persist ผ่าน resume path (S6 result เดิม) ──
  const clonedAB = structuredClone(sel.job.dossier.artBrief);
  const run2 = await runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, chars: [HERO_D, REL_S], preMarkArtBrief: clonedAB });
  assert.equal(run2.s6.status, 'done', 'P1-3 resume S6 done');
  assert.deepStrictEqual(run2.job.dossier.artBrief, sel.job.dossier.artBrief, 'P1-3 persisted artBrief identical (fresh→resume)');
  assert.deepStrictEqual(run2.s6.dossierPatch.pickImages, sel.s6.dossierPatch.pickImages, 'P1-3 pickImages identical');
  assert.equal(run2.captures.rawBody, sel.captures.rawBody, 'P1-3 rawBody byte-identical');
  const spec2 = run2.captures.payload.selectionSpec;
  assert.equal(spec2.specHash, spec.specHash, 'P1-3 specHash identical');
  assert.equal(spec2.replayHash, spec.replayHash, 'P1-3 replayHash identical');
  assert.equal(run2.captures.brainArgs.length, sel.captures.brainArgs.length, 'P1-3 slotDirector call count identical');

  // ── resume gates ──
  const g4a = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: MULTI, preMarkArtBrief: markedWithHints(MULTI, { reaction: 'ดวงเดือน' }) });
  const g4b = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: MULTI, preMarkArtBrief: markedWithHints(MULTI, { reaction: 'ดวงเดือน' }) });
  assert.equal(g4a.s6.status, 'waiting', 'case4 hero hint → HOLD (point 6 unresolved)');
  assert.equal(g4a.captures.brainArgs.length, 0, 'case4 hero: slotDirector 0');
  assert.equal(g4a.queueCalls, 0, 'case4 hero: queue 0');
  assert.equal(g4b.s6.summary, g4a.s6.summary, 'case4 deterministic summary');
  const g4ok = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: MULTI, preMarkArtBrief: markedWithHints(MULTI, { reaction: 'มานพ ทองดี' }) });
  assert.ok(g4ok.captures.brainArgs.length >= 1, 'case4 unique non-hero hint → PASS');
  const g3n = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: [HERO_D], preMarkArtBrief: markedWithHints([HERO_D], { reaction: null }) });
  assert.equal(g3n.s6.status, 'waiting', 'case3 null reaction → HOLD (point 6)');
  assert.equal(g3n.captures.brainArgs.length, 0, 'case3 null: slotDirector 0');

  // ── reaction-only non-null: hero/main null retains prior semantics; reaction null waits ──
  // template ที่มี target = hero เท่านั้น (ไม่มี reaction) + compass ว่าง (ไม่มีตัวตน hero) → hero personHint null = valid (prior)
  const DNA_HERO_ONLY = { template: { slots: [
    { role: 'hero', shape: 'rect', xPct: 0, yPct: 0, wPct: 50, hPct: 50, shot: 'closeup' },
    { role: 'context', shape: 'rect', xPct: 50, yPct: 0, wPct: 50, hPct: 50, shot: 'wide' },
    { role: 'action', shape: 'rect', xPct: 0, yPct: 50, wPct: 50, hPct: 50, shot: 'medium' },
  ] }, slots: [{ role: 'hero' }, { role: 'context' }, { role: 'action' }] };
  const abHeroNull = artBriefFake({ refDNA: DNA_HERO_ONLY, compass: { mainCharacters: [] }, mode: 'template_v1' });
  const rHeroNull = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: [], dna: DNA_HERO_ONLY, preMarkArtBrief: abHeroNull });
  assert.ok(!(rHeroNull.s6.status === 'waiting' && /ตัวตนข่าวปัจจุบัน/.test(String(rHeroNull.s6.summary))), 'hero null + no hero identity (expected null) → NOT person-HOLD (prior semantics retained)');
  // PERSON_DNA มี reaction target + compass ว่าง → hero null ผ่าน (prior) แต่ reaction null = person-HOLD (reaction-only rule)
  const abReactNull = artBriefFake({ refDNA: PERSON_DNA, compass: { mainCharacters: [] }, mode: 'template_v1' });
  const rReactNull = await runRefShotFlow({ s6Env: REFSHOT_S6, chars: [], dna: PERSON_DNA, preMarkArtBrief: abReactNull });
  assert.equal(rReactNull.s6.status, 'waiting', 'reaction null → HOLD');
  assert.ok(/ตัวตนข่าวปัจจุบัน/.test(String(rReactNull.s6.summary)), 'reaction null → person-authority HOLD (reaction-only non-null)');
  assert.equal(rReactNull.captures.brainArgs.length, 0, 'reaction null: slotDirector 0');
});

await test('D3B4-B (Codex) P1-1 order-independent grouping (non-transitive bridge) + P1-2 production prompt authority/candidates', async () => {
  const A2 = (chars) => templateV1PersonAuthority({ mainCharacters: chars });
  const H = { name: 'ดวงเดือน', role: 'hero' };
  const A = { name: 'สมชาย ใจดี', role: 'related' };
  const B = { name: 'สมชาย ใจดี ใจร้าย', role: 'related' };
  const C = { name: 'สมชาย ใจร้าย', role: 'related' };
  // sanity: A~B, B~C, A≁C (non-transitive)
  assert.ok(A2([]).nameMatch(A.name, B.name) && A2([]).nameMatch(B.name, C.name) && !A2([]).nameMatch(A.name, C.name), 'P1-1 setup: A~B~C, A≁C');
  // permutations of [H,A,B,C] must all resolve identically → ambiguous bridge, reaction null (order-independent)
  for (const perm of [[H, A, B, C], [H, A, C, B], [H, B, A, C], [H, C, B, A], [H, B, C, A], [H, C, A, B]]) {
    const au = A2(perm);
    assert.equal(au.reaction, null, 'P1-1 A/B/C bridge → reaction null (any order)');
    assert.equal(au.ambiguousNonHero, true, 'P1-1 A/B/C → ambiguousNonHero true');
    assert.deepStrictEqual(au.distinctNonHero, [], 'P1-1 non-clique component → no valid non-hero identity');
    assert.equal(au.resolveHint('reaction', 'สมชาย'), null, 'P1-1 bridge short hint → null');
  }
  // ambiguous short hero: hero name bridges two distinct non-heroes → heroAmbiguous, reaction not forced
  const auAH = A2([{ name: 'สมชาย', role: 'hero' }, A, C]);
  assert.equal(auAH.heroAmbiguous, true, 'P1-1 ambiguous short hero → heroAmbiguous');
  assert.equal(auAH.reaction, null, 'P1-1 ambiguous hero → reaction null (not forced)');
  // short explicit reaction + full alias elsewhere → one identity, full canonical spelling
  assert.equal(A2([H, { name: 'สรพงศ์', role: 'reaction' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }]).reaction, 'สรพงศ์ ชาตรี', 'P1-1 short explicit reaction + full alias → full canonical');

  // ── P1-2: production-style mock reads prompt (currentPersonAuthority/candidates) — zero & multi cases ──
  const callWith = async (chars) => {
    const cap = {};
    const cb = async (a) => {
      const rows = JSON.parse(a.user.split('\n').pop());
      cap.rows = rows;
      return { text: JSON.stringify({ orders: rows.map((row) => {
        let ph = null;
        if (row.currentPersonAuthority != null) ph = row.currentPersonAuthority; // authority ไม่ว่าง → ใช้เป๊ะ
        else if (row.role === 'reaction' && Array.isArray(row.currentPersonCandidates) && row.currentPersonCandidates.length) ph = row.currentPersonCandidates[0]; // เลือก candidate ตามบริบท
        return { i: row.i, want: 'w', personHint: ph };
      }), storyNote: 'n' }) };
    };
    const out = await artBriefBrain({ refDNA: PERSON_DNA, compass: { angle: 'a', mainCharacters: chars }, deskTitle: 'T', typeMatched: true, mode: 'template_v1', _callBrain: cb });
    return { out, rows: cap.rows };
  };
  // zero non-hero (only hero): reaction prompt authority=hero → mock uses it → resolved non-null (same-hero)
  const z = await callWith([H]);
  const zR = z.rows.find((r) => r.role === 'reaction');
  assert.equal(zR.currentPersonAuthority, 'ดวงเดือน', 'P1-2 zero: reaction prompt authority = hero (deterministic)');
  assert.deepStrictEqual(zR.currentPersonCandidates, ['ดวงเดือน'], 'P1-2 zero: candidates = [hero]');
  assert.equal(hintOf(z.out, 'reaction'), 'ดวงเดือน', 'P1-2 zero: mock follows authority → reaction resolved (not null)');
  // multi non-hero: reaction authority null + explicit candidates → mock selects exactly one → resolved non-null, never hero
  const m = await callWith([H, { name: 'สรพงศ์ ชาตรี', role: 'related' }, { name: 'มานพ ทองดี', role: 'context' }]);
  const mR = m.rows.find((r) => r.role === 'reaction');
  assert.equal(mR.currentPersonAuthority, null, 'P1-2 multi: reaction prompt authority = null');
  assert.deepStrictEqual([...mR.currentPersonCandidates].sort(), ['มานพ ทองดี', 'สรพงศ์ ชาตรี'].sort(), 'P1-2 multi: candidates = valid non-heroes');
  assert.ok(mR.currentPersonCandidates.includes(hintOf(m.out, 'reaction')), 'P1-2 multi: mock selects one candidate → reaction ∈ candidates');
  assert.notEqual(hintOf(m.out, 'reaction'), 'ดวงเดือน', 'P1-2 multi: reaction never hero (never refSubject)');

  // ── P1-A: authority ambiguity → HOLD even with an independent valid reaction candidate ──
  const MANOP2 = { name: 'มานพ ทองดี', role: 'related' };
  const mkAmb = (chars, hint) => runRefShotFlow({ s6Env: REFSHOT_S6, chars, preMarkArtBrief: markedWithHints(chars, { reaction: hint }) });
  const HERO_BRIDGE = [{ name: 'สมชาย', role: 'hero' }, A, C, MANOP2]; // hero 'สมชาย' bridges A,C → ambiguous · มานพ independent valid
  assert.equal(A2(HERO_BRIDGE).authorityReady, false, 'P1-A hero bridge → authorityReady false');
  const pa1a = await mkAmb(HERO_BRIDGE, 'มานพ ทองดี');
  const pa1b = await mkAmb(HERO_BRIDGE, 'มานพ ทองดี');
  assert.equal(pa1a.s6.status, 'waiting', 'P1-A hero-ambiguous + valid candidate → HOLD');
  assert.equal(pa1a.captures.brainArgs.length, 0, 'P1-A hero-amb: slotDirector 0');
  assert.equal(pa1a.queueCalls, 0, 'P1-A hero-amb: queue 0');
  assert.equal(pa1b.s6.summary, pa1a.s6.summary, 'P1-A hero-amb deterministic');
  const NONHERO_BRIDGE = [H, A, B, C, MANOP2]; // A,B,C non-hero bridge (ambiguous) + independent valid มานพ
  assert.equal(A2(NONHERO_BRIDGE).authorityReady, false, 'P1-A nonhero bridge → authorityReady false');
  const pa2 = await mkAmb(NONHERO_BRIDGE, 'มานพ ทองดี');
  assert.equal(pa2.s6.status, 'waiting', 'P1-A nonhero-ambiguous + valid candidate → HOLD');
  assert.equal(pa2.captures.brainArgs.length, 0, 'P1-A nonhero-amb: slotDirector 0');
  assert.equal(pa2.queueCalls, 0, 'P1-A nonhero-amb: queue 0');

  // ── P1-B: candidate order canonical + permutation-invariant (candidates / prompt bytes / flow) ──
  const permsMulti = [
    [H, { name: 'สรพงศ์ ชาตรี', role: 'related' }, { name: 'มานพ ทองดี', role: 'context' }],
    [{ name: 'มานพ ทองดี', role: 'context' }, H, { name: 'สรพงศ์ ชาตรี', role: 'related' }],
    [{ name: 'สรพงศ์ ชาตรี', role: 'related' }, { name: 'มานพ ทองดี', role: 'context' }, H],
  ];
  const expectedCands = A2(permsMulti[0]).reactionCandidates;
  assert.equal(expectedCands.length, 2, 'P1-B two candidates');
  for (const p of permsMulti) {
    assert.deepStrictEqual(A2(p).reactionCandidates, expectedCands, 'P1-B reactionCandidates canonical order (permutation-invariant)');
    const pr = (await callWith(p)).rows.find((r) => r.role === 'reaction');
    assert.deepStrictEqual(pr.currentPersonCandidates, expectedCands, 'P1-B prompt reaction candidates identical bytes (any order)');
  }
  // flow determinism (case-2 forced) across compass permutation → persisted/pickImages/rawBody/spec identical
  const poison = async (args) => { const rows = JSON.parse(args.user.split('\n').pop()); return { text: JSON.stringify({ orders: rows.map((r) => ({ i: r.i, want: 'w', personHint: r.role === 'reaction' ? 'ดวงเดือน' : null })), storyNote: 'n' }) }; };
  const runPerm = (chars) => runRefShotFlow({ s6Env: REFSHOT_S6, s7Env: REFSHOT_ALL, chars, deps: { artBriefBrain: async (a) => artBriefBrain({ ...a, _callBrain: poison }) } });
  const f1 = await runPerm([HERO_D, REL_S]);
  const f2 = await runPerm([REL_S, HERO_D]);
  assert.deepStrictEqual(f2.job.dossier.artBrief, f1.job.dossier.artBrief, 'P1-B flow: persisted artBrief permutation-identical');
  assert.deepStrictEqual(f2.s6.dossierPatch.pickImages, f1.s6.dossierPatch.pickImages, 'P1-B flow: pickImages identical');
  assert.equal(f2.captures.rawBody, f1.captures.rawBody, 'P1-B flow: rawBody identical');
  assert.equal(f2.captures.payload.selectionSpec.specHash, f1.captures.payload.selectionSpec.specHash, 'P1-B flow: specHash identical');
  assert.equal(f2.captures.payload.selectionSpec.replayHash, f1.captures.payload.selectionSpec.replayHash, 'P1-B flow: replayHash identical');
});

// ============================================================
// 🧾 R1 — SHADOW CANDIDATE LEDGER (diagnostic-only) · kill switch MEGA_CANDIDATE_LEDGER=1
//   ตรวจ: OFF parity · ON non-interference (pickImages/rawBody เท่าเดิม) · determinism · cap/size/redaction ·
//   unknown-stays-unknown · reason enum · selected ตรึงนอก cap · fresh→resume byte เดิม + S7 ไม่เขียนทับ ·
//   matchKind token_fallback (วงเล็บ) · collision → ambiguous (ห้ามฟันธง exact)
// ============================================================
const withLedger = async (on, fn) => {
  if (on) process.env.MEGA_CANDIDATE_LEDGER = '1'; else delete process.env.MEGA_CANDIDATE_LEDGER;
  try { return await fn(); } finally { delete process.env.MEGA_CANDIDATE_LEDGER; }
};
const withSharpGate = async (on, fn) => { // on=default(gate on) · off = MEGA_SHARPNESS_GATE=0 (ledger อ่าน call-time)
  const prev = process.env.MEGA_SHARPNESS_GATE;
  if (on) delete process.env.MEGA_SHARPNESS_GATE; else process.env.MEGA_SHARPNESS_GATE = '0';
  try { return await fn(); } finally { if (prev === undefined) delete process.env.MEGA_SHARPNESS_GATE; else process.env.MEGA_SHARPNESS_GATE = prev; }
};
// faceArea → faceBox {w:area,h:1} (พื้นที่ = area) · dims = [realW,realH] (คุม orient/heroGrade)
const LIMG = (id, person, faceArea, cat, dims, extra = {}) => IMG(
  id,
  { person, category: cat, faceCount: person ? 1 : 0, faceBox: faceArea ? { w: faceArea, h: 1 } : undefined, note: `${id} scene`, ...extra },
  dims ? { realWidth: dims[0], realHeight: dims[1], width: dims[0], height: dims[1] } : {},
);
// AC-0066-shaped: hero ดวงเดือน หน้าเล็ก (−311) ถูกเลือก ทั้งที่ −29/−41 หน้าใหญ่กว่า
const AC_POOL = [
  LIMG('AC-311', 'ดวงเดือน', 0.014, 'context', [1224, 1712]),
  LIMG('AC-29', 'ดวงเดือน', 0.084, 'context', [720, 960]),
  LIMG('AC-41', 'ดวงเดือน', 0.068, 'face-emotional', [800, 1200]),
  LIMG('AC-125', 'สรพงศ์ ชาตรี', 0.203, 'face-emotional', [1200, 735]),
  LIMG('AC-45', 'สรพงศ์ ชาตรี', 0.03, 'context', [540, 720]),
  LIMG('AC-57', null, 0, 'context', [5472, 3078]),
  LIMG('AC-26', 'ดวงเดือน', 0.005, 'context', [800, 533]),
];
const AC_ANSWER = {
  hero: { id: 'AC-311', reason: 'ตัวเอก', backups: ['AC-29'] },
  reaction: { id: 'AC-125', reason: 'สรพงศ์', backups: [] },
  action: { id: 'AC-26', reason: 'act', backups: [] },
  context: { id: 'AC-57', reason: 'วิหาร', backups: [] },
  circle: { id: 'AC-45', reason: 'วง', backups: [] },
};
const R1_CHARS = [{ name: 'ดวงเดือน', role: 'hero' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }];
const REASON_ENUM = new Set(['SELECTED', 'ELIGIBLE', 'REJECT_IRRELEVANT', 'REJECT_DIRTY', 'REJECT_PERSON_MISS', 'REJECT_PERSON_AMBIGUOUS', 'REJECT_FACE_NONE', 'REJECT_MULTIFACE', 'REJECT_THUMBNAIL', 'REJECT_UNDERSIZE', 'REJECT_SHARPNESS', 'METADATA_INSUFFICIENT']);
const MATCHKIND_ENUM = new Set(['exact', 'alias', 'token_fallback', 'ambiguous', 'miss', null]);
const META_ENUM = new Set(['OK', 'METADATA_INSUFFICIENT']);

const runR1S6 = async (on, { chars, pool, answer }) => {
  const captures = { brainArgs: [], fetches: [], payload: null };
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars });
  const s6 = await withLedger(on, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) }));
  return { job, s6, captures };
};
const runR1Full = async (on, { chars, pool, answer }) => {
  const captures = { brainArgs: [], fetches: [], payload: null };
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars });
  const s6 = await withLedger(on, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) }));
  Object.assign(job.dossier, s6.dossierPatch);
  const s7 = await withLedger(on, () => s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool, brainAnswer: answer, captures }) }));
  return { job, s6, s7, captures };
};
const ledgerOf = (s6) => s6.dossierPatch.images?.candidateLedger;

const allRows = (L) => L.roles.flatMap((r) => r.rows);
const findRow = (L, id, pred = () => true) => { for (const r of L.roles) for (const x of r.rows) if (x.id === id && pred(x, r)) return x; return null; };
// ── shared full-row/role/carrier helpers matching production output (ทุก fixed field) — ใช้ทุก hand-authored v1 fixture ──
// production-possible default: hero role · target ดวงเดือน · evidence complete → OK, no unknownFields · hero ELIGIBLE ⟹ heroGrade true + dims short>=700
const fullRow = (over = {}) => ({ id: 'A', person: 'ดวงเดือน', matchKind: 'exact', metadataState: 'OK', faceFrac: 0.3, dims: '1000x1000', measuredFrom: null, orient: null, clean: true, largeText: null, watermark: null, newsScene: null, faceCount: 1, quality: null, pHash: null, heroGrade: true, reason: 'ELIGIBLE', selected: false, estimatedUpscale: null, ...over });
const fullRole = (over = {}) => ({ role: 'hero', slotId: 'hero', targetPerson: 'ดวงเดือน', targetSource: 'compass_hero', selectedId: null, totalRows: 1, keptRows: 1, droppedRows: 0, reasonCounts: { ELIGIBLE: 1 }, rows: [fullRow()], ...over });
const fullCarrier = (over = {}) => ({ v: 1, poolSize: 1, capped: false, droppedRows: 0, roles: [fullRole()], ...over });
const cjson = (o) => JSON.parse(JSON.stringify(o)); // deep clone fixture

await test('R1: FRESH OFF absent — ไม่มี candidateLedger field เลย (quarantine images มีได้ตามเดิม)', async () => {
  const { s6 } = await runR1S6(false, { chars: R1_CHARS, pool: AC_POOL, answer: AC_ANSWER });
  assert.equal(s6.status, 'done');
  assert.equal(ledgerOf(s6), undefined, 'OFF: images.candidateLedger undefined');
  assert.ok(!JSON.stringify(s6.dossierPatch).includes('candidateLedger'), 'OFF: ไม่มีคำว่า candidateLedger ที่ไหนเลย');
});

await test('R1: FRESH OFF inert — getter บน candidateLedger ไม่ถูกแตะเลยเมื่อ env off', async () => {
  let touched = false;
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  // fresh: ไม่มี property candidateLedger อยู่จริง — ถ้าโค้ดพยายาม define/อ่าน = จับได้ (getter throw)
  Object.defineProperty(job.dossier.images, 'candidateLedger', { configurable: true, enumerable: false, get() { touched = true; throw new Error('MUST NOT TOUCH WHEN OFF'); } });
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(false, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done', 's6 ยังทำงานปกติ ไม่ crash');
  assert.equal(touched, false, 'OFF: property candidateLedger ไม่ถูกอ่านเลย (env-first guard)');
});

await test('R1: ON accessor carrier — getOwnPropertyDescriptor ไม่ invoke getter → ถือว่าไม่ใช่ own-data → คิดใหม่', async () => {
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  Object.defineProperty(job.dossier.images, 'candidateLedger', { configurable: true, enumerable: true, get() { return { v: 1, roles: [], __sentinel: true }; } });
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  const L = ledgerOf(s6);
  assert.ok(L && L.roles.some((r) => r.rows.length > 0), 'accessor carrier ไม่ใช่ own-data → คิด ledger ใหม่จริง (มี rows)');
  assert.ok(!('__sentinel' in L), 'ไม่รับค่าจาก accessor');
});

await test('R1: ON INVALID_SAFE plain v2 carrier → preserve ด้วย safe clone (deep เท่าเดิม, reference ใหม่, ไม่คิดใหม่)', async () => {
  const carrier = { v: 2, roles: [], stale: true }; // safe plain, schema-invalid
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  job.dossier.images.candidateLedger = carrier;
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  const L = ledgerOf(s6);
  assert.deepStrictEqual(L, { v: 2, roles: [], stale: true }, 'INVALID_SAFE: deep/JSON เท่าเดิม (ไม่ normalize เป็น v1)');
  assert.notEqual(L, carrier, 'ต้องเป็น safe clone (reference ใหม่) ไม่ใช่ carrier เดิม');
  assert.doesNotThrow(() => JSON.stringify(s6.dossierPatch));
});

await test('R1: ON vs OFF legacy — pickImages/rawBody byte-identical (ต่าง = candidateLedger ล้วน)', async () => {
  const off = await runR1Full(false, { chars: R1_CHARS, pool: AC_POOL, answer: AC_ANSWER });
  const on = await runR1Full(true, { chars: R1_CHARS, pool: AC_POOL, answer: AC_ANSWER });
  assert.deepStrictEqual(on.s6.dossierPatch.pickImages, off.s6.dossierPatch.pickImages, 'pickImages เท่ากันเป๊ะ');
  assert.equal(on.captures.rawBody, off.captures.rawBody, 'rawBody byte-identical (ledger ไม่รั่วเข้า payload)');
  assert.ok(!JSON.stringify(on.captures.payload).includes('candidateLedger'), 'payload ไม่มี ledger (ON)');
  assert.equal(ledgerOf(off.s6), undefined, 'OFF: ไม่มี ledger');
  assert.ok(ledgerOf(on.s6)?.v === 1, 'ON: มี ledger v:1');
});

await test('R1: ON vs OFF semantic strict — spec/specHash/replayHash/realizedTemplate/slotPlan/rawBody/queue identical', async () => {
  const off = await withLedger(false, () => runStrictFlow({ s7Env: ALL_ON }));
  const on = await withLedger(true, () => runStrictFlow({ s7Env: ALL_ON }));
  assert.deepStrictEqual(on.s6.dossierPatch.pickImages, off.s6.dossierPatch.pickImages, 'pickImages identical');
  assert.equal(on.captures.rawBody, off.captures.rawBody, 'rawBody byte-identical');
  assert.equal(on.captures.payload.selectionSpec.specHash, off.captures.payload.selectionSpec.specHash, 'specHash identical');
  assert.equal(on.captures.payload.selectionSpec.replayHash, off.captures.payload.selectionSpec.replayHash, 'replayHash identical');
  assert.deepStrictEqual(on.captures.payload.realizedTemplate, off.captures.payload.realizedTemplate, 'realizedTemplate identical');
  assert.deepStrictEqual(on.captures.payload.slotPlan, off.captures.payload.slotPlan, 'slotPlan identical');
  assert.equal(on.queueCalls, off.queueCalls, 'queue count identical');
  assert.equal(on.queueCalls, 1, 'queue once');
  assert.equal(off.s6.dossierPatch.images?.candidateLedger, undefined, 'OFF no ledger');
  const L = ledgerOf(on.s6);
  assert.ok(L && L.v === 1, 'ON ledger v1');
  assert.ok(!JSON.stringify(on.captures.payload).includes('candidateLedger'), 'payload ไม่มี ledger');
  // semantic canonical hero (refRole main/hero ผ่าน _isHeroSlot) + target จาก frozen contract
  const hero = L.roles.find((r) => r.role === 'hero');
  assert.ok(hero, 'มี hero role (canonical ผ่าน _isHeroSlot ไม่ใช่ legacyKey)');
  assert.ok(['contract', 'order', 'compass_hero'].includes(hero.targetSource), `targetSource authority: ${hero.targetSource}`);
  assert.ok(hero.targetPerson, 'hero มี targetPerson');
});

await test('R1: write-once — persisted valid snapshot preserve ตอน replay (pool เปลี่ยน, env on→off)', async () => {
  const captures = { brainArgs: [], fetches: [], payload: null };
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  const s6a = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  const L0 = JSON.stringify(ledgerOf(s6a));
  Object.assign(job.dossier, s6a.dossierPatch); // persist tick
  assert.ok(job.dossier.images.candidateLedger, 'persisted ลง dossier.images');
  // replay env ON + pool membership เปลี่ยน (เพิ่มใบ unique หน้าใหญ่ + poolSize ต่าง) → recompute จะต่างแน่ แต่ต้อง preserve เดิม byte
  const CHANGED = [...AC_POOL, LIMG('AC-NEW', 'ดวงเดือน', 0.5, 'face-emotional', [1400, 1800], { sharpness: 50 })];
  const s6b = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: CHANGED, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(JSON.stringify(ledgerOf(s6b)), L0, 'replay ON (pool membership เปลี่ยน) → ledger byte เดิม (write-once ไม่คิดใหม่)');
  assert.ok(!JSON.stringify(ledgerOf(s6b)).includes('AC-NEW'), 'ใบใหม่ AC-NEW ไม่โผล่ (ยืนยันไม่ recompute)');
  Object.assign(job.dossier, s6b.dossierPatch);
  // replay env OFF → ยัง preserve ผ่าน merge (...im)
  const s6c = await withLedger(false, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  Object.assign(job.dossier, s6c.dossierPatch);
  assert.equal(JSON.stringify(job.dossier.images.candidateLedger), L0, 'replay OFF: ledger เดิมยังอยู่ครบ byte');
  // S7 ไม่เขียน images
  const s7 = await withLedger(true, () => s7_cover(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s7.dossierPatch.images, undefined, 'S7 ไม่เขียน dossierPatch.images');
});

await test('R1: AC-0066 evidence — hero −311 หน้าเล็กถูกเลือก ทั้งที่ −29/−41 ใหญ่กว่า · person-miss ไม่ถูกซ่อน', async () => {
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: AC_POOL, answer: AC_ANSWER });
  const L = ledgerOf(s6);
  const hero = L.roles.find((r) => r.role === 'hero');
  assert.equal(hero.selectedId, 'AC-311', 'hero ยังเลือก −311 (R1 ไม่แตะการเลือก)');
  const sel = hero.rows.find((x) => x.id === 'AC-311');
  const c29 = hero.rows.find((x) => x.id === 'AC-29');
  const c41 = hero.rows.find((x) => x.id === 'AC-41');
  assert.ok(sel && c29 && c41, '−311/−29/−41 อยู่ในตาราง hero');
  assert.equal(sel.selected, true);
  assert.equal(c29.selected, false);
  assert.ok(sel.faceFrac < c29.faceFrac && sel.faceFrac < c41.faceFrac, `−311 ${sel.faceFrac} < −29 ${c29.faceFrac}/−41 ${c41.faceFrac}`);
  assert.equal(sel.matchKind, 'exact');
  // full-universe observability: สรพงศ์/ไร้คน ถูกจัด REJECT_PERSON_MISS ไม่ถูก pre-filter หาย
  assert.ok((hero.reasonCounts.REJECT_PERSON_MISS || 0) >= 1, 'person-miss ปรากฏใน reasonCounts (ไม่ถูกซ่อน)');
  assert.equal(hero.totalRows, Object.values(hero.reasonCounts).reduce((a, b) => a + b, 0), 'reasonCounts sum = totalRows');
});

await test('R1: determinism — สลับลำดับพูล → ledger bytes เท่าเดิมเป๊ะ', async () => {
  const a = await runR1S6(true, { chars: R1_CHARS, pool: AC_POOL, answer: AC_ANSWER });
  const b = await runR1S6(true, { chars: R1_CHARS, pool: [...AC_POOL].reverse(), answer: AC_ANSWER });
  assert.equal(JSON.stringify(ledgerOf(a.s6)), JSON.stringify(ledgerOf(b.s6)), 'ledger permutation-invariant');
});

await test('R1: cap — 30-row + 8192-byte (รวม wrapper) + counters จริง + redaction', async () => {
  const BIG_POOL = [
    ...Array.from({ length: 40 }, (_, i) => LIMG('B' + String(i).padStart(2, '0'), 'ดวงเดือน', 0.05 + (i % 9) * 0.002, 'context', [900, 1200])),
    LIMG('BS1', 'สรพงศ์ ชาตรี', 0.2, 'face-emotional', [1200, 900]),
    LIMG('BC1', null, 0, 'context', [1600, 900]),
  ];
  const BIG_ANSWER = { hero: { id: 'B00' }, reaction: { id: 'BS1' }, action: { id: 'B01' }, context: { id: 'BC1' }, circle: { id: 'BS1' } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: BIG_POOL, answer: BIG_ANSWER });
  const L = ledgerOf(s6);
  assert.ok(Buffer.byteLength(JSON.stringify({ candidateLedger: L }), 'utf8') <= 8192, 'wrapper ≤ 8192 bytes');
  const hero = L.roles.find((r) => r.role === 'hero');
  assert.ok(hero.totalRows > 30 && hero.rows.length <= 30, '30-row cap engaged (total>30, kept≤30)');
  for (const r of L.roles) {
    assert.ok(r.rows.length <= 30, `≤30 rows`);
    assert.equal(r.keptRows, r.rows.length, 'keptRows = rows.length');
    assert.equal(r.totalRows, r.keptRows + r.droppedRows, 'totalRows = kept + dropped (truthful)');
    assert.equal(Object.values(r.reasonCounts).reduce((a, b) => a + b, 0), r.totalRows, 'reasonCounts sum = totalRows (นับก่อน cap)');
  }
  assert.equal(L.capped, true);
  assert.equal(L.droppedRows, L.roles.reduce((a, r) => a + r.droppedRows, 0), 'global droppedRows = ผลรวม per-role');
  const j = JSON.stringify(L);
  for (const bad of ['imageUrl', 'thumbnailUrl', 'faceBox', 'peopleBox', 'cdn.test', 'enqueuedAt', 'refBoundAt']) assert.ok(!j.includes(bad), `redaction: ไม่มี "${bad}"`);
});

await test('R1: safe IDs — URL-like/ยาวเกิน id → hash token (ไม่ persist URL/ข้อความยาวดิบ)', async () => {
  const badId = 'https://cdn.evil/secret/AC-9.jpg?token=abc';
  const longId = 'Z'.repeat(80);
  const POOL = [
    LIMG('SAFE-HERO', 'ดวงเดือน', 0.09, 'face-emotional', [900, 1200], { sharpness: 40 }),
    LIMG(badId, 'ดวงเดือน', 0.05, 'context', [900, 1200]),
    LIMG(longId, 'ดวงเดือน', 0.04, 'context', [900, 1200]),
  ];
  const ANSWER = { hero: { id: 'SAFE-HERO' }, reaction: { id: 'SAFE-HERO' }, action: { id: badId }, context: { id: longId }, circle: { id: 'SAFE-HERO' } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: POOL, answer: ANSWER });
  const L = ledgerOf(s6);
  const j = JSON.stringify(L);
  assert.ok(!j.includes('cdn.evil') && !j.includes('token=abc'), 'ไม่มีข้อความ URL ดิบ');
  assert.ok(!j.includes(longId), 'ไม่มี id ยาวดิบ');
  assert.ok(allRows(L).some((x) => typeof x.id === 'string' && x.id.startsWith('id#')), 'มี id#hash token แทน URL/ยาว');
});

await test('R1: prefix-collision — selected retention ใช้ flag ไม่ใช่ clipped-id equality', async () => {
  const idA = 'P'.repeat(64) + 'AAAA';
  const idB = 'P'.repeat(64) + 'BBBB';
  const POOL = [
    LIMG('PC-OTHER', 'ดวงเดือน', 0.2, 'face-emotional', [900, 1200], { sharpness: 40 }),
    LIMG(idA, 'ดวงเดือน', 0.15, 'context', [900, 1200]),
    LIMG(idB, 'ดวงเดือน', 0, 'context', [900, 1200]), // selected hero, faceFrac null → อันดับท้าย
  ];
  const ANSWER = { hero: { id: idB }, reaction: { id: 'PC-OTHER' }, action: { id: idA }, context: { id: 'PC-OTHER' }, circle: { id: 'PC-OTHER' } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: POOL, answer: ANSWER });
  const hero = ledgerOf(s6).roles.find((r) => r.role === 'hero');
  const selRows = hero.rows.filter((x) => x.selected);
  assert.equal(selRows.length, 1, 'มี selected row เดียว (idB) ถูกตรึงด้วย flag');
  assert.equal(selRows[0].faceFrac, null, 'selected = idB (faceFrac null) ไม่ถูก idA กด');
});

await test('R1: strict types — string/bool ไม่ถูก coerce เป็นเลข → null', async () => {
  const POOL = [
    LIMG('NC-HERO', 'ดวงเดือน', 0.09, 'face-emotional', [900, 1200], { sharpness: 40 }),
    IMG('NC-STR', { person: 'ดวงเดือน', faceCount: '2', quality: '7', sharpness: '30', faceBox: { w: '0.2', h: '0.2' } }, { realWidth: '900', realHeight: '1200', width: '900', height: '1200' }),
  ];
  const ANSWER = { hero: { id: 'NC-HERO' }, reaction: { id: 'NC-HERO' }, action: { id: 'NC-STR' }, context: { id: 'NC-STR' }, circle: { id: 'NC-HERO' } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: POOL, answer: ANSWER });
  const row = findRow(ledgerOf(s6), 'NC-STR');
  assert.ok(row, 'NC-STR อยู่ในตาราง');
  assert.equal(row.faceCount, null, "faceCount '2' string → null");
  assert.equal(row.quality, null, "quality '7' string → null");
  assert.equal(row.faceFrac, null, 'faceBox string components → null');
  assert.equal(row.dims, null, 'realWidth string → dims null');
  assert.equal(row.orient, null, 'width string → orient null');
});

await test('R1: reason truth — face-none/multiface/thumbnail/undersize/sharpness (gate on) แยกชัด', async () => {
  const POOL = [
    IMG('RT-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1200, realHeight: 1500 }),
    IMG('RT-ZERO', { person: 'ดวงเดือน', faceCount: 0, clean: true, sharpness: 40 }, { realWidth: 900, realHeight: 1200 }),
    IMG('RT-MULTI', { person: 'ดวงเดือน', faceCount: 3, clean: true, sharpness: 40, faceBox: { w: 0.2, h: 0.4 } }, { realWidth: 900, realHeight: 1200 }),
    IMG('RT-THUMB', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 900, realHeight: 1200, rehostQuality: 'thumbnail' }),
    IMG('RT-SMALL', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 400, realHeight: 500 }),
    IMG('RT-BLUR', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 5, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 900, realHeight: 1200 }),
  ];
  const ANSWER = { hero: { id: 'RT-HERO' }, reaction: { id: 'RT-ZERO' }, action: { id: 'RT-MULTI' }, context: { id: 'RT-THUMB' }, circle: { id: 'RT-SMALL' } };
  const { s6 } = await runR1S6(true, { chars: [{ name: 'ดวงเดือน', role: 'hero' }], pool: POOL, answer: ANSWER });
  const hero = ledgerOf(s6).roles.find((r) => r.role === 'hero');
  // นับผ่าน reasonCounts (จักรวาลเต็มก่อน cap) — พูลนี้ออกแบบให้แต่ละ reject มีต้นทางเดียว → count>=1 = แมปถูกตัว
  const rc = hero.reasonCounts;
  assert.ok((rc.REJECT_FACE_NONE || 0) >= 1, 'faceCount 0 → FACE_NONE (แยกจาก multiface)');
  assert.ok((rc.REJECT_MULTIFACE || 0) >= 1, 'faceCount 3 → MULTIFACE');
  assert.ok((rc.REJECT_THUMBNAIL || 0) >= 1, 'thumbnail → THUMBNAIL');
  assert.ok((rc.REJECT_UNDERSIZE || 0) >= 1, 'rss 400 → UNDERSIZE');
  assert.ok((rc.REJECT_SHARPNESS || 0) >= 1, 'sharpness 5 (gate on) → SHARPNESS');
  // ยืนยันแถวที่รอด (top-rank) ถ้ายังอยู่ก็ต้องแมปถูก — RT-HERO selected
  const heroRow = hero.rows.find((x) => x.id === 'RT-HERO');
  assert.equal(heroRow.reason, 'SELECTED');
});

await test('R1: heroGrade truth — true(ครบ)/false(multiface)/null(sharp unknown gate-on)/null(dims unknown)', async () => {
  const POOL = [
    IMG('HG-TRUE', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('HG-FALSE', { person: 'ดวงเดือน', faceCount: 3, clean: true, sharpness: 40, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('HG-NULLSHARP', { person: 'ดวงเดือน', faceCount: 1, clean: true, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('HG-NULLDIM', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 0, realHeight: 0 }),
  ];
  const ANSWER = { hero: { id: 'HG-TRUE' }, reaction: { id: 'HG-FALSE' }, action: { id: 'HG-NULLSHARP' }, context: { id: 'HG-NULLDIM' }, circle: { id: 'HG-TRUE' } };
  const { s6 } = await runR1S6(true, { chars: [{ name: 'ดวงเดือน', role: 'hero' }], pool: POOL, answer: ANSWER });
  const L = ledgerOf(s6);
  // heroGrade เป็น role-independent → อ่านจาก occurrence ใดก็ได้ (แต่ละใบถูกเลือก = ตรึงในสล็อตของมัน กัน byte-trim)
  assert.equal(findRow(L, 'HG-TRUE').heroGrade, true, 'หลักฐานครบ → true');
  assert.equal(findRow(L, 'HG-FALSE').heroGrade, false, 'multiface → false');
  assert.equal(findRow(L, 'HG-NULLSHARP').heroGrade, null, 'sharpness ไม่รู้ + gate on → null');
  assert.equal(findRow(L, 'HG-NULLDIM').heroGrade, null, 'dims ไม่รู้ → null');
});

await test('R1: metadataState independent — selected+insufficient คง selected · non-selected unknown → reason METADATA_INSUFFICIENT', async () => {
  const POOL = [
    IMG('MI-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('MI-SEL', { person: 'ดวงเดือน', faceCount: 1, clean: true }, { realWidth: 0, realHeight: 0 }), // no dims → insufficient · selected in action
    IMG('MI-UNK', { person: null, faceCount: 0, clean: true }, { realWidth: 0, realHeight: 0 }),
  ];
  const ANSWER = { hero: { id: 'MI-HERO' }, reaction: { id: 'MI-HERO' }, action: { id: 'MI-SEL' }, context: { id: 'MI-UNK' }, circle: { id: 'MI-HERO' } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: POOL, answer: ANSWER });
  const L = ledgerOf(s6);
  const selRow = findRow(L, 'MI-SEL', (x) => x.selected);
  assert.ok(selRow, 'MI-SEL selected row');
  assert.equal(selRow.reason, 'SELECTED', 'reason ยัง SELECTED');
  assert.equal(selRow.metadataState, 'METADATA_INSUFFICIENT', 'metadataState เห็น insufficiency อิสระจาก reason');
  assert.ok(Array.isArray(selRow.unknownFields) && selRow.unknownFields.includes('dims'), 'unknownFields ระบุ dims');
  // MI-UNK ในบทบาทไร้ target (action/context) ที่ไม่ถูกเลือก → reason METADATA_INSUFFICIENT
  const unkInsufficient = allRows(L).some((x) => x.id === 'MI-UNK' && !x.selected && x.reason === 'METADATA_INSUFFICIENT');
  assert.ok(unkInsufficient, 'non-selected unknown (ไร้ target) → reason METADATA_INSUFFICIENT');
});

await test('R1: role-permuted hero — สลับลำดับ compass (role tag เดิม) → hero target ไม่พลิก', async () => {
  const a = await runR1S6(true, { chars: [{ name: 'ดวงเดือน', role: 'hero' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }], pool: AC_POOL, answer: AC_ANSWER });
  const b = await runR1S6(true, { chars: [{ name: 'สรพงศ์ ชาตรี', role: 'related' }, { name: 'ดวงเดือน', role: 'hero' }], pool: AC_POOL, answer: AC_ANSWER });
  const ha = ledgerOf(a.s6).roles.find((r) => r.role === 'hero');
  const hb = ledgerOf(b.s6).roles.find((r) => r.role === 'hero');
  assert.equal(ha.targetPerson, 'ดวงเดือน');
  assert.equal(hb.targetPerson, 'ดวงเดือน', 'hero target role-aware (ไม่ใช่ chars[0])');
});

await test('R1: alias-aware nonhero — alias ของ hero ถูกตัด · >1 distinct nonhero → target null', async () => {
  const a = await runR1S6(true, { chars: [{ name: 'ดวงเดือน จันทร์', role: 'hero' }, { name: 'ดวงเดือน', role: 'related' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }], pool: AC_POOL, answer: AC_ANSWER });
  const reactA = ledgerOf(a.s6).roles.find((r) => r.role === 'reaction');
  assert.equal(reactA.targetPerson, 'สรพงศ์ ชาตรี', 'alias ของ hero (ดวงเดือน) ถูกตัด → เหลือ nonhero เดียว');
  const b = await runR1S6(true, { chars: [{ name: 'ดวงเดือน', role: 'hero' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }, { name: 'มานพ ทองดี', role: 'related' }], pool: AC_POOL, answer: AC_ANSWER });
  const reactB = ledgerOf(b.s6).roles.find((r) => r.role === 'reaction');
  assert.equal(reactB.targetPerson, null, '>1 distinct nonhero → target null');
  assert.equal(reactB.targetSource, null, 'source null เมื่อ ambiguous');
});

await test('R1: every persons label — person mismatch แต่ persons[] มี target → matchKind exact', async () => {
  const POOL = [
    IMG('PL-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1200, realHeight: 1500 }),
    IMG('PL-MULTI', { person: 'คนอื่น', persons: ['คนอื่น', 'สรพงศ์ ชาตรี'], faceCount: 2, clean: true, faceBox: { w: 0.3, h: 0.5 } }, { realWidth: 1200, realHeight: 900 }),
  ];
  const ANSWER = { hero: { id: 'PL-HERO' }, reaction: { id: 'PL-MULTI' }, action: { id: 'PL-HERO' }, context: { id: 'PL-MULTI' }, circle: { id: 'PL-MULTI' } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: POOL, answer: ANSWER });
  const react = ledgerOf(s6).roles.find((r) => r.role === 'reaction');
  const row = react.rows.find((x) => x.id === 'PL-MULTI');
  assert.ok(row, 'PL-MULTI ในตาราง reaction');
  assert.equal(row.matchKind, 'exact', 'ประเมิน persons[1]=สรพงศ์ → exact (ไม่ใช่แค่ person=คนอื่น=miss)');
  assert.ok(Array.isArray(row.persons) && row.persons.includes('สรพงศ์ ชาตรี'), 'persons[] ถูกบันทึก');
});

await test('R1: matchKind — วงเล็บ "สรพงศ์ (พี่เอก)" vs "สรพงศ์ ชาตรี" = token_fallback (ไม่ใช่ exact)', async () => {
  const PAREN_CHARS = [{ name: 'ดวงเดือน', role: 'hero' }, { name: 'สรพงศ์ (พี่เอก)', role: 'related' }];
  const { s6 } = await runR1S6(true, { chars: PAREN_CHARS, pool: AC_POOL, answer: AC_ANSWER });
  const react = ledgerOf(s6).roles.find((r) => r.role === 'reaction');
  assert.equal(react.targetPerson, 'สรพงศ์ พี่เอก', 'targetPerson normalize วงเล็บ');
  const row = react.rows.find((x) => x.id === 'AC-125');
  assert.ok(row, 'AC-125 อยู่ในตาราง reaction (ไม่ pre-filter)');
  assert.equal(row.matchKind, 'token_fallback', 'เปิดโปง token fallback — ไม่ฟันธง exact');
});

await test('R1: matchKind — full name == target → exact · bare shared first-name → ambiguous', async () => {
  const COLLIDE_CHARS = [{ name: 'สมชาย ใจดี', role: 'hero' }, { name: 'สมชาย ใจร้าย', role: 'related' }];
  const COLLIDE_POOL = [
    LIMG('C1', 'สมชาย ใจดี', 0.2, 'face-emotional', [900, 1200], { sharpness: 40 }),            // full == hero target → exact
    IMG('CBARE', { person: 'สมชาย', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }), // bare → ambiguous
    LIMG('C3', null, 0, 'context', [1200, 800]),
    LIMG('C4', null, 0, 'document', [1000, 800]),
  ];
  const COLLIDE_ANSWER = { hero: { id: 'C1' }, reaction: { id: 'CBARE' }, action: { id: 'C3' }, context: { id: 'C4' }, circle: { id: 'CBARE' } };
  const { s6 } = await runR1S6(true, { chars: COLLIDE_CHARS, pool: COLLIDE_POOL, answer: COLLIDE_ANSWER });
  const hero = ledgerOf(s6).roles.find((r) => r.role === 'hero');
  const c1 = hero.rows.find((x) => x.id === 'C1');
  const cbare = hero.rows.find((x) => x.id === 'CBARE');
  assert.ok(c1 && cbare, 'C1/CBARE อยู่ในตาราง hero');
  assert.equal(c1.matchKind, 'exact', 'full name == target → exact (ก่อน token ambiguity)');
  assert.equal(cbare.matchKind, 'ambiguous', 'bare สมชาย ชน 2 identity → ambiguous');
});

await test('R1: accessor-safe emit — enumerable THROWING candidateLedger getter (ledger on) → getter 0, S6 ok, safe base', async () => {
  let gets = 0;
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  job.dossier.images.caseId = 'SEM-TEST'; // ordinary data field ต้องคงอยู่ใน safe base
  Object.defineProperty(job.dossier.images, 'candidateLedger', { configurable: true, enumerable: true, get() { gets++; throw new Error('GETTER MUST NOT RUN'); } });
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done', 'S6 succeeds (getter ไม่ถูกเรียก)');
  assert.equal(gets, 0, 'enumerable throwing getter ไม่ถูก invoke เลย (safe base ไม่ spread im)');
  const L = ledgerOf(s6);
  assert.ok(L && L.v === 1 && L.roles.some((r) => r.rows.length > 0), 'ledger ถูก emit จริง (คิดใหม่)');
  assert.equal(s6.dossierPatch.images.caseId, 'SEM-TEST', 'ordinary data field คงอยู่ใน safe base');
});

await test('R1: _validSnap deep — hostile snapshot (toJSON/accessor/cycle) → S6 fail-safe · valid plain v1 preserved verbatim', async () => {
  const runWith = async (carrier) => {
    const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
    job.dossier.images.candidateLedger = carrier;
    const captures = { brainArgs: [], fetches: [], payload: null };
    return { s6: await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) })), job };
  };
  assert.equal((await runWith({ v: 1, roles: [], toJSON() { return { v: 1, roles: [] }; } })).s6.status, 'done', 'toJSON snapshot → fail-safe');
  const acc = { v: 1 }; Object.defineProperty(acc, 'roles', { enumerable: true, get() { return []; } });
  assert.equal((await runWith(acc)).s6.status, 'done', 'accessor roles → fail-safe');
  const cyc = { v: 1, roles: [] }; cyc.self = cyc;
  assert.equal((await runWith(cyc)).s6.status, 'done', 'cyclic → fail-safe');
  assert.equal((await runWith({ v: 1, roles: Array.from({ length: 20 }, () => ({ role: 'x', rows: [] })) })).s6.status, 'done', 'unbounded roles → fail-safe');
  assert.equal((await runWith({ v: 1, roles: [{ role: 'hero', rows: [{ id: 'https://cdn.evil/x.jpg' }] }] })).s6.status, 'done', 'URL-bearing v1 → fail-safe');
  // valid plain v1 → blessed → preserved verbatim (deepStrictEqual)
  const good = { v: 1, poolSize: 0, capped: false, droppedRows: 0, roles: [{ role: 'hero', slotId: 'hero', targetPerson: null, targetSource: null, selectedId: null, totalRows: 0, keptRows: 0, droppedRows: 0, reasonCounts: {}, rows: [] }] };
  const okRun = await runWith(good);
  assert.deepStrictEqual(ledgerOf(okRun.s6), good, 'valid plain v1 → preserved verbatim');
});

await test('R1: URL detector — // data: blob: file: (แม้ id สั้น) → hash token, ไม่ persist ดิบ', async () => {
  const ids = ['//cdn.host/a.jpg', 'data:image/png;base64,QQ==', 'blob:xyz', 'file:///c/x.jpg', '//x'];
  const POOL = [
    IMG('URL-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    ...ids.map((id) => IMG(id, { person: 'ดวงเดือน', faceCount: 1, clean: true, faceBox: { w: 0.1, h: 0.2 } }, { realWidth: 900, realHeight: 1200 })),
  ];
  const ANSWER = { hero: { id: 'URL-HERO' }, reaction: { id: ids[0] }, action: { id: ids[1] }, context: { id: ids[2] }, circle: { id: ids[3] } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: POOL, answer: ANSWER });
  const j = JSON.stringify(ledgerOf(s6));
  for (const id of ids) assert.ok(!j.includes(id), `ไม่ persist id ดิบ: ${id}`);
  assert.ok(allRows(ledgerOf(s6)).some((x) => String(x.id).startsWith('id#')), 'มี id#hash token');
});

await test('R1: sharpness gate-ON — unknown sharpness (hero) → unknownFields sharpness + metadata insufficient + reason≠eligible + heroGrade null', async () => {
  const POOL = [
    IMG('SG1-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('SG1-NOSHARP', { person: 'ดวงเดือน', faceCount: 1, clean: true, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 1000, realHeight: 1300 }),
  ];
  const ANSWER = { hero: { id: 'SG1-HERO' }, reaction: { id: 'SG1-HERO' }, action: { id: 'SG1-NOSHARP' }, context: { id: 'SG1-NOSHARP' }, circle: { id: 'SG1-HERO' } };
  const { s6 } = await runR1S6(true, { chars: [{ name: 'ดวงเดือน', role: 'hero' }], pool: POOL, answer: ANSWER });
  const row = ledgerOf(s6).roles.find((r) => r.role === 'hero').rows.find((x) => x.id === 'SG1-NOSHARP');
  assert.ok(row, 'SG1-NOSHARP ในตาราง hero (non-selected)');
  assert.ok((row.unknownFields || []).includes('sharpness'), 'gate on + sharpness unknown → unknownFields sharpness');
  assert.equal(row.metadataState, 'METADATA_INSUFFICIENT');
  assert.notEqual(row.reason, 'ELIGIBLE', 'reason ต้องไม่ใช่ ELIGIBLE');
  assert.equal(row.heroGrade, null, 'gate on + sharpness unknown → heroGrade null');
});

await test('R1: sharpness gate-OFF — unknown sharpness ไม่เข้า unknownFields · heroGrade true ได้', async () => {
  const POOL = [
    IMG('SG2-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('SG2-NOSHARP', { person: 'ดวงเดือน', faceCount: 1, clean: true, faceBox: { w: 0.2, h: 0.5 } }, { realWidth: 1000, realHeight: 1300 }),
  ];
  const ANSWER = { hero: { id: 'SG2-HERO' }, reaction: { id: 'SG2-HERO' }, action: { id: 'SG2-NOSHARP' }, context: { id: 'SG2-NOSHARP' }, circle: { id: 'SG2-HERO' } };
  const captures = { brainArgs: [], fetches: [], payload: null };
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: [{ name: 'ดวงเดือน', role: 'hero' }] });
  const s6 = await withLedger(true, () => withSharpGate(false, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: POOL, brainAnswer: ANSWER, captures }) })));
  const row = ledgerOf(s6).roles.find((r) => r.role === 'hero').rows.find((x) => x.id === 'SG2-NOSHARP');
  assert.ok(row, 'SG2-NOSHARP ในตาราง hero');
  assert.ok(!(row.unknownFields || []).includes('sharpness'), 'gate off → ไม่ต้องรู้ sharpness');
  assert.equal(row.heroGrade, true, 'gate off + หลักฐานอื่นครบ → heroGrade true');
});

await test('R1: identity clustering — สรพงศ์ + สรพงศ์ ชาตรี = 1 identity (react target ไม่กำกวม)', async () => {
  const CH = [{ name: 'ดวงเดือน', role: 'hero' }, { name: 'สรพงศ์', role: 'related' }, { name: 'สรพงศ์ ชาตรี', role: 'related' }];
  const { s6 } = await runR1S6(true, { chars: CH, pool: AC_POOL, answer: AC_ANSWER });
  const react = ledgerOf(s6).roles.find((r) => r.role === 'reaction');
  assert.equal(react.targetPerson, 'สรพงศ์ ชาตรี', 'alias สั้น↔ยาว unique collapse → identity เดียว (canonical ยาว)');
  assert.equal(react.targetSource, 'compass_sole_nonhero');
});

await test('R1: identity clustering — สมชาย ใจดี/ใจร้าย = 2 คน · label "สมชาย" ambiguous (ไม่ silently exact/alias)', async () => {
  const CH = [{ name: 'สมชาย ใจดี', role: 'hero' }, { name: 'สมชาย ใจร้าย', role: 'related' }];
  const POOL = [
    IMG('SM-1', { person: 'สมชาย ใจดี', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('SM-BARE', { person: 'สมชาย', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    LIMG('SM-CTX', null, 0, 'context', [1200, 800]),
  ];
  const ANSWER = { hero: { id: 'SM-1' }, reaction: { id: 'SM-BARE' }, action: { id: 'SM-CTX' }, context: { id: 'SM-CTX' }, circle: { id: 'SM-BARE' } };
  const { s6 } = await runR1S6(true, { chars: CH, pool: POOL, answer: ANSWER });
  const bare = ledgerOf(s6).roles.find((r) => r.role === 'hero').rows.find((x) => x.id === 'SM-BARE');
  assert.ok(bare, 'SM-BARE ในตาราง hero');
  assert.equal(bare.matchKind, 'ambiguous', 'label สมชาย ชน 2 identity → ambiguous (ไม่ exact/alias เงียบ)');
});

await test('R1: matchedLabel — winning label ที่ persons[4+] ยัง visible แม้ persons ถูก cap', async () => {
  const POOL = [
    IMG('ML-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('ML-MANY', { person: 'คนอื่น', persons: ['a', 'b', 'c', 'd', 'e', 'สรพงศ์ ชาตรี'], faceCount: 2, clean: true, faceBox: { w: 0.3, h: 0.5 } }, { realWidth: 1200, realHeight: 900 }),
  ];
  const ANSWER = { hero: { id: 'ML-HERO' }, reaction: { id: 'ML-MANY' }, action: { id: 'ML-HERO' }, context: { id: 'ML-MANY' }, circle: { id: 'ML-MANY' } };
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: POOL, answer: ANSWER });
  const row = ledgerOf(s6).roles.find((r) => r.role === 'reaction').rows.find((x) => x.id === 'ML-MANY');
  assert.ok(row, 'ML-MANY ในตาราง reaction');
  assert.equal(row.matchKind, 'exact', 'persons[5]=สรพงศ์ → exact');
  assert.equal(row.matchedLabel, 'สรพงศ์ ชาตรี', 'matchedLabel เก็บป้ายที่ชนะ (อยู่นอก persons cap)');
  assert.ok(!(row.persons || []).includes('สรพงศ์ ชาตรี'), 'persons ถูก cap ที่ 4 → ไม่มี winner');
});

await test('R1: P0 — im Proxy ownKeys/getOwnPropertyDescriptor trap throw (ledger on) → S6 done, omit, ไม่ fall-back spread', async () => {
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  const targetObj = { caseId: 'SEM-TEST' };
  job.dossier.images = new Proxy(targetObj, { getOwnPropertyDescriptor() { throw new Error('DESC TRAP'); }, ownKeys() { throw new Error('OWNKEYS TRAP'); } });
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done', 'S6 finishes แม้ proxy trap throw (omit ledger, ไม่ fall-back spread ที่จะ throw ซ้ำ)');
  assert.equal(s6.dossierPatch.images, undefined, 'ON-path ล้ม → ไม่ emit images (ไม่ spread hostile im)');
});

await test('R1: P0 — stateful Proxy carrier (get/toJSON trap throw) → clone จาก descriptor, get 0, persisted = plain clone', async () => {
  const good = fullCarrier({ roles: [fullRole({ targetPerson: 'ดวงเดือน', targetSource: 'compass_hero', selectedId: 'X', reasonCounts: { SELECTED: 1 }, rows: [fullRow({ id: 'X', person: 'ดวงเดือน', matchKind: 'exact', reason: 'SELECTED', selected: true })] })] });
  let gets = 0;
  const proxy = new Proxy(good, { get() { gets++; throw new Error('GET/toJSON TRAP'); }, getOwnPropertyDescriptor(t, k) { return Object.getOwnPropertyDescriptor(t, k); }, ownKeys(t) { return Reflect.ownKeys(t); } });
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  job.dossier.images.candidateLedger = proxy;
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done');
  assert.equal(gets, 0, 'get/toJSON trap ไม่ถูกเรียกเลย (clone อ่านจาก descriptor.value)');
  const L = ledgerOf(s6);
  assert.notEqual(L, proxy, 'persisted = plain clone (ไม่ใช่ proxy เดิม)');
  assert.deepStrictEqual(L, good, 'clone = snapshot เดิมทุก field');
});

await test('R1: P0 — Proxy carrier + INVALID v1 + live get/toJSON throw → INVALID_SAFE safe clone (get 0, ≠proxy, deep preserved, JSON safe)', async () => {
  const bad = { v: 2, roles: [], note: 'x' }; // safe plain, schema-invalid
  let gets = 0;
  const proxy = new Proxy(bad, { get() { gets++; throw new Error('GET/toJSON TRAP'); }, getOwnPropertyDescriptor(t, k) { return Object.getOwnPropertyDescriptor(t, k); }, ownKeys(t) { return Reflect.ownKeys(t); } });
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  job.dossier.images.candidateLedger = proxy;
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done');
  assert.equal(gets, 0, 'get/toJSON ไม่ถูกเรียก (clone อ่าน descriptor.value)');
  const L = ledgerOf(s6);
  assert.notEqual(L, proxy, 'INVALID_SAFE → safe clone (ไม่ใช่ proxy เดิม)');
  assert.deepStrictEqual(L, { v: 2, roles: [], note: 'x' }, 'deep/JSON value preserved');
  assert.doesNotThrow(() => JSON.stringify(s6.dossierPatch), 'later JSON.stringify safe');
});

await test('R1: P0 — rejected carrier Proxy (descriptor trap throw) → omit · original proxy absent · JSON.stringify safe', async () => {
  const proxy = new Proxy({ v: 1, roles: [] }, { getOwnPropertyDescriptor() { throw new Error('TRAP'); }, ownKeys() { throw new Error('TRAP'); } });
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  job.dossier.images.candidateLedger = proxy;
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done', 'carrier proxy trap → inspection-failed → S6 fail-safe');
  assert.equal(s6.dossierPatch.images, undefined, 'omit — original proxy absent จาก dossierPatch.images');
  assert.doesNotThrow(() => JSON.stringify(s6.dossierPatch), 'later persistence/JSON.stringify safe (ไม่มี proxy)');
});

await test('R1: total catch — thrown object with poisoned message getter → S6 still done (ไม่อ่าน e.message)', async () => {
  const poison = { get message() { throw new Error('POISON MESSAGE'); } };
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  job.dossier.images = new Proxy({ caseId: 'SEM-TEST' }, { getOwnPropertyDescriptor() { throw poison; }, ownKeys() { throw poison; } });
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done', 'catch ไม่อ่าน e.message → poisoned getter ไม่ throw ซ้ำ → S6 done');
  assert.equal(s6.dossierPatch.images, undefined, 'omit (ON-path inspect fail)');
});

await test('R1: _clone — otherwise-valid v1 + own JSON __proto__ key → UNSAFE/omit (guard test) · JSON-safe', async () => {
  // body เป็น v1 valid; invalidity มาจาก own __proto__ key เท่านั้น (ไม่ใช่ v!=1) → test fails ถ้าถอด proto-guard/defineProperty-safe clone
  const carrier = JSON.parse('{"__proto__":{"x":1},' + JSON.stringify(fullCarrier()).slice(1));
  assert.equal(carrier.v, 1, 'carrier body = v1 valid');
  const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
  job.dossier.images.candidateLedger = carrier;
  const captures = { brainArgs: [], fetches: [], payload: null };
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  assert.equal(s6.status, 'done');
  assert.equal(s6.dossierPatch.images, undefined, 'own __proto__ key → UNSAFE → omit');
  assert.doesNotThrow(() => JSON.stringify(s6.dossierPatch));
});

// SCHEMA-PRESERVATION / STATIC-AUDIT coverage — VALID และ INVALID_SAFE มี public behavior เดียวกัน (safe-clone + preserve);
// เทสยืนยัน SAFE→clone(deep=,ref≠) และ UNSAFE→omit เท่านั้น · การแยกแยะ VALID vs INVALID_SAFE ตรวจโดย static audit ของ _validV1 (ไม่ export/ไม่พิสูจน์ internal ผ่าน public fixture)
await test('R1: _validV1 — schema-preservation coverage · SAFE=clone(deep=,ref≠) · UNSAFE=omit', async () => {
  const run = async (carrier) => {
    const job = mkJob({ dna: DNA_ALPO, orders: [], chars: R1_CHARS });
    job.dossier.images.candidateLedger = carrier;
    const captures = { brainArgs: [], fetches: [], payload: null };
    const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
    return { L: ledgerOf(s6), images: s6.dossierPatch.images, patch: s6.dossierPatch };
  };
  const bad = async (carrier, name) => { const r = await run(carrier); assert.deepStrictEqual(r.L, carrier, `${name}: deep เท่าเดิม`); assert.notEqual(r.L, carrier, `${name}: safe clone (ref ใหม่)`); assert.doesNotThrow(() => JSON.stringify(r.patch)); };
  const omit = async (carrier, name) => { const r = await run(carrier); assert.equal(r.images, undefined, `${name}: UNSAFE omit (causal, observable)`); assert.doesNotThrow(() => JSON.stringify(r.patch)); };
  // valid → safe clone: reference ต่างจาก carrier เดิมจริง (ไม่เทียบ fullCarrier() ใบใหม่)
  const goodC = fullCarrier(); const rg = await run(goodC);
  assert.notEqual(rg.L, goodC, 'valid → safe clone (reference ≠ carrier เดิม)'); assert.deepStrictEqual(rg.L, goodC, 'valid → deep เท่าเดิม');
  // ── schema-preservation fixtures (SAFE→clone) — static audit ตรวจว่า _validV1 reject แต่ละ schema violation ──
  await bad(fullCarrier({ roles: [] }), 'empty roles');
  await bad({ v: 1, poolSize: 81, capped: true, droppedRows: 81, roles: [{ role: 'hero', slotId: 'hero', targetPerson: null, targetSource: null, selectedId: null, totalRows: 81, keptRows: 0, droppedRows: 81, reasonCounts: { ELIGIBLE: 81 }, rows: [] }] }, 'poolSize>80 (only)');
  await bad(fullCarrier({ capped: true }), 'capped mismatch');
  await bad(fullCarrier({ droppedRows: 1, capped: true }), 'global dropped mismatch (roles/capped consistent)');
  await bad(fullCarrier({ roles: [fullRole({ role: 'nope', targetSource: 'contract' })] }), 'bad role enum');
  await bad(fullCarrier({ roles: [fullRole({ targetSource: 'weird' })] }), 'bad targetSource enum');
  await bad(fullCarrier({ roles: [fullRole({ selectedId: 'ZZZ' })] }), 'selectedId no selected row');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { ELIGIBLE: 1, NOPE: 0 } })] }), 'reasonCounts bad key');
  await bad(fullCarrier({ poolSize: 2, roles: [fullRole({ totalRows: 2, keptRows: 2, reasonCounts: { ELIGIBLE: 1, REJECT_DIRTY: 1 }, rows: [fullRow({ id: 'A' }), fullRow({ id: 'B' })] })] }), 'reasonCounts not dominating (sums/counters balance)');
  await bad(fullCarrier({ extra: 1 }), 'unknown top key');
  await bad(fullCarrier({ roles: [fullRole({ extra: 1 })] }), 'unknown role key');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ extra: 1 })] })] }), 'unknown row key');
  // ── target/source combos (schema-preservation) ──
  await bad(fullCarrier({ roles: [fullRole({ targetPerson: null, targetSource: 'compass_hero', rows: [fullRow({ matchKind: null, person: null })] })] }), 'null target + compass source');
  await bad(fullCarrier({ roles: [fullRole({ role: 'reaction', targetSource: 'compass_hero' })] }), 'compass_hero + reaction');
  await bad(fullCarrier({ roles: [fullRole({ targetPerson: null, targetSource: 'order', rows: [fullRow({ matchKind: null, person: null })] })] }), 'order + null target');
  await bad(fullCarrier({ roles: [fullRole({ targetPerson: null, targetSource: 'contract', rows: [fullRow({ matchKind: 'exact' })] })] }), 'targetPerson null + matchKind');
  // ── selected/reason (schema-preservation) ──
  await bad(fullCarrier({ roles: [fullRole({ selectedId: 'A', reasonCounts: { SELECTED: 1 }, rows: [fullRow({ id: 'A', reason: 'SELECTED', selected: false })] })] }), 'nonselected+SELECTED');
  await bad(fullCarrier({ roles: [fullRole({ selectedId: 'A', reasonCounts: { ELIGIBLE: 1 }, rows: [fullRow({ id: 'A', reason: 'ELIGIBLE', selected: true })] })] }), 'selected+ELIGIBLE');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { REJECT_PERSON_MISS: 1 }, rows: [fullRow({ reason: 'REJECT_PERSON_MISS', matchKind: 'exact' })] })] }), 'REJECT_PERSON_MISS ≠ miss');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { REJECT_PERSON_AMBIGUOUS: 1 }, rows: [fullRow({ reason: 'REJECT_PERSON_AMBIGUOUS', matchKind: 'exact' })] })] }), 'REJECT_PERSON_AMBIGUOUS ≠ ambiguous');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { REJECT_DIRTY: 1 }, rows: [fullRow({ reason: 'REJECT_DIRTY', clean: true })] })] }), 'REJECT_DIRTY needs clean false');
  await bad(fullCarrier({ roles: [fullRole({ role: 'context', targetSource: 'contract', reasonCounts: { REJECT_THUMBNAIL: 1 }, rows: [fullRow({ reason: 'REJECT_THUMBNAIL' })] })] }), 'REJECT_THUMBNAIL hero-only');
  // ── ELIGIBLE / heroGrade prerequisites (preservation) ──
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ clean: false })] })] }), 'clean false + ELIGIBLE');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ matchKind: 'miss' })] })] }), 'miss + ELIGIBLE');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ matchKind: 'ambiguous' })] })] }), 'ambiguous + ELIGIBLE');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ heroGrade: false })] })] }), 'hero heroGrade false + ELIGIBLE');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ heroGrade: null })] })] }), 'hero heroGrade null + ELIGIBLE');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ dims: '500x500' })] })] }), 'hero dims<700 + heroGrade true + ELIGIBLE');
  // ── metadataState/unknownFields truth (schema-preservation) ──
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ clean: null })] })] }), 'OK missing clean evidence');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ dims: null })] })] }), 'OK missing dims evidence');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ faceCount: null })] })] }), 'OK missing faceCount (portrait)');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ faceFrac: null })] })] }), 'OK missing faceFrac (portrait)');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ reason: 'METADATA_INSUFFICIENT', metadataState: 'METADATA_INSUFFICIENT', unknownFields: ['clean'] })] })] }), 'insufficient label contradicts present clean');
  await bad(fullCarrier({ roles: [fullRole({ role: 'context', targetSource: 'contract', reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ unknownFields: ['faceCount'], metadataState: 'METADATA_INSUFFICIENT', reason: 'METADATA_INSUFFICIENT' })] })] }), 'non-portrait face unknown');
  await bad(fullCarrier({ roles: [fullRole({ role: 'context', targetSource: 'contract', reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ unknownFields: ['sharpness'], metadataState: 'METADATA_INSUFFICIENT', reason: 'METADATA_INSUFFICIENT' })] })] }), 'sharpness unknown non-hero');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ matchKind: null, person: 'ดวงเดือน', unknownFields: ['identity'], metadataState: 'METADATA_INSUFFICIENT', reason: 'METADATA_INSUFFICIENT' })] })] }), 'identity unknown but label present');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ metadataState: 'OK', unknownFields: ['relevant'] })] })] }), 'OK with unknownFields');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ reason: 'METADATA_INSUFFICIENT', metadataState: 'METADATA_INSUFFICIENT' })] })] }), 'INSUFFICIENT no unknownFields');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ reason: 'ELIGIBLE', metadataState: 'METADATA_INSUFFICIENT', unknownFields: ['relevant'] })] })] }), 'ELIGIBLE+INSUFFICIENT state');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ reason: 'METADATA_INSUFFICIENT', metadataState: 'OK' })] })] }), 'INSUFFICIENT reason+OK state');
  // ── unknownFields enum/dup (evidence-known row) ──
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ reason: 'METADATA_INSUFFICIENT', metadataState: 'METADATA_INSUFFICIENT', unknownFields: ['NOPE'] })] })] }), 'unknownFields bad enum');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ reason: 'METADATA_INSUFFICIENT', metadataState: 'METADATA_INSUFFICIENT', unknownFields: ['relevant', 'relevant'] })] })] }), 'unknownFields dup');
  await bad(fullCarrier({ roles: [fullRole({ reasonCounts: { METADATA_INSUFFICIENT: 1 }, rows: [fullRow({ reason: 'METADATA_INSUFFICIENT', metadataState: 'METADATA_INSUFFICIENT', unknownFields: [] })] })] }), 'unknownFields empty');
  // ── persons/matchedLabel (schema-preservation) ──
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ persons: {} })] })] }), 'persons wrong container');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ persons: [5] })] })] }), 'persons wrong entry type');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ matchedLabel: 5 })] })] }), 'matchedLabel wrong type');
  await bad(fullCarrier({ roles: [fullRole({ rows: [fullRow({ matchedLabel: 'x'.repeat(49) })] })] }), 'matchedLabel over-cap');
  // ── table-driven: field presence (delete) + type per fixed field → INVALID_SAFE ──
  const FIXED = ['id', 'person', 'matchKind', 'metadataState', 'faceFrac', 'dims', 'measuredFrom', 'orient', 'clean', 'largeText', 'watermark', 'newsScene', 'faceCount', 'quality', 'pHash', 'heroGrade', 'reason', 'selected', 'estimatedUpscale'];
  for (const f of FIXED) { const c = fullCarrier(); delete c.roles[0].rows[0][f]; await bad(c, 'delete ' + f); }
  const WRONG = { id: 5, person: 5, matchKind: 'nope', metadataState: 'nope', faceFrac: 2, dims: 5, measuredFrom: 5, orient: 'diag', clean: 'yes', largeText: 1, watermark: 1, newsScene: 1, faceCount: 'x', quality: 'x', pHash: 5, heroGrade: 'x', selected: 'x', estimatedUpscale: 0 };
  for (const [f, val] of Object.entries(WRONG)) { const c = fullCarrier(); c.roles[0].rows[0][f] = val; await bad(c, 'wrongtype ' + f); }
  // ── UNSAFE → omit (URL/function/accessor/toJSON-fn/cycle/symbol/over-cap) ──
  await omit(fullCarrier({ roles: [fullRole({ rows: [fullRow({ pHash: 'http://x/y.jpg' })] })] }), 'URL data');
  await omit(fullCarrier({ roles: [fullRole({ rows: [fullRow({ quality: (() => 1) })] })] }), 'function value');
  { const c = fullCarrier(); Object.defineProperty(c, 'poolSize', { enumerable: true, configurable: true, get() { return 1; } }); await omit(c, 'accessor field'); }
  { const c = fullCarrier(); c.toJSON = () => ({}); await omit(c, 'toJSON function'); }
  { const c = fullCarrier(); c.self = c; await omit(c, 'cycle'); }
  { const c = fullCarrier(); c[Symbol('s')] = 1; await omit(c, 'symbol key'); }
  await omit(fullCarrier({ poolSize: 45, roles: [fullRole({ totalRows: 45, keptRows: 45, droppedRows: 0, reasonCounts: { ELIGIBLE: 45 }, rows: Array.from({ length: 45 }, (_, i) => fullRow({ id: 'R' + i })) })] }), 'over byte cap');
});

await test('R1: fresh-gen — ELIGIBLE hero nonselected row มี heroGrade true + faceCount 1 + dims short>=700 (non-vacuous generated output)', async () => {
  const POOL = [
    IMG('HG1', { person: 'ดวงเดือน', relevant: true, faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('HG2', { person: 'ดวงเดือน', relevant: true, faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.28, h: 0.55 } }, { realWidth: 900, realHeight: 1200 }),
  ];
  const ANSWER = { hero: { id: 'HG1' }, reaction: { id: 'HG1' }, action: { id: 'HG2' }, context: { id: 'HG2' }, circle: { id: 'HG1' } };
  const { s6 } = await runR1S6(true, { chars: [{ name: 'ดวงเดือน', role: 'hero' }], pool: POOL, answer: ANSWER });
  const hero = ledgerOf(s6).roles.find((r) => r.role === 'hero');
  const sel = hero.rows.find((x) => x.id === 'HG1');
  const nonsel = hero.rows.find((x) => x.id === 'HG2');
  assert.ok(sel && nonsel, 'HG1/HG2 ทั้งคู่ในตาราง hero');
  assert.equal(sel.selected, true, 'HG1 selected');
  assert.equal(nonsel.selected, false, 'HG2 retained nonselected');
  assert.equal(nonsel.reason, 'ELIGIBLE', 'HG2 → ELIGIBLE (ผ่านทุก gate จริง)');
  assert.equal(nonsel.heroGrade, true, 'ELIGIBLE hero → heroGrade true (generated)');
  assert.equal(nonsel.faceCount, 1, 'faceCount 1 (generated)');
  const m = /^([0-9]+(?:\.[0-9]+)?)x([0-9]+(?:\.[0-9]+)?)$/.exec(nonsel.dims);
  assert.ok(m, 'dims parseable W×H (generated)');
  assert.ok(Math.min(Number(m[1]), Number(m[2])) >= 700, 'dims short side >= 700 (generated)');
});

await test('R1: identity — blank/whitespace labels + target → matchKind null + reason METADATA_INSUFFICIENT (ไม่ใช่ PERSON_MISS)', async () => {
  const POOL = [
    IMG('BL-HERO', { person: 'ดวงเดือน', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('BL-BLANK', { person: '   ', persons: ['', '  '], faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
  ];
  const ANSWER = { hero: { id: 'BL-HERO' }, reaction: { id: 'BL-HERO' }, action: { id: 'BL-BLANK' }, context: { id: 'BL-BLANK' }, circle: { id: 'BL-HERO' } };
  const { s6 } = await runR1S6(true, { chars: [{ name: 'ดวงเดือน', role: 'hero' }], pool: POOL, answer: ANSWER });
  const row = ledgerOf(s6).roles.find((r) => r.role === 'hero').rows.find((x) => x.id === 'BL-BLANK');
  assert.ok(row, 'BL-BLANK ในตาราง hero');
  assert.equal(row.matchKind, null, 'blank labels + target → matchKind null (unknown ไม่ใช่ miss)');
  assert.equal(row.reason, 'METADATA_INSUFFICIENT', 'reason METADATA_INSUFFICIENT (ไม่ใช่ REJECT_PERSON_MISS)');
  assert.ok((row.unknownFields || []).includes('identity'), 'unknownFields identity');
  // ★ production case: generated row เก็บเฉพาะ persons entry ที่ว่างล้วน + ยังมี unknownFields identity
  //   (validator นับ persons usable เฉพาะ .some(trim) — static audit ยืนยัน predicate นี้ยอมรับ row นี้)
  assert.ok(Array.isArray(row.persons) && row.persons.length > 0, 'row เก็บ persons จริง (blank entries)');
  assert.ok(row.persons.every((s) => String(s).trim() === ''), 'persons ทุกตัวว่างล้วน (ไม่มี label ใช้ได้)');
  assert.ok(row.person == null || String(row.person).trim() === '', 'person ว่าง/ไม่มี label ใช้ได้');
});

await test('R1: semantic — contract slot = authority เดียว (ทุก role targetSource=contract · wantPerson null → target null ไม่ยืม order)', async () => {
  const { s6 } = await withLedger(true, () => runStrictFlow({ s7Env: ALL_ON }));
  const L = ledgerOf(s6);
  assert.ok(L.roles.length >= 1);
  assert.ok(L.roles.every((r) => r.targetSource === 'contract'), 'ทุก role มาจาก contract (ไม่ยืม order/compass ในโหมด semantic)');
  assert.ok(L.roles.some((r) => r.targetPerson === null && r.targetSource === 'contract'), 'slot wantPerson null = null authoritative (contract) ไม่ยืมจากช่องอื่น');
});

await test('R1: legacy — multiple distinct hero identities → hero target null (compass ambiguous)', async () => {
  const CH = [{ name: 'สมชาย เอ', role: 'hero' }, { name: 'สมหญิง บี', role: 'hero' }];
  const POOL = [
    IMG('MH-1', { person: 'สมชาย เอ', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    IMG('MH-2', { person: 'สมหญิง บี', faceCount: 1, clean: true, sharpness: 40, faceBox: { w: 0.3, h: 0.6 } }, { realWidth: 1000, realHeight: 1300 }),
    LIMG('MH-C', null, 0, 'context', [1200, 800]),
  ];
  const ANSWER = { hero: { id: 'MH-1' }, reaction: { id: 'MH-2' }, action: { id: 'MH-C' }, context: { id: 'MH-C' }, circle: { id: 'MH-2' } };
  const { s6 } = await runR1S6(true, { chars: CH, pool: POOL, answer: ANSWER });
  const hero = ledgerOf(s6).roles.find((r) => r.role === 'hero');
  assert.equal(hero.targetPerson, null, '>1 distinct hero identity → target null');
  assert.equal(hero.targetSource, null, 'source null เมื่อ compass hero ambiguous');
});

await test('R1: legacy — duplicate-role orders → ไม่ยืม single hint (fallback compass)', async () => {
  const captures = { brainArgs: [], fetches: [], payload: null };
  const job = mkJob({ dna: DNA_ALPO, orders: [{ role: 'reaction', personHint: 'คนเอ' }, { role: 'reaction', personHint: 'คนบี' }], chars: R1_CHARS });
  const s6 = await withLedger(true, () => s6_slots(job, { origin: 'http://mock', _deps: mkDeps({ pool: AC_POOL, brainAnswer: AC_ANSWER, captures }) }));
  const react = ledgerOf(s6).roles.find((r) => r.role === 'reaction');
  assert.equal(react.targetPerson, 'สรพงศ์ ชาตรี', 'duplicate reaction orders → ข้าม → compass (สรพงศ์)');
  assert.equal(react.targetSource, 'compass_sole_nonhero', 'ไม่ยืมจาก duplicate-role order');
});

await test('R1: full enum/schema — reason/matchKind/metadataState เสถียร + required fields ครบ', async () => {
  const { s6 } = await runR1S6(true, { chars: R1_CHARS, pool: AC_POOL, answer: AC_ANSWER });
  const L = ledgerOf(s6);
  assert.equal(L.v, 1);
  for (const r of L.roles) {
    assert.ok(typeof r.role === 'string' && typeof r.slotId === 'string');
    assert.ok('targetPerson' in r && 'targetSource' in r && 'totalRows' in r && 'keptRows' in r && 'droppedRows' in r && r.reasonCounts);
    for (const x of r.rows) {
      assert.ok(REASON_ENUM.has(x.reason), `reason enum: ${x.reason}`);
      assert.ok(MATCHKIND_ENUM.has(x.matchKind), `matchKind enum: ${x.matchKind}`);
      assert.ok(META_ENUM.has(x.metadataState), `metadataState enum: ${x.metadataState}`);
      for (const k of ['faceFrac', 'dims', 'measuredFrom', 'orient', 'clean', 'largeText', 'watermark', 'newsScene', 'faceCount', 'quality', 'pHash', 'heroGrade', 'selected', 'estimatedUpscale']) {
        assert.ok(k in x, `row มี field ${k}`);
      }
      assert.equal(x.estimatedUpscale, null, 'estimatedUpscale = null (ไม่เดา)');
    }
  }
});

// ============================================================
// 🔎 PHASE 2B1 — Search Provenance V1 (shadow/diagnostic) — offline deterministic
//   ทุกเทส: fake ผ่าน loader stubs + _deps · ไม่มี network/store/AI จริง · env MEGA_SEARCH_PROVENANCE snapshot/คืนค่าเสมอ
// ============================================================
const LEGACY_SEARCH_KEYS = ['success', 'caseId', 'platform', 'found', 'added', 'total', 'blockedCatalog', 'blockedOwnPage', 'blockedMismatch', 'skippedDup', 'vetOn', 'vetDropped', 'byPlatform', 'images', 'queriesUsed', 'errors'];
const SP_SETENV = (v) => { if (v === null) delete process.env.MEGA_SEARCH_PROVENANCE; else process.env.MEGA_SEARCH_PROVENANCE = v; };
const spRun = async (fn) => { const prev = process.env.MEGA_SEARCH_PROVENANCE ?? null; try { return await fn(); } finally { SP_SETENV(prev); delete globalThis.__MEGA_SP; delete globalThis.__MEGA_AI; } };

// ── fake factory (route): buildQueries/searchImages/vetImages/addImages/readImages/getCase/junk predicates ──
const mkSP = (o = {}) => ({
  buildQueries: o.buildQueries || (() => (o.queries || ['q1', 'q2'])),
  searchImages: o.searchImages || (async (p, q) => (o.hitsByQuery ? (o.hitsByQuery[q] || []) : [{ imageUrl: `${q}::${p}` }])),
  vetImages: o.vetImages || (async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 })),
  addImages: o.addImages || (async (id, imgs) => { globalThis.__SP_ADDED = imgs; return { added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs }; }),
  readImages: o.readImages || (async () => []),
  getCase: o.getCase || (async () => (o.caseObj || { keywords: { subjects: [{ name: 'A' }] }, analysis: { characters: [] } })),
  isCatalogSource: o.isCatalogSource, isOwnPageSource: o.isOwnPageSource, isMismatchedFbMedia: o.isMismatchedFbMedia,
});
const runPOST = async (body, sp, env) => { globalThis.__MEGA_SP = sp; SP_SETENV(env); const res = await searchPOST({ json: async () => body }); return res._body; };

// ── (1) exact-'1' switch matrix — เฉพาะ '1' เป๊ะเท่านั้นถึง ON ──
await test('2B1 route: exact-\'1\' switch matrix — เฉพาะ "1" เปิด (else = ไม่มี provenance)', async () => {
  await spRun(async () => {
    for (const v of [null, '0', '', ' 1', '1 ', 'true', 'on', '11']) {
      const out = await runPOST({ caseId: 'C', platform: 'google' }, mkSP(), v);
      assert.ok(!('provenance' in out), `env ${JSON.stringify(v)} ต้องไม่มี provenance`);
    }
    const on = await runPOST({ caseId: 'C', platform: 'google' }, mkSP(), '1');
    assert.ok('provenance' in on, 'env "1" ต้องมี provenance');
  });
});

// ── (2) OFF baseline — เทียบ COMPLETE literal f9c0db2 object + JSON.stringify key order (ไม่ใช่แค่ keys/3 ค่า) ──
await test('2B1 route: OFF = f9c0db2 legacy contract เป๊ะ (full literal + JSON key order) + ไม่มี provenance', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['q1', 'q2'] });
    const out = await runPOST({ caseId: 'C', platform: 'google' }, sp, null);
    const img = (q) => ({ imageUrl: `${q}::google`, platform: 'google', query: q, triage: { relevant: true } });
    const expected = {
      success: true, caseId: 'C', platform: 'google', found: 2, added: 2, total: 2,
      blockedCatalog: 0, blockedOwnPage: 0, blockedMismatch: 0, skippedDup: 0,
      vetOn: true, vetDropped: 0, byPlatform: {}, images: [img('q1'), img('q2')],
      queriesUsed: ['q1', 'q2'], errors: [],
    };
    assert.deepEqual(out, expected);
    assert.equal(JSON.stringify(out), JSON.stringify(expected), 'byte/key-order = legacy literal เป๊ะ');
    assert.deepEqual(Object.keys(out), LEGACY_SEARCH_KEYS);
    assert.ok(!('provenance' in out));
  });
});

// ── (2b) ON normal — legacy projection เป๊ะ + provenance ต่อท้าย + ค่าถูก ──
await test('2B1 route: ON normal — legacy keys เป๊ะ + provenance ต่อท้าย + ตัวนับตรง', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['q1', 'q2'], hitsByQuery: { q1: [{ imageUrl: 'a' }, { imageUrl: 'b' }], q2: [{ imageUrl: 'c' }, { imageUrl: 'd' }] } });
    const off = await runPOST({ caseId: 'C', platform: 'google' }, sp, null);
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.deepEqual(Object.keys(on), [...LEGACY_SEARCH_KEYS, 'provenance']);
    for (const k of LEGACY_SEARCH_KEYS) assert.deepEqual(on[k], off[k], `legacy key ${k} ต้องเท่า OFF`);
    assert.deepEqual(on.provenance, { queriesFired: 2, urlsReturned: 4, urlsVetted: 4, vetKept: 4, vetDropped: 0, vetFailed: 0 });
  });
});

// ── (3) partial query failure + zero-result — queriesFired นับทุก attempt, urlsReturned เฉพาะสำเร็จ ──
await test('2B1 route: partial provider failure/zero — queriesFired=ทุกครั้งยิง, urlsReturned=เฉพาะสำเร็จ (ไม่เดา)', async () => {
  await spRun(async () => {
    const sp = mkSP({
      queries: ['ok', 'boom', 'empty'],
      searchImages: async (p, q) => { if (q === 'boom') throw new Error('provider 500'); if (q === 'empty') return []; return [{ imageUrl: 'x1' }, { imageUrl: 'x2' }]; },
    });
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.equal(on.provenance.queriesFired, 3, 'ยิงจริง 3 คำ (รวม boom ที่ throw)');
    assert.equal(on.provenance.urlsReturned, 2, 'ดิบเฉพาะคำที่คืนสำเร็จ (ok=2, boom/empty=0)');
    assert.equal(on.found, 2);
  });
});

// ── (3b) out-of-order resolution — ลำดับ collected/counters นิ่งตามลำดับคำค้น (ไม่ใช่ลำดับ settle) ──
await test('2B1 route: out-of-order provider resolution — collected/counters deterministic ตามลำดับคำค้น', async () => {
  await spRun(async () => {
    const sp = mkSP({
      queries: ['q1', 'q2'],
      searchImages: async (p, q) => { const t = q === 'q1' ? 3 : 0; for (let i = 0; i < t; i++) await Promise.resolve(); return [{ imageUrl: q + 'a' }]; },
    });
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.deepEqual(globalThis.__SP_ADDED.map((x) => x.imageUrl), ['q1a', 'q2a'], 'ลำดับตามคำค้น (q1 ก่อน q2) แม้ q2 settle ก่อน');
    assert.equal(on.provenance.queriesFired, 2);
    assert.equal(on.provenance.urlsReturned, 2);
  });
});

// ── (4) vet disabled — urlsVetted=0, vetKept=null, dropped=0, failed=0 ──
await test('2B1 route: vet disabled (body.vet=false) — urlsVetted=0/vetKept=null/dropped=0/failed=0', async () => {
  await spRun(async () => {
    const on = await runPOST({ caseId: 'C', platform: 'google', vet: false }, mkSP({ queries: ['q1'] }), '1');
    assert.equal(on.vetOn, false);
    assert.equal(on.provenance.urlsVetted, 0);
    assert.equal(on.provenance.vetKept, null);
    assert.equal(on.provenance.vetDropped, 0);
    assert.equal(on.provenance.vetFailed, 0);
  });
});

// ── (4b) vet throw (fail-open) — storage=legacy fail-open, urlsVetted=N, vetKept=null, dropped=0, failed=N ──
await test('2B1 route: vet throw — fail-open เก็บครบ + vetKept=null/dropped=0/failed=N (execution failure)', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['q1', 'q2'], hitsByQuery: { q1: [{ imageUrl: 'a' }, { imageUrl: 'b' }], q2: [{ imageUrl: 'c' }] }, vetImages: async () => { throw new Error('gemini down'); } });
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.equal(on.vetOn, false, 'vet throw → vetOn ยังเดิม false');
    assert.equal(on.vetDropped, 0, 'legacy vetDropped ไม่แตะตอน throw');
    assert.equal(on.added, 3, 'fail-open เก็บครบ 3 ใบ');
    assert.equal(on.provenance.urlsVetted, 3);
    assert.equal(on.provenance.vetKept, null);
    assert.equal(on.provenance.vetDropped, 0);
    assert.equal(on.provenance.vetFailed, 3);
  });
});

// ── (4c) explicit reject — provenance ใช้ classifier จริง (kept/dropped/failed) แยกจาก legacy vetDropped ──
await test('2B1 route: explicit reject — provenance.vetDropped=classifier(1) ≠ legacy vetDropped(2)', async () => {
  await spRun(async () => {
    const sp = mkSP({
      queries: ['q1', 'q2'], hitsByQuery: { q1: [{ imageUrl: 'a' }, { imageUrl: 'b' }], q2: [{ imageUrl: 'c' }, { imageUrl: 'd' }] },
      vetImages: async ({ images }) => ({
        vetted: images.map((x, i) => i < 2 ? { ...x, triage: { relevant: true } } : i === 2 ? { ...x, triage: { relevant: false } } : { ...x }),
        kept: 2, dropped: 1, failed: 1,
      }),
    });
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.equal(on.vetDropped, 2, 'legacy = candidates(4) - toStore(2, strict relevant===true)');
    assert.deepEqual(on.provenance, { queriesFired: 2, urlsReturned: 4, urlsVetted: 4, vetKept: 2, vetDropped: 1, vetFailed: 1 });
    assert.notEqual(on.provenance.vetDropped, on.vetDropped, 'ห้าม publish legacy value เป็น provenance.vetDropped');
  });
});

// ── (5) error-path provenance sidecar — SEARCH_FAILED หลัง attempt ยังมี provenance (P1-3) ──
await test('2B1 route: SEARCH_FAILED (ทุกคำ throw) — error response แนบ provenance sidecar (attempts วัดได้)', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['a', 'b'], searchImages: async () => { throw new Error('down'); } });
    const off = await runPOST({ caseId: 'C', platform: 'google' }, sp, null);
    const expectedOff = { success: false, error: 'ค้นภาพไม่สำเร็จทุกคำค้น', errorType: 'SEARCH_FAILED', errors: [{ query: 'a', error: 'down' }, { query: 'b', error: 'down' }] };
    assert.deepEqual(off, expectedOff, 'OFF SEARCH_FAILED = f9c0db2 legacy literal เป๊ะ (ไม่มี provenance)');
    assert.equal(JSON.stringify(off), JSON.stringify(expectedOff), 'OFF SEARCH_FAILED key order เป๊ะ');
    assert.ok(!('provenance' in off));
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.equal(on.errorType, 'SEARCH_FAILED');
    assert.equal(on.provenance.queriesFired, 2); assert.equal(on.provenance.urlsReturned, 0);
  });
});

// ── (6) candidate/addImages bytes unchanged ON vs OFF ──
await test('2B1 route: bytes ที่ส่งเข้า addImages เท่ากันเป๊ะ ON vs OFF (provenance ไม่แตะ candidate)', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['q1', 'q2'], hitsByQuery: { q1: [{ imageUrl: 'a' }], q2: [{ imageUrl: 'b' }] } });
    await runPOST({ caseId: 'C', platform: 'google' }, sp, null); const offAdded = JSON.stringify(globalThis.__SP_ADDED);
    await runPOST({ caseId: 'C', platform: 'google' }, sp, '1'); const onAdded = JSON.stringify(globalThis.__SP_ADDED);
    assert.equal(onAdded, offAdded);
  });
});

// ── (7) _searchProvenance pure — safe non-negative integer bounding + vetKept null + key order ──
await test('2B1 pure _searchProvenance: safe-int bounding + vetKept null + key order คงที่', async () => {
  assert.deepEqual(_searchProvenance({ queriesFired: 3, urlsReturned: 5, urlsVetted: 4, vetKept: 2, vetDropped: 1, vetFailed: 0 }),
    { queriesFired: 3, urlsReturned: 5, urlsVetted: 4, vetKept: 2, vetDropped: 1, vetFailed: 0 });
  assert.deepEqual(Object.keys(_searchProvenance({ queriesFired: 1, urlsReturned: 1, urlsVetted: 1, vetKept: 1, vetDropped: 1, vetFailed: 1 })),
    ['queriesFired', 'urlsReturned', 'urlsVetted', 'vetKept', 'vetDropped', 'vetFailed']);
  assert.deepEqual(_searchProvenance({ queriesFired: -1, urlsReturned: 1.5, urlsVetted: NaN, vetDropped: Infinity }), {}, 'ค่าไม่ใช่ safe-int ≥0 = ทิ้ง (ไม่เดา)');
  assert.deepEqual(_searchProvenance({ vetKept: null }), { vetKept: null }, 'vetKept null = present null');
  assert.deepEqual(_searchProvenance({ vetKept: 3 }), { vetKept: 3 });
  // hostile inputs ต้องไม่ throw (ไม่ destructure ก่อน validate)
  assert.deepEqual(_searchProvenance(null), {});
  assert.deepEqual(_searchProvenance(undefined), {});
  assert.deepEqual(_searchProvenance('x'), {});
  assert.deepEqual(_searchProvenance(42), {});
  const throwProxy = new Proxy({}, { get() { throw new Error('boom'); } });
  assert.deepEqual(_searchProvenance(throwProxy), {}, 'throwing proxy → {} (ไม่ throw)');
});

// ── (8) malformed carrier matrix (ผ่าน s5_search stat) — hostile r.provenance ต้องไม่ตกลง stat ──
const runS5Search = async (searchResp, env) => {
  SP_SETENV(env);
  const job = { dossier: { images: { caseId: 'S', searchedPlatforms: [], ytFired: 'pre', searchStats: [] } } };
  const _deps = { fetchJson: async (url) => { if (String(url).includes('/api/images/search')) return searchResp; if (String(url).includes('/api/images/')) return { success: true, images: [] }; throw new Error('NO NETWORK: ' + url); } };
  try { const out = await s5_search(job, { origin: 'http://mock', _deps }); return out.dossierPatch.images.searchStats.at(-1); } finally { SP_SETENV(null); }
};
await test('2B1 s5_search: malformed carrier matrix — whole-carrier fail-closed (mixed accessor/inherited/traps)', async () => {
  const base = { success: true, found: 5, added: 3, vetDropped: 2, images: [] };
  const evilGetter = {}; Object.defineProperty(evilGetter, 'queriesFired', { enumerable: true, get() { throw new Error('boom'); } });
  const accessorOnly = {}; Object.defineProperty(accessorOnly, 'queriesFired', { enumerable: true, get() { return 3; } });
  // mixed: valid DATA field + accessor field → ต้องทิ้ง "ทั้ง carrier" (ไม่คืน partial)
  const mixedAccessor = { queriesFired: 1 }; Object.defineProperty(mixedAccessor, 'urlsReturned', { enumerable: true, get() { return 5; } });
  const inherited = Object.create({ queriesFired: 3 }); // proto ≠ Object.prototype → ทิ้ง
  class Prov { constructor() { this.queriesFired = 3; } }
  const descThrow = new Proxy({ queriesFired: 3 }, { getOwnPropertyDescriptor() { throw new Error('desc trap'); } });
  const ownKeysThrow = new Proxy({ queriesFired: 3 }, { ownKeys() { throw new Error('ownKeys trap'); } });
  const protoThrow = new Proxy({ queriesFired: 3 }, { getPrototypeOf() { throw new Error('proto trap'); } });
  const hostiles = [undefined, null, 'str', 42, true, [], [1, 2], {}, { foo: 1 }, { queriesFired: -1 }, { queriesFired: 1.5 }, new Prov(), evilGetter, accessorOnly, mixedAccessor, inherited, descThrow, ownKeysThrow, protoThrow];
  for (const h of hostiles) {
    const stat = await runS5Search({ ...base, provenance: h }, '1');
    assert.deepEqual(stat, { platform: 'google', found: 5, added: 3, vetDropped: 2 }, `hostile ${Object.prototype.toString.call(h)} ต้องไม่ติด provenance (ทั้ง carrier)`);
  }
  // valid subset: unknown DATA key ถูกทิ้ง เหลือเฉพาะ field whitelist
  const okStat = await runS5Search({ ...base, provenance: { queriesFired: 3, foo: 'x', urlsReturned: 4 } }, '1');
  assert.deepEqual(okStat.provenance, { queriesFired: 3, urlsReturned: 4 });
  // Object.create(null) (proto null) = plain own-data → ยอมรับ
  const nullProto = Object.create(null); nullProto.queriesFired = 2;
  const npStat = await runS5Search({ ...base, provenance: nullProto }, '1');
  assert.deepEqual(npStat.provenance, { queriesFired: 2 });
});
// ── (8c) descriptor-snapshot only — Proxy get trap ต้องไม่ถูกเรียกเลย (อ่านจาก descriptor.value เท่านั้น) ──
await test('2B1 s5_search: descriptor-only snapshot — Proxy get trap count=0 + ค่า=descriptor.value (ไม่ใช่ค่า get)', async () => {
  const base = { success: true, found: 5, added: 3, vetDropped: 2, images: [] };
  // plain-prototype Proxy: own data descriptor ค่าปลอดภัย แต่ get trap นับ+คืนค่าขัดแย้ง (999)
  let getCount = 0;
  const conflictProxy = new Proxy({ queriesFired: 3, urlsReturned: 5, vetKept: 2 }, { get() { getCount++; return 999; } });
  const s1 = await runS5Search({ ...base, provenance: conflictProxy }, '1');
  assert.equal(getCount, 0, 'get trap ต้องไม่ถูกเรียกเลย (descriptor-only)');
  assert.deepEqual(s1.provenance, { queriesFired: 3, urlsReturned: 5, vetKept: 2 }, 'ค่า = descriptor.value ไม่ใช่ 999 จาก get');
  // throwing-get variant: ถ้าเผลอเรียก get จะ throw — descriptor-only จึงต้องไม่ throw
  let getCount2 = 0;
  const throwGetProxy = new Proxy({ queriesFired: 7 }, { get() { getCount2++; throw new Error('get boom'); } });
  const s2 = await runS5Search({ ...base, provenance: throwGetProxy }, '1');
  assert.equal(getCount2, 0, 'throwing get trap ต้องไม่ถูกเรียก → ไม่ throw');
  assert.deepEqual(s2.provenance, { queriesFired: 7 });
});

// ── (8b) s5_search success/error propagation + OFF parity ของ stat ──
await test('2B1 s5_search: success/error stat propagation + OFF parity', async () => {
  const base = { success: true, found: 5, added: 3, vetDropped: 2, images: [] };
  const prov = { queriesFired: 2, urlsReturned: 4, urlsVetted: 4, vetKept: 4, vetDropped: 0, vetFailed: 0 };
  const offStat = await runS5Search({ ...base, provenance: prov }, null);
  assert.deepEqual(offStat, { platform: 'google', found: 5, added: 3, vetDropped: 2 }, 'OFF stat = legacy 4 keys เป๊ะ');
  assert.equal(JSON.stringify(offStat), JSON.stringify({ platform: 'google', found: 5, added: 3, vetDropped: 2 }), 'OFF stat key order = legacy literal');
  const onStat = await runS5Search({ ...base, provenance: prov }, '1');
  assert.deepEqual(onStat.provenance, prov);
  const errStat = await runS5Search({ success: false, error: 'x', httpStatus: 502, provenance: { queriesFired: 2, urlsReturned: 0 } }, '1');
  assert.ok(errStat.error && errStat.provenance, 'error stat แนบ provenance (P1-3)');
  assert.deepEqual(errStat.provenance, { queriesFired: 2, urlsReturned: 0 });
});

// ── (9) s5_gapsearch — sibling gapSearchProvenance (ไม่ยัด searchStats) + OFF ไม่มี key ──
const GAP_JF = async (url) => { if (String(url).includes('/api/images/')) return { images: [] }; throw new Error('NO NETWORK: ' + url); };
const gapSP = (o = {}) => ({
  searchImages: o.searchImages || (async (p, q) => { globalThis.__GAP_N = (globalThis.__GAP_N || 0) + 1; return [{ imageUrl: `${q}::${p}` }]; }),
  vetImages: o.vetImages || (async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 })),
  addImages: async (id, imgs) => ({ added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs }),
  getCase: async () => ({ keywords: { subjects: [] }, analysis: { characters: [] } }),
});
const runGap = async (im, sp, env) => {
  globalThis.__MEGA_SP = sp; globalThis.__MEGA_AI = async () => ({ text: '{"queries":["nq1","nq2"]}' }); globalThis.__GAP_N = 0;
  SP_SETENV(env);
  const job = { dossier: { images: im, compass: { mainCharacters: [{ name: 'A' }] }, desk: { title: 't' } } };
  return await s5_gapsearch(job, { origin: 'http://mock', _deps: { fetchJson: GAP_JF } });
};
await test('2B1 s5_gapsearch: ON = sibling gapSearchProvenance (ไม่แตะ searchStats) · OFF = ไม่มี key', async () => {
  await spRun(async () => {
    const on = await runGap({ caseId: 'GAP', storyQueries: ['sq1'], searchStats: [{ platform: 'google', found: 1, added: 1, vetDropped: 0 }] }, gapSP(), '1');
    const oi = on.dossierPatch.images;
    const N = globalThis.__GAP_N;
    assert.ok(N > 0, 'มี attempt จริง');
    assert.deepEqual(oi.gapSearchProvenance, { queriesFired: N, urlsReturned: N, urlsVetted: N, vetKept: N, vetDropped: 0, vetFailed: 0 });
    assert.deepEqual(oi.searchStats, [{ platform: 'google', found: 1, added: 1, vetDropped: 0 }], 'searchStats เดิมไม่ถูกแตะ (ไม่มี gap entry)');
    assert.equal(oi.gapSearchDone, true);
    await spRun(async () => {
      const off = await runGap({ caseId: 'GAP', storyQueries: ['sq1'], searchStats: [{ platform: 'google', found: 1, added: 1, vetDropped: 0 }] }, gapSP(), null);
      assert.ok(!('gapSearchProvenance' in off.dossierPatch.images), 'OFF ไม่มี sibling');
      assert.deepEqual(off.dossierPatch.images.searchStats, [{ platform: 'google', found: 1, added: 1, vetDropped: 0 }]);
    });
  });
});

// ── (9b) gap partial failure + explicit reject ──
await test('2B1 s5_gapsearch: partial provider failure + explicit reject — counters ตรง', async () => {
  await spRun(async () => {
    let n = 0;
    const sp = gapSP({
      searchImages: async (p, q) => { globalThis.__GAP_N = (globalThis.__GAP_N || 0) + 1; n++; if (n === 1) throw new Error('down'); return [{ imageUrl: `${q}::${p}::${n}` }]; },
      vetImages: async ({ images }) => ({ vetted: images.map((x, i) => i === 0 ? { ...x, triage: { relevant: false } } : { ...x, triage: { relevant: true } }), kept: images.length - 1, dropped: 1, failed: 0 }),
    });
    const on = await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, sp, '1');
    const gp = on.dossierPatch.images.gapSearchProvenance;
    assert.equal(gp.queriesFired, globalThis.__GAP_N, 'queriesFired = ทุก attempt (รวมที่ throw)');
    assert.ok(gp.urlsReturned < gp.queriesFired, 'urlsReturned < queriesFired (คำแรก throw)');
    assert.equal(gp.vetDropped, 1, 'classifier dropped');
    assert.equal(gp.vetFailed, 0);
  });
});

// ── (9c) gap re-entry non-interference — gapSearchDone=true → status/summary เท่ากัน ON vs OFF ──
await test('2B1 s5_gapsearch: re-entry (gapSearchDone) — ON/OFF status/summary เท่ากันเป๊ะ + ไม่มี provenance', async () => {
  await spRun(async () => {
    const off = await runGap({ caseId: 'GAP', gapSearchDone: true }, gapSP(), null);
    const on = await runGap({ caseId: 'GAP', gapSearchDone: true }, gapSP(), '1');
    assert.deepEqual(on, off, 're-entry ON=OFF ทุก byte');
    assert.equal(on.status, 'done'); assert.ok(!('dossierPatch' in on) || !('gapSearchProvenance' in (on.dossierPatch?.images || {})));
  });
});

// ── (10) strict-chain (ALL_ON): dossier carriers (searchStats[].provenance + gapSearchProvenance) inert ต่อ producer ──
await test('2B1 strict-chain (ALL_ON): dossier carriers inert — slots/slotPlan/spec/specHash/replayHash/realizedTemplate/raw queue body เท่ากันเป๊ะ + ไม่รั่วเข้า body', async () => {
  const seed = (withCarriers) => (job) => {
    const im = job.dossier.images;
    const baseStat = { platform: 'google', found: 1, added: 1, vetDropped: 0 };
    im.searchStats = [withCarriers ? { ...baseStat, provenance: { queriesFired: 1, urlsReturned: 1, urlsVetted: 1, vetKept: 1, vetDropped: 0, vetFailed: 0 } } : { ...baseStat }];
    if (withCarriers) im.gapSearchProvenance = { queriesFired: 4, urlsReturned: 4, urlsVetted: 4, vetKept: 4, vetDropped: 0, vetFailed: 0 };
  };
  // seed "ก่อน S6" — ทั้งสอง job มี legacy images fields เหมือนกันก่อน S6; ON เพิ่ม searchStats[].provenance + gapSearchProvenance
  const A = await runStrictFlow({ s7Env: ALL_ON, mutateBeforeS6: seed(true) });   // มี carrier ก่อน S6
  const B = await runStrictFlow({ s7Env: ALL_ON, mutateBeforeS6: seed(false) });  // legacy ไม่มี carrier
  assert.equal(A.queueCalls, 1); assert.equal(B.queueCalls, 1);
  // non-vacuous: carrier อยู่ก่อน S6 + คงอยู่ตลอด S6→S7 ในฝั่ง ON, ไม่มีในฝั่ง OFF · legacy stat เท่ากันเป๊ะ
  assert.deepEqual(A.job.dossier.images.searchStats[0], { platform: 'google', found: 1, added: 1, vetDropped: 0, provenance: { queriesFired: 1, urlsReturned: 1, urlsVetted: 1, vetKept: 1, vetDropped: 0, vetFailed: 0 } }, 'ON: searchStats+provenance คงอยู่ผ่าน S6→S7');
  assert.deepEqual(A.job.dossier.images.gapSearchProvenance, { queriesFired: 4, urlsReturned: 4, urlsVetted: 4, vetKept: 4, vetDropped: 0, vetFailed: 0 }, 'ON: gapSearchProvenance คงอยู่ผ่าน S6→S7');
  assert.deepEqual(B.job.dossier.images.searchStats[0], { platform: 'google', found: 1, added: 1, vetDropped: 0 }, 'OFF: legacy stat เท่ากันก่อน carrier');
  assert.ok(!('gapSearchProvenance' in B.job.dossier.images), 'OFF: ไม่มี gapSearchProvenance');
  assert.ok(A.captures.rawBody && B.captures.rawBody, 'enqueue จริงทั้งคู่ (non-vacuous)');
  const pa = A.captures.payload, pb = B.captures.payload;
  assert.ok(pa.slotPlan && pa.selectionSpec && pa.realizedTemplate, 'payload มี slotPlan/selectionSpec/realizedTemplate');
  assert.ok(pa.selectionSpec.specHash && pa.selectionSpec.replayHash, 'มี specHash + replayHash');
  assert.deepEqual(pa.slotPlan, pb.slotPlan, 'slotPlan เท่ากัน');
  assert.deepEqual(pa.selectionSpec, pb.selectionSpec, 'selectionSpec เท่ากัน (รวม specHash/replayHash)');
  assert.equal(pa.selectionSpec.specHash, pb.selectionSpec.specHash);
  assert.equal(pa.selectionSpec.replayHash, pb.selectionSpec.replayHash);
  assert.deepEqual(pa.realizedTemplate, pb.realizedTemplate, 'realizedTemplate เท่ากัน');
  assert.deepEqual(A.job.dossier.pickImages.slots, B.job.dossier.pickImages.slots, 'pickImages.slots เท่ากัน');
  assert.equal(A.captures.rawBody, B.captures.rawBody, 'raw serialized queue body เท่ากันเป๊ะ');
  assert.ok(!A.captures.rawBody.includes('provenance') && !A.captures.rawBody.includes('searchStats') && !A.captures.rawBody.includes('gapSearchProvenance'), 'queue body ไม่มี provenance/searchStats/gapSearchProvenance');
});

// ── (11) canonical 6-field/key-order ในทุก error/edge response ──
const PROV_KEYS = ['queriesFired', 'urlsReturned', 'urlsVetted', 'vetKept', 'vetDropped', 'vetFailed'];
await test('2B1 route: NO_SERPAPI_KEY หลัง attempt — sidecar canonical 6 fields/order + OFF = legacy literal', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['q1', 'q2'], searchImages: async () => { const e = new Error('no key'); e.errorType = 'NO_SERPAPI_KEY'; throw e; } });
    const off = await runPOST({ caseId: 'C', platform: 'google' }, sp, null);
    assert.deepEqual(off, { success: false, error: 'no key', errorType: 'NO_SERPAPI_KEY' });
    assert.equal(JSON.stringify(off), JSON.stringify({ success: false, error: 'no key', errorType: 'NO_SERPAPI_KEY' }), 'OFF error = legacy literal เป๊ะ');
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.deepEqual(Object.keys(on.provenance), PROV_KEYS, 'canonical 6 fields/order');
    assert.deepEqual(on.provenance, { queriesFired: 2, urlsReturned: 0, urlsVetted: 0, vetKept: null, vetDropped: 0, vetFailed: 0 });
  });
});
await test('2B1 route: all-provider-zero success — provenance canonical 6 fields (found=0/added=0)', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['q1', 'q2'], searchImages: async () => [] });
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.equal(on.success, true); assert.equal(on.found, 0); assert.equal(on.added, 0);
    assert.deepEqual(Object.keys(on.provenance), PROV_KEYS);
    assert.deepEqual(on.provenance, { queriesFired: 2, urlsReturned: 0, urlsVetted: 0, vetKept: null, vetDropped: 0, vetFailed: 0 });
  });
});
await test('2B1 route: SEARCH_FAILED — provenance เป็น object 6-field/order เป๊ะ', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['a', 'b'], searchImages: async () => { throw new Error('down'); } });
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.equal(on.errorType, 'SEARCH_FAILED');
    assert.deepEqual(on.provenance, { queriesFired: 2, urlsReturned: 0, urlsVetted: 0, vetKept: null, vetDropped: 0, vetFailed: 0 });
    assert.deepEqual(Object.keys(on.provenance), PROV_KEYS);
  });
});

// ── (12) UNEXPECTED (addImages throw หลัง search/vet) — outer catch แนบ sidecar (ON) · OFF legacy literal ──
await test('2B1 route: UNEXPECTED addImages-throw — ON sidecar (attempts วัดได้) · OFF = legacy 3-field literal', async () => {
  await spRun(async () => {
    const sp = mkSP({ queries: ['q1', 'q2'], hitsByQuery: { q1: [{ imageUrl: 'a' }], q2: [{ imageUrl: 'b' }] }, addImages: async () => { throw new Error('store boom'); } });
    const off = await runPOST({ caseId: 'C', platform: 'google' }, sp, null);
    assert.deepEqual(off, { success: false, error: 'store boom', errorType: 'UNEXPECTED' });
    assert.equal(JSON.stringify(off), JSON.stringify({ success: false, error: 'store boom', errorType: 'UNEXPECTED' }), 'OFF UNEXPECTED = legacy literal');
    const on = await runPOST({ caseId: 'C', platform: 'google' }, sp, '1');
    assert.equal(on.errorType, 'UNEXPECTED');
    assert.deepEqual(Object.keys(on.provenance), PROV_KEYS);
    assert.deepEqual(on.provenance, { queriesFired: 2, urlsReturned: 2, urlsVetted: 2, vetKept: 2, vetDropped: 0, vetFailed: 0 }, 'attempts วัดได้ก่อน addImages ล้ม');
  });
});

// ── (13) gap success exact literals: 4/4/4/4/0/0 ──
await test('2B1 s5_gapsearch: success exact literals — gapSearchProvenance = {4,4,4,4,0,0}', async () => {
  await spRun(async () => {
    const on = await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, gapSP(), '1');
    assert.equal(globalThis.__GAP_N, 4, '2 คำใหม่ × 2 แหล่ง = 4 attempt');
    assert.deepEqual(on.dossierPatch.images.gapSearchProvenance, { queriesFired: 4, urlsReturned: 4, urlsVetted: 4, vetKept: 4, vetDropped: 0, vetFailed: 0 });
    assert.equal(on.dossierPatch.images.gapSearchAdded, 4);
  });
});
// ── (13b) gap partial/reject exact: 4/3/3/2/1/0 + added=2 ──
await test('2B1 s5_gapsearch: partial+reject exact — {4,3,3,2,1,0} added=2', async () => {
  await spRun(async () => {
    let n = 0;
    const sp = gapSP({
      searchImages: async (p, q) => { globalThis.__GAP_N = (globalThis.__GAP_N || 0) + 1; n++; if (n === 1) throw new Error('down'); return [{ imageUrl: `${q}::${p}::${n}` }]; },
      vetImages: async ({ images }) => ({ vetted: images.map((x, i) => i === 0 ? { ...x, triage: { relevant: false } } : { ...x, triage: { relevant: true } }), kept: images.length - 1, dropped: 1, failed: 0 }),
    });
    const on = await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, sp, '1');
    assert.deepEqual(on.dossierPatch.images.gapSearchProvenance, { queriesFired: 4, urlsReturned: 3, urlsVetted: 3, vetKept: 2, vetDropped: 1, vetFailed: 0 });
    assert.equal(on.dossierPatch.images.gapSearchAdded, 2, 'toStore = collected(3) - reject(1) = 2');
  });
});
// ── (13c) gap vet-throw exact: 4/4/4/null/0/4 + fail-open ทั้ง 4 ใบเข้า addImages ครบ ──
await test('2B1 s5_gapsearch: vet-throw exact {4,4,4,null,0,4} + fail-open bytes ครบ 4 เข้า addImages', async () => {
  await spRun(async () => {
    globalThis.__GAP_ADDED = null;
    const sp = gapSP({
      searchImages: async (p, q) => { globalThis.__GAP_N = (globalThis.__GAP_N || 0) + 1; return [{ imageUrl: `${q}::${p}` }]; },
      vetImages: async () => { throw new Error('gemini down'); },
    });
    sp.addImages = async (id, imgs) => { globalThis.__GAP_ADDED = imgs; return { added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs }; };
    const on = await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, sp, '1');
    assert.deepEqual(on.dossierPatch.images.gapSearchProvenance, { queriesFired: 4, urlsReturned: 4, urlsVetted: 4, vetKept: null, vetDropped: 0, vetFailed: 4 });
    assert.equal(globalThis.__GAP_ADDED.length, 4, 'fail-open: ทั้ง 4 candidate ถึง addImages');
    assert.deepEqual(on.dossierPatch.images.gapSearchAdded, 4);
  });
});
// ── (13d) gap addImages bytes เท่ากัน ON vs OFF (normal) ──
await test('2B1 s5_gapsearch: addImages bytes เท่ากันเป๊ะ ON vs OFF (provenance ไม่แตะ candidate)', async () => {
  await spRun(async () => {
    const mk = () => { const sp = gapSP(); sp.addImages = async (id, imgs) => { globalThis.__GAP_ADDED = JSON.stringify(imgs); return { added: imgs.length, total: imgs.length, byPlatform: {}, images: imgs }; }; return sp; };
    await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, mk(), null); const offB = globalThis.__GAP_ADDED;
    await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, mk(), '1'); const onB = globalThis.__GAP_ADDED;
    assert.equal(onB, offB);
  });
});
// ── (13e) gap TRUE outer-failure (addImages throw) — sidecar ยังแนบ (ON) · status/summary เดิม ──
await test('2B1 s5_gapsearch: outer-failure (addImages throw) — gapSearchProvenance sidecar ยังแนบ (ON)', async () => {
  await spRun(async () => {
    const sp = gapSP({ searchImages: async (p, q) => { globalThis.__GAP_N = (globalThis.__GAP_N || 0) + 1; return [{ imageUrl: `${q}::${p}` }]; } });
    sp.addImages = async () => { throw new Error('store outer boom'); };
    const on = await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, sp, '1');
    const gp = on.dossierPatch.images.gapSearchProvenance;
    assert.ok(gp, 'outer-failure ยังมี sidecar (attempts วัดได้)');
    assert.equal(gp.queriesFired, 4); assert.equal(gp.urlsReturned, 4);
    // outer-catch path: dossierPatch ไม่มี gapSearchAdded (ต่างจาก success) — แยก path ได้ชัด (summary ถูก hard-gate override)
    assert.ok(!('gapSearchAdded' in on.dossierPatch.images), 'outer-failure path: ไม่มี gapSearchAdded');
    assert.equal(on.dossierPatch.images.gapSearchDone, true);
    // OFF: ไม่มี sidecar แม้ outer failure
    await spRun(async () => {
      const sp2 = gapSP({ searchImages: async (p, q) => [{ imageUrl: `${q}::${p}` }] }); sp2.addImages = async () => { throw new Error('boom'); };
      const off = await runGap({ caseId: 'GAP', storyQueries: ['sq1'] }, sp2, null);
      assert.ok(!('gapSearchProvenance' in off.dossierPatch.images), 'OFF outer-failure ไม่มี sidecar');
    });
  });
});
// ── (14) re-entry write-once + s5_search ON/OFF identical totals/status/summary/searchStats ──
await test('2B1 re-entry write-once: persisted gapSearchProvenance untouched + s5_search ON/OFF identical', async () => {
  await spRun(async () => {
    // re-entry: gapSearchDone=true + persisted provenance → early return ไม่มี dossierPatch → ของเดิมไม่ถูกแตะ
    const persisted = { queriesFired: 9, urlsReturned: 9, urlsVetted: 9, vetKept: 9, vetDropped: 0, vetFailed: 0 };
    const im0 = { caseId: 'GAP', gapSearchDone: true, gapSearchProvenance: persisted, searchStats: [{ platform: 'google', found: 1, added: 1, vetDropped: 0 }] };
    const onR = await runGap({ ...im0 }, gapSP(), '1');
    const offR = await runGap({ ...im0 }, gapSP(), null);
    assert.deepEqual(onR, offR, 're-entry ON=OFF ทุก byte');
    assert.ok(!('dossierPatch' in onR), 'early return ไม่มี dossierPatch → persisted provenance write-once (ไม่ถูกแตะ)');
    // s5_search ON vs OFF: totals/status/summary/legacy searchStats fields identical (provenance เป็น sub-key เท่านั้น)
    const searchResp = { success: true, found: 5, added: 3, vetDropped: 2, images: [], provenance: { queriesFired: 2, urlsReturned: 4, urlsVetted: 4, vetKept: 4, vetDropped: 0, vetFailed: 0 } };
    const s5 = async (env) => {
      SP_SETENV(env);
      // ป้อน persisted gapSearchProvenance เข้า BOTH job — พิสูจน์ว่า s5_search เพิกเฉย/คงไว้ (ignored/preserved)
      const job = { dossier: { images: { caseId: 'S', searchedPlatforms: [], ytFired: 'pre', searchStats: [], gapSearchProvenance: persisted } } };
      const _deps = { fetchJson: async (url) => { if (String(url).includes('/api/images/search')) return searchResp; if (String(url).includes('/api/images/')) return { success: true, images: [] }; throw new Error('NO NETWORK'); } };
      try { const o = await s5_search(job, { origin: 'http://mock', _deps }); return o; } finally { SP_SETENV(null); }
    };
    const so = await s5(null); const sn = await s5('1');
    assert.equal(sn.status, so.status); assert.equal(sn.summary, so.summary);
    assert.equal(sn.dossierPatch.images.totalAdded ?? null, so.dossierPatch.images.totalAdded ?? null);
    const strip = (st) => ({ platform: st.platform, found: st.found, added: st.added, vetDropped: st.vetDropped });
    assert.deepEqual(strip(sn.dossierPatch.images.searchStats.at(-1)), strip(so.dossierPatch.images.searchStats.at(-1)), 'legacy stat fields identical');
    assert.ok(sn.dossierPatch.images.searchStats.at(-1).provenance, 'ON มี provenance sub-key');
    assert.ok(!('provenance' in so.dossierPatch.images.searchStats.at(-1)), 'OFF ไม่มี provenance');
    // persisted gapSearchProvenance = ถูก s5_search คงไว้เท่ากันเป๊ะ ON vs OFF (ไม่ถูกแตะ/ลบ)
    assert.deepEqual(sn.dossierPatch.images.gapSearchProvenance, persisted, 'ON: persisted sidecar preserved');
    assert.deepEqual(so.dossierPatch.images.gapSearchProvenance, persisted, 'OFF: persisted sidecar preserved');
    assert.deepEqual(sn.dossierPatch.images.gapSearchProvenance, so.dossierPatch.images.gapSearchProvenance, 'preserved sidecar identical ON vs OFF');
  });
});

// ============================================================
// 🔎 SEARCH V2 SLICE 1 — joinable candidate provenance shadow (MEGA_SEARCH_SHADOW_V2=1) — offline deterministic
// ============================================================
const mkSPv2 = (o = {}) => {
  const existing = o.existing || [];
  return {
    buildQueries: () => (o.queries || ['q0', 'q1']),
    searchImages: o.searchImages,
    vetImages: o.vetImages || (async ({ images }) => { globalThis.__V2_VET = JSON.stringify(images); return { vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 }; }),
    addImages: o.addImages || (async (caseId, imgs) => { globalThis.__V2_ADD = JSON.stringify(imgs); const fresh = imgs.map((im, i) => ({ ...im, id: `${caseId}-${existing.length + i + 1}` })); return { added: fresh.length, total: existing.length + fresh.length, byPlatform: {}, images: [...existing, ...fresh] }; }),
    readImages: async () => (o.readImages ? o.readImages() : []),
    getCase: async () => ({ keywords: { subjects: [{ name: 'A' }] }, analysis: { characters: [] } }),
    isCatalogSource: o.isCatalogSource, isOwnPageSource: o.isOwnPageSource, isMismatchedFbMedia: o.isMismatchedFbMedia,
  };
};
const runPOSTsw = async (body, sp, { v2 = null, v1 = null } = {}) => {
  globalThis.__MEGA_SP = sp;
  const p1 = process.env.MEGA_SEARCH_PROVENANCE ?? null, p2 = process.env.MEGA_SEARCH_SHADOW_V2 ?? null;
  if (v1 === null) delete process.env.MEGA_SEARCH_PROVENANCE; else process.env.MEGA_SEARCH_PROVENANCE = v1;
  if (v2 === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = v2;
  try { const res = await searchPOST({ json: async () => body }); return res._body; }
  finally {
    if (p1 === null) delete process.env.MEGA_SEARCH_PROVENANCE; else process.env.MEGA_SEARCH_PROVENANCE = p1;
    if (p2 === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = p2;
    delete globalThis.__MEGA_SP;
  }
};
const single = (byQ) => async (p, q) => (byQ[q] || []); // searchImages ตาม query map

// ── (V2-1) switch matrix exact-'1' + independence จาก V1 + snapshot ──
await test('V2 route: switch matrix exact-\'1\' + อิสระจาก V1', async () => {
  const sp = () => mkSPv2({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }] }) });
  for (const v of [null, '0', '', ' 1', '1 ', 'true']) assert.ok(!('searchShadowV2' in await runPOSTsw({ caseId: 'C', platform: 'google' }, sp(), { v2: v })), `v2=${JSON.stringify(v)} OFF`);
  const on = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp(), { v2: '1' });
  assert.ok('searchShadowV2' in on && on.searchShadowV2.version === 2);
  const onlyV2 = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp(), { v2: '1', v1: null });
  assert.ok('searchShadowV2' in onlyV2 && !('provenance' in onlyV2), 'V2 ON, V1 OFF → เฉพาะ searchShadowV2');
  const onlyV1 = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp(), { v2: null, v1: '1' });
  assert.ok('provenance' in onlyV1 && !('searchShadowV2' in onlyV1), 'V1 ON, V2 OFF → เฉพาะ provenance');
});

// ── (V2-2) build: queryIndex 0-based + providerRank 1-based ก่อน filter (ไม่ renumber) ──
await test('V2 route: queryIndex 0-based + providerRank 1-based pre-filter (blocked ไม่ renumber)', async () => {
  const sp = mkSPv2({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'A' }, { imageUrl: 'B' }, { imageUrl: 'C' }], q1: [{ imageUrl: 'D' }] }), isCatalogSource: (x) => x.imageUrl === 'B' });
  const r = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp, { v2: '1' });
  assert.deepEqual(r.searchShadowV2.candidates, [
    { candidateId: 'C-1', provider: 'google', queryIndex: 0, providerRank: 1 },
    { candidateId: 'C-2', provider: 'google', queryIndex: 0, providerRank: 3 }, // B(rank2) blocked → C ยัง rank3
    { candidateId: 'C-3', provider: 'google', queryIndex: 1, providerRank: 1 },
  ]);
  assert.deepEqual([r.searchShadowV2.totalCandidates, r.searchShadowV2.emittedCandidates, r.searchShadowV2.truncatedCandidates, r.searchShadowV2.capped], [3, 3, 0, false]);
});

// ── (V2-3) reversed promise completion order → deterministic ตามลำดับคำค้น ──
await test('V2 route: reversed promise resolution — deterministic queryIndex order', async () => {
  const sp = mkSPv2({ queries: ['q0', 'q1'], searchImages: async (p, q) => { const t = q === 'q0' ? 3 : 0; for (let i = 0; i < t; i++) await Promise.resolve(); return [{ imageUrl: q + 'a' }]; } });
  const r = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp, { v2: '1' });
  assert.deepEqual(r.searchShadowV2.candidates.map((c) => c.queryIndex), [0, 1], 'q0 ก่อน q1 แม้ q1 settle ก่อน');
});

// ── (V2-4) duplicate URL retains first attribution ──
await test('V2 route: duplicate URL → first attribution (q0 rank2) คงเดิม', async () => {
  const sp = mkSPv2({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'X0' }, { imageUrl: 'DUP' }], q1: [{ imageUrl: 'DUP' }, { imageUrl: 'Y' }] }) });
  const r = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp, { v2: '1' });
  const dup = r.searchShadowV2.candidates.find((c) => c.candidateId === 'C-2');
  assert.deepEqual({ queryIndex: dup.queryIndex, providerRank: dup.providerRank }, { queryIndex: 0, providerRank: 2 });
  assert.equal(r.searchShadowV2.totalCandidates, 3); // X0, DUP, Y (DUP นับครั้งเดียว)
});

// ── (V2-5) vet removal ไม่ renumber providerRank ──
await test('V2 route: vet dropped B → C ยัง providerRank 3 (ไม่ renumber)', async () => {
  const sp = mkSPv2({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }, { imageUrl: 'B' }, { imageUrl: 'C' }] }), vetImages: async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: x.imageUrl !== 'B' } })), kept: 2, dropped: 1, failed: 0 }) });
  const r = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp, { v2: '1' });
  assert.deepEqual(r.searchShadowV2.candidates, [
    { candidateId: 'C-1', provider: 'google', queryIndex: 0, providerRank: 1 },
    { candidateId: 'C-2', provider: 'google', queryIndex: 0, providerRank: 3 },
  ]);
});

// ── (V2-6) pre-existing exclusion + joinable fresh-only counters ──
await test('V2 route: exclude pre-existing (last saved.added เท่านั้น) → totalCandidates = fresh joinable', async () => {
  const sp = mkSPv2({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'A' }], q1: [{ imageUrl: 'B' }] }), existing: [{ imageUrl: 'OLD', id: 'C-0' }] });
  const r = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp, { v2: '1' });
  const ids = r.searchShadowV2.candidates.map((c) => c.candidateId);
  assert.ok(!ids.includes('C-0'), 'pre-existing OLD ถูกกัน');
  assert.equal(r.searchShadowV2.totalCandidates, 2);
  assert.equal(ids.length, 2);
});

// ── (V2-7) storage error → omit V2 (V1 คงเดิม) ──
await test('V2 route: addImages throw → UNEXPECTED, ไม่มี searchShadowV2', async () => {
  const sp = mkSPv2({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }] }), addImages: async () => { throw new Error('store boom'); } });
  const r = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp, { v2: '1' });
  assert.equal(r.errorType, 'UNEXPECTED');
  assert.ok(!('searchShadowV2' in r));
});

// ── (V2-8) vet/add input bytes เท่ากันเป๊ะ ON vs OFF ──
await test('V2 route: vet input + addImages input bytes เท่ากัน ON vs OFF', async () => {
  const fx = () => mkSPv2({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'A' }], q1: [{ imageUrl: 'B' }] }) });
  await runPOSTsw({ caseId: 'C', platform: 'google' }, fx(), { v2: null }); const offVet = globalThis.__V2_VET, offAdd = globalThis.__V2_ADD;
  await runPOSTsw({ caseId: 'C', platform: 'google' }, fx(), { v2: '1' }); const onVet = globalThis.__V2_VET, onAdd = globalThis.__V2_ADD;
  assert.equal(onVet, offVet, 'vet input identical'); assert.equal(onAdd, offAdd, 'add input identical');
});

// ── (V2-9) bounds 160 + 32 KiB + truthful counters (ผ่าน _buildSearchShadowV2 ตรง) ──
await test('V2 build: 160-item cap + truthful counters (tail-trim)', async () => {
  const c = _buildSearchShadowV2(Array.from({ length: 200 }, (_, i) => ({ candidateId: 'c' + i, provider: 'google', queryIndex: 0, providerRank: i + 1 })));
  assert.deepEqual([c.version, c.totalCandidates, c.emittedCandidates, c.truncatedCandidates, c.capped], [2, 200, 160, 40, true]);
  assert.equal(c.candidates.length, 160);
  assert.equal(c.candidates[159].candidateId, 'c159');
  assert.ok(!c.candidates.some((x) => x.candidateId === 'c160'), 'tail-trim ตัดท้าย');
});
await test('V2 build: 32 KiB cap + truthful counters', async () => {
  const big = 'x'.repeat(192);
  const c = _buildSearchShadowV2(Array.from({ length: 160 }, (_, i) => ({ candidateId: big, provider: 'google', queryIndex: 0, providerRank: i + 1 })));
  assert.ok(JSON.stringify(c).length <= 32 * 1024, 'serialized ≤ 32 KiB');
  assert.ok(c.emittedCandidates < 160 && c.emittedCandidates > 100, 'ถูก trim จาก 32 KiB');
  assert.equal(c.truncatedCandidates, 160 - c.emittedCandidates);
  assert.equal(c.capped, true);
});

// ── (V2-10) sanitizer hostile matrix + zero getter invocation (descriptor-only) ──
await test('V2 sanitizer: hostile matrix → null (fail-closed)', async () => {
  const ok = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [{ candidateId: 'c1', provider: 'google', queryIndex: 0, providerRank: 1 }] };
  assert.deepEqual(_sanitizeSearchShadowV2(ok), ok);
  const bad = [
    null, undefined, 'x', 42, [], { ...ok, version: 1 }, { ...ok, version: '2' }, { ...ok, capped: 'no' },
    { ...ok, candidates: {} }, { ...ok, totalCandidates: -1 }, { ...ok, emittedCandidates: 2 }, // counter mismatch
    { ...ok, candidates: [{ candidateId: 'c', provider: 'youtube', queryIndex: 0, providerRank: 1 }] }, // provider ต้องห้าม
    { ...ok, candidates: [{ candidateId: 'x'.repeat(193), provider: 'google', queryIndex: 0, providerRank: 1 }] }, // id ยาวเกิน
    { ...ok, candidates: [{ candidateId: 'c', provider: 'google', queryIndex: -1, providerRank: 1 }] },
    { ...ok, candidates: [{ candidateId: 'c', provider: 'google', queryIndex: 0, providerRank: 0 }] }, // rank ต้อง ≥1
  ];
  for (const b of bad) assert.equal(_sanitizeSearchShadowV2(b), null, `hostile ${JSON.stringify(b)?.slice(0, 40)}`);
  // accessor บน top field → null
  const acc = { ...ok }; Object.defineProperty(acc, 'totalCandidates', { enumerable: true, get() { return 1; } });
  assert.equal(_sanitizeSearchShadowV2(acc), null);
  // class instance proto → null
  class C { } const inst = Object.assign(new C(), ok); assert.equal(_sanitizeSearchShadowV2(inst), null);
});
await test('V2 sanitizer: Proxy candidate get trap count=0 (descriptor-only)', async () => {
  let getCount = 0;
  const proxyCand = new Proxy({ candidateId: 'c1', provider: 'google', queryIndex: 0, providerRank: 1 }, { get() { getCount++; return 'HACKED'; } });
  const carrier = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [proxyCand] };
  const out = _sanitizeSearchShadowV2(carrier);
  assert.equal(getCount, 0, 'get trap ต้องไม่ถูกเรียก');
  assert.deepEqual(out.candidates[0], { candidateId: 'c1', provider: 'google', queryIndex: 0, providerRank: 1 }, 'ค่า = descriptor ไม่ใช่ HACKED');
});

// ── (V2-11) s5_search placement — nest ใน stat เดิม (ไม่มี row ใหม่) ──
const runS5SearchV2 = async (searchResp, v2env) => {
  const prev = process.env.MEGA_SEARCH_SHADOW_V2 ?? null;
  if (v2env === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = v2env;
  const job = { dossier: { images: { caseId: 'S', searchedPlatforms: [], ytFired: 'pre', searchStats: [] } } };
  const _deps = { fetchJson: async (url) => { if (String(url).includes('/api/images/search')) return searchResp; if (String(url).includes('/api/images/')) return { success: true, images: [] }; throw new Error('NO NETWORK'); } };
  try { const out = await s5_search(job, { origin: 'http://mock', _deps }); return out.dossierPatch.images.searchStats; }
  finally { if (prev === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = prev; }
};
await test('V2 s5_search: nest ใน searchStats entry เดิม (1 row) · OFF ไม่มี · malformed → omit', async () => {
  const carrier = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [{ candidateId: 'S-1', provider: 'google', queryIndex: 0, providerRank: 1 }] };
  const base = { success: true, found: 1, added: 1, vetDropped: 0, images: [], searchShadowV2: carrier };
  const onStats = await runS5SearchV2(base, '1');
  assert.equal(onStats.length, 1, 'ไม่มี row ใหม่');
  assert.deepEqual(onStats[0].searchShadowV2, carrier);
  assert.equal(onStats[0].platform, 'google');
  const offStats = await runS5SearchV2(base, null);
  assert.ok(!('searchShadowV2' in offStats[0]));
  const mal = await runS5SearchV2({ ...base, searchShadowV2: { version: 1 } }, '1');
  assert.ok(!('searchShadowV2' in mal[0]), 'malformed carrier → omit');
});

// ── (V2-12) s5_gapsearch sibling gapSearchShadowV2 + re-entry ──
const gapSPv2 = (o = {}) => ({
  searchImages: o.searchImages || (async (p, q) => { globalThis.__GAP_N = (globalThis.__GAP_N || 0) + 1; return [{ imageUrl: `${q}::${p}` }]; }),
  vetImages: o.vetImages || (async ({ images }) => ({ vetted: images.map((x) => ({ ...x, triage: { relevant: true } })), kept: images.length, dropped: 0, failed: 0 })),
  addImages: async (caseId, imgs) => { const fresh = imgs.map((im, i) => ({ ...im, id: `${caseId}-${i + 1}` })); return { added: fresh.length, total: fresh.length, byPlatform: {}, images: fresh }; },
  getCase: async () => ({ keywords: { subjects: [] }, analysis: { characters: [] } }),
});
const runGapV2 = async (im, sp, v2env) => {
  globalThis.__MEGA_SP = sp; globalThis.__MEGA_AI = async () => ({ text: '{"queries":["nq0","nq1"]}' }); globalThis.__GAP_N = 0;
  const prev = process.env.MEGA_SEARCH_SHADOW_V2 ?? null;
  if (v2env === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = v2env;
  const job = { dossier: { images: im, compass: { mainCharacters: [{ name: 'A' }] }, desk: { title: 't' } } };
  try { return await s5_gapsearch(job, { origin: 'http://mock', _deps: { fetchJson: GAP_JF } }); }
  finally { if (prev === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = prev; delete globalThis.__MEGA_SP; delete globalThis.__MEGA_AI; }
};
await test('V2 s5_gapsearch: sibling gapSearchShadowV2 (google/google_news) · OFF ไม่มี', async () => {
  const on = await runGapV2({ caseId: 'GAP', storyQueries: ['sq'] }, gapSPv2(), '1');
  assert.deepEqual(on.dossierPatch.images.gapSearchShadowV2.candidates, [
    { candidateId: 'GAP-1', provider: 'google', queryIndex: 0, providerRank: 1 },
    { candidateId: 'GAP-2', provider: 'google_news', queryIndex: 0, providerRank: 1 },
    { candidateId: 'GAP-3', provider: 'google', queryIndex: 1, providerRank: 1 },
    { candidateId: 'GAP-4', provider: 'google_news', queryIndex: 1, providerRank: 1 },
  ]);
  assert.ok(!('searchStats' in on.dossierPatch.images) || !on.dossierPatch.images.searchStats?.some((s) => s.platform === 'gap'), 'ไม่ยัด searchStats');
  const off = await runGapV2({ caseId: 'GAP', storyQueries: ['sq'] }, gapSPv2(), null);
  assert.ok(!('gapSearchShadowV2' in off.dossierPatch.images));
});
await test('V2 s5_gapsearch: re-entry (gapSearchDone) — ON=OFF, persisted sidecar untouched', async () => {
  const persisted = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [{ candidateId: 'GAP-9', provider: 'google', queryIndex: 0, providerRank: 1 }] };
  const im = { caseId: 'GAP', gapSearchDone: true, gapSearchShadowV2: persisted };
  const on = await runGapV2({ ...im }, gapSPv2(), '1');
  const off = await runGapV2({ ...im }, gapSPv2(), null);
  assert.deepEqual(on, off);
  assert.ok(!('dossierPatch' in on), 're-entry ไม่มี dossierPatch → persisted คงเดิม');
});

// ── (V2-13) strict/queue no-leak — carrier ใน dossier.images ไม่รั่วเข้า queue body ──
await test('V2 strict-chain (ALL_ON): searchShadowV2/gapSearchShadowV2 ไม่รั่วเข้า queue body/spec', async () => {
  const carrier = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [{ candidateId: 'C-1', provider: 'google', queryIndex: 0, providerRank: 1 }] };
  const seed = (job) => { job.dossier.images.searchStats = [{ platform: 'google', found: 1, added: 1, vetDropped: 0, searchShadowV2: carrier }]; job.dossier.images.gapSearchShadowV2 = carrier; };
  const A = await runStrictFlow({ s7Env: ALL_ON, mutateBeforeS6: seed });
  const B = await runStrictFlow({ s7Env: ALL_ON });
  assert.equal(A.queueCalls, 1);
  assert.ok(A.captures.rawBody && !A.captures.rawBody.includes('searchShadowV2') && !A.captures.rawBody.includes('gapSearchShadowV2'), 'queue body ไม่มี V2 carrier');
  assert.equal(A.captures.rawBody, B.captures.rawBody, 'queue body เท่ากันเป๊ะ (carrier inert)');
});

// ── (V2-14) route OFF byte-parity (V2 off, ค่าอื่นเท่าเดิม) + empty-carrier truthful ──
await test('V2 route: OFF = ไม่มี key · ON เพิ่ม searchShadowV2 ท้าย legacy คงเดิม', async () => {
  const fx = () => mkSPv2({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }] }) });
  const off = await runPOSTsw({ caseId: 'C', platform: 'google' }, fx(), { v2: null });
  const on = await runPOSTsw({ caseId: 'C', platform: 'google' }, fx(), { v2: '1' });
  assert.ok(!('searchShadowV2' in off));
  for (const k of LEGACY_SEARCH_KEYS) assert.deepEqual(on[k], off[k], `legacy key ${k} เท่าเดิม`);
  assert.deepEqual(Object.keys(on), [...LEGACY_SEARCH_KEYS, 'searchShadowV2']);
  // empty-carrier: 0 fresh → truthful empty
  const empty = await runPOSTsw({ caseId: 'C', platform: 'google' }, mkSPv2({ queries: ['q0'], searchImages: single({ q0: [] }) }), { v2: '1' });
  assert.deepEqual(empty.searchShadowV2, { version: 2, totalCandidates: 0, emittedCandidates: 0, truncatedCandidates: 0, capped: false, candidates: [] });
});

// ── (V2-15/16/17) mid-await snapshot proof via REAL deferred latch (entered→release) — flip ระหว่าง production suspended จริง ──
const mkLatch = () => { let e, g; const entered = new Promise((r) => { e = r; }); const gate = new Promise((r) => { g = r; }); return { entered, open: () => g(), hit: () => { e(); return gate; } }; };
const SETV2 = (v) => { if (v === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = v; };
// route: latch ที่ req.json() = awaited seam แรกสุดหลัง snapshot (ก่อน getCase/read/search) — ย้าย snapshot มาหลังนี่จะ fail
await test('V2 latch (route): snapshot-at-entry ก่อน req.json await — ON→OFF และ OFF→ON', async () => {
  const prev = process.env.MEGA_SEARCH_SHADOW_V2 ?? null;
  try {
    for (const [start, flip, wantV2] of [['1', null, true], [null, '1', false]]) {
      const l = mkLatch();
      globalThis.__MEGA_SP = mkSPv2({ queries: ['q0'], searchImages: single({ q0: [{ imageUrl: 'A' }] }) });
      SETV2(start);
      const p = searchPOST({ json: async () => { await l.hit(); return { caseId: 'C', platform: 'google' }; } });
      await l.entered;   // POST suspended จริงที่ req.json() (ผ่าน snapshot ที่ entry แล้ว)
      SETV2(flip);       // flip ตอน suspended
      l.open();
      const r = (await p)._body;
      assert.equal('searchShadowV2' in r, wantV2, `start=${start} flip=${flip}`);
    }
  } finally { SETV2(prev); delete globalThis.__MEGA_SP; }
});
// s5_search: latch ที่ fetchJson (dependency await แรก)
await test('V2 latch (s5_search): snapshot-at-entry ก่อน fetchJson await — ON→OFF และ OFF→ON', async () => {
  const carrier = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [{ candidateId: 'S-1', provider: 'google', queryIndex: 0, providerRank: 1 }] };
  const prev = process.env.MEGA_SEARCH_SHADOW_V2 ?? null;
  try {
    for (const [start, flip, wantV2] of [['1', null, true], [null, '1', false]]) {
      const l = mkLatch();
      SETV2(start);
      const job = { dossier: { images: { caseId: 'S', searchedPlatforms: [], ytFired: 'pre', searchStats: [] } } };
      const _deps = { fetchJson: async (url) => { if (String(url).includes('/api/images/search')) { await l.hit(); return { success: true, found: 1, added: 1, vetDropped: 0, images: [], searchShadowV2: carrier }; } return { success: true, images: [] }; } };
      const p = s5_search(job, { origin: 'http://mock', _deps });
      await l.entered;
      SETV2(flip);
      l.open();
      const stat = (await p).dossierPatch.images.searchStats[0];
      assert.equal('searchShadowV2' in stat, wantV2, `start=${start} flip=${flip}`);
    }
  } finally { SETV2(prev); }
});
// gap: latch ที่ lib fetch (_jf) = awaited seam แรกสุดหลัง snapshot
await test('V2 latch (s5_gapsearch): snapshot-at-entry ก่อน lib fetch await — ON→OFF และ OFF→ON', async () => {
  const prev = process.env.MEGA_SEARCH_SHADOW_V2 ?? null;
  try {
    for (const [start, flip, wantV2] of [['1', null, true], [null, '1', false]]) {
      const l = mkLatch();
      globalThis.__MEGA_SP = gapSPv2(); globalThis.__MEGA_AI = async () => ({ text: '{"queries":["nq0","nq1"]}' }); globalThis.__GAP_N = 0;
      SETV2(start);
      const job = { dossier: { images: { caseId: 'GAP', storyQueries: ['sq'] }, compass: { mainCharacters: [{ name: 'A' }] }, desk: { title: 't' } } };
      const jf = async (url) => { if (String(url).includes('/api/images/')) { await l.hit(); return { images: [] }; } throw new Error('NO NETWORK'); };
      const p = s5_gapsearch(job, { origin: 'http://mock', _deps: { fetchJson: jf } });
      await l.entered;
      SETV2(flip);
      l.open();
      const img = (await p).dossierPatch.images;
      assert.equal('gapSearchShadowV2' in img, wantV2, `start=${start} flip=${flip}`);
    }
  } finally { SETV2(prev); delete globalThis.__MEGA_SP; delete globalThis.__MEGA_AI; }
});

// ── (V2-18) fresh-suffix trust boundary (direct pure helper) — added>len / accessors / zero getter ──
await test('V2 fresh-suffix: added>len / accessor images / accessor id → omit (zero getter invocation)', async () => {
  const attr = new Map([['u1', { provider: 'google', queryIndex: 0, providerRank: 1 }]]);
  assert.equal(_buildSearchShadowV2FromSaved({ images: [{ id: 'C-1', imageUrl: 'u1' }], added: 5 }, attr), null, 'added>len');
  assert.equal(_buildSearchShadowV2FromSaved({ images: [], added: -1 }, attr), null, 'added<0');
  assert.equal(_buildSearchShadowV2FromSaved({ images: {}, added: 0 }, attr), null, 'images ไม่ใช่ array');
  let g1 = 0; const s1 = {}; Object.defineProperty(s1, 'images', { enumerable: true, get() { g1++; return []; } }); Object.defineProperty(s1, 'added', { value: 0 });
  assert.equal(_buildSearchShadowV2FromSaved(s1, attr), null); assert.equal(g1, 0, 'images getter ไม่ถูกเรียก');
  let g2 = 0; const row = { imageUrl: 'u1' }; Object.defineProperty(row, 'id', { enumerable: true, get() { g2++; return 'C-1'; } });
  assert.equal(_buildSearchShadowV2FromSaved({ images: [row], added: 1 }, attr), null); assert.equal(g2, 0, 'id getter ไม่ถูกเรียก');
  const ok = _buildSearchShadowV2FromSaved({ images: [{ id: 'OLD', imageUrl: 'old' }, { id: 'C-1', imageUrl: 'u1' }], added: 1 }, attr);
  assert.deepEqual(ok.candidates, [{ candidateId: 'C-1', provider: 'google', queryIndex: 0, providerRank: 1 }], 'fresh suffix เท่านั้น');
});

// ── (V2-19) real UTF-8 32 KiB cap ──
await test('V2 UTF-8 32 KiB: Unicode candidateId นับเป็น byte + over-byte carrier rejected', async () => {
  const thai = 'ก'.repeat(64); // 64 ตัว × 3 bytes = 192 UTF-8 bytes (len=64 ≤ 192)
  const c = _buildSearchShadowV2(Array.from({ length: 160 }, (_, i) => ({ candidateId: thai, provider: 'google', queryIndex: 0, providerRank: i + 1 })));
  assert.ok(new TextEncoder().encode(JSON.stringify(c)).length <= 32 * 1024, 'serialized UTF-8 ≤ 32 KiB');
  assert.ok(c.emittedCandidates < 160 && c.truncatedCandidates === 160 - c.emittedCandidates && c.capped === true, 'truthful counters');
  const big = Array.from({ length: 160 }, () => ({ candidateId: 'x'.repeat(192), provider: 'google', queryIndex: 0, providerRank: 1 }));
  assert.equal(_sanitizeSearchShadowV2({ version: 2, totalCandidates: 160, emittedCandidates: 160, truncatedCandidates: 0, capped: false, candidates: big }), null, 'over-byte carrier ถูกปฏิเสธ');
});

// ── (V2-20) bounded work — candidates.length > 160 reject ก่อน iterate ──
await test('V2 bounded: candidates.length > 160 → reject ก่อนแตะ index descriptor', async () => {
  let idxCount = 0;
  const target = Array.from({ length: 200 }, () => ({ candidateId: 'c', provider: 'google', queryIndex: 0, providerRank: 1 }));
  const proxyArr = new Proxy(target, { getOwnPropertyDescriptor(t, k) { if (typeof k === 'string' && String(Number(k)) === k) idxCount++; return Object.getOwnPropertyDescriptor(t, k); } });
  assert.equal(_sanitizeSearchShadowV2({ version: 2, totalCandidates: 200, emittedCandidates: 200, truncatedCandidates: 0, capped: false, candidates: proxyArr }), null);
  assert.equal(idxCount, 0, 'ไม่แตะ index descriptor ก่อน reject length>160');
});

// ── (V2-21) improved pre-existing coverage — incoming OLD URL exercised ──
await test('V2 route: incoming OLD URL (pre-existing) exercised → excluded from fresh suffix', async () => {
  const sp = mkSPv2({ queries: ['q0', 'q1'], searchImages: single({ q0: [{ imageUrl: 'OLD' }, { imageUrl: 'A' }], q1: [] }), existing: [{ imageUrl: 'OLD', id: 'C-0' }], readImages: () => [{ imageUrl: 'OLD' }] });
  const r = await runPOSTsw({ caseId: 'C', platform: 'google' }, sp, { v2: '1' });
  const ids = r.searchShadowV2.candidates.map((c) => c.candidateId);
  assert.ok(!ids.includes('C-0'), 'OLD (pre-existing) ไม่อยู่ fresh');
  assert.deepEqual(ids, ['C-2'], 'เฉพาะ A fresh (OLD ถูก pre-vet-dedup + ไม่อยู่ suffix)');
  assert.equal(r.searchShadowV2.totalCandidates, 1);
});

// ── (V2-22) sanitizer throwing traps + candidate accessor/class + holey/accessor array ──
await test('V2 sanitizer: throwing ownKeys/getPrototypeOf/getOwnPropertyDescriptor + accessor/class/holey → null', async () => {
  const okEl = { candidateId: 'c1', provider: 'google', queryIndex: 0, providerRank: 1 };
  const base = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [okEl] };
  assert.equal(_sanitizeSearchShadowV2(new Proxy(base, { ownKeys() { throw new Error('x'); } })), null);
  assert.equal(_sanitizeSearchShadowV2(new Proxy(base, { getPrototypeOf() { throw new Error('x'); } })), null);
  assert.equal(_sanitizeSearchShadowV2(new Proxy(base, { getOwnPropertyDescriptor() { throw new Error('x'); } })), null);
  const accEl = { provider: 'google', queryIndex: 0, providerRank: 1 }; Object.defineProperty(accEl, 'candidateId', { enumerable: true, get() { return 'c'; } });
  assert.equal(_sanitizeSearchShadowV2({ ...base, candidates: [accEl] }), null, 'candidate accessor');
  class E { } assert.equal(_sanitizeSearchShadowV2({ ...base, candidates: [Object.assign(new E(), okEl)] }), null, 'candidate class instance');
  const holey = [okEl]; holey[2] = okEl; // index 1 = hole
  assert.equal(_sanitizeSearchShadowV2({ version: 2, totalCandidates: 3, emittedCandidates: 3, truncatedCandidates: 0, capped: false, candidates: holey }), null, 'holey array');
  const accArr = [okEl]; Object.defineProperty(accArr, 0, { enumerable: true, configurable: true, get() { return okEl; } });
  assert.equal(_sanitizeSearchShadowV2({ ...base, candidates: accArr }), null, 'accessor-index array');
});

// ── (V2-23) re-entry non-vacuous — deep-frozen persisted sidecar unchanged after call ──
await test('V2 s5_gapsearch re-entry: deep-frozen persisted gapSearchShadowV2 unchanged (non-vacuous)', async () => {
  const persisted = { version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [{ candidateId: 'GAP-9', provider: 'google', queryIndex: 0, providerRank: 1 }] };
  const snap = JSON.parse(JSON.stringify(persisted));
  persisted.candidates.forEach((c) => Object.freeze(c)); Object.freeze(persisted.candidates); Object.freeze(persisted);
  const im = { caseId: 'GAP', gapSearchDone: true, gapSearchShadowV2: persisted };
  const on = await runGapV2(im, gapSPv2(), '1');
  assert.ok(!('dossierPatch' in on), 're-entry ไม่มี dossierPatch');
  assert.deepEqual(persisted, snap, 'persisted ไม่ถูกแตะ');
  assert.deepEqual(im.gapSearchShadowV2, snap, 'im.gapSearchShadowV2 คงเดิม');
});

// ── (V2-24) s5_search accessor boundary — throwing searchShadowV2 getter on r → omit, getter count 0, legacy stat intact ──
await test('V2 s5_search: throwing searchShadowV2 getter บน r → omit + getter count 0 + legacy stat เดิม', async () => {
  let getCount = 0;
  const r = { success: true, found: 5, added: 3, vetDropped: 2, images: [] };
  Object.defineProperty(r, 'searchShadowV2', { enumerable: true, get() { getCount++; throw new Error('boom'); } });
  const prev = process.env.MEGA_SEARCH_SHADOW_V2 ?? null; process.env.MEGA_SEARCH_SHADOW_V2 = '1';
  const job = { dossier: { images: { caseId: 'S', searchedPlatforms: [], ytFired: 'pre', searchStats: [] } } };
  const _deps = { fetchJson: async (url) => { if (String(url).includes('/api/images/search')) return r; if (String(url).includes('/api/images/')) return { success: true, images: [] }; throw new Error('NO NETWORK'); } };
  try {
    const out = await s5_search(job, { origin: 'http://mock', _deps });
    assert.equal(getCount, 0, 'getter ไม่ถูกเรียก (own descriptor เท่านั้น)');
    assert.deepEqual(out.dossierPatch.images.searchStats[0], { platform: 'google', found: 5, added: 3, vetDropped: 2 }, 'legacy stat intact, ไม่มี V2');
  } finally { if (prev === null) delete process.env.MEGA_SEARCH_SHADOW_V2; else process.env.MEGA_SEARCH_SHADOW_V2 = prev; }
});

// ── (V2-25) sanitizer accessor rejections — prove ZERO getter invocation (top / candidate / array index) ──
await test('V2 sanitizer: accessor rejections prove getter count = 0 (top-field/candidate-field/array-index)', async () => {
  const okEl = () => ({ candidateId: 'c1', provider: 'google', queryIndex: 0, providerRank: 1 });
  const base = () => ({ version: 2, totalCandidates: 1, emittedCandidates: 1, truncatedCandidates: 0, capped: false, candidates: [okEl()] });
  // top-level field accessor (throwing body → ถ้าถูกเรียกจะทั้ง throw และนับ)
  let gTop = 0; const cTop = base(); Object.defineProperty(cTop, 'totalCandidates', { enumerable: true, configurable: true, get() { gTop++; throw new Error('top'); } });
  assert.equal(_sanitizeSearchShadowV2(cTop), null); assert.equal(gTop, 0, 'top-field getter 0');
  // candidate field accessor
  let gCand = 0; const el = { provider: 'google', queryIndex: 0, providerRank: 1 }; Object.defineProperty(el, 'candidateId', { enumerable: true, configurable: true, get() { gCand++; throw new Error('cand'); } });
  assert.equal(_sanitizeSearchShadowV2({ ...base(), candidates: [el] }), null); assert.equal(gCand, 0, 'candidate-field getter 0');
  // array index accessor
  let gIdx = 0; const arr = [okEl()]; Object.defineProperty(arr, 0, { enumerable: true, configurable: true, get() { gIdx++; throw new Error('idx'); } });
  assert.equal(_sanitizeSearchShadowV2({ ...base(), candidates: arr }), null); assert.equal(gIdx, 0, 'array-index getter 0');
});

console.log(`1..${passed}`);

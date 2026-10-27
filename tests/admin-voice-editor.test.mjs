// ✍️ ข้อสอบขั้น บก.เกลาภาษาแอดมิน (G2 · 27 ต.ค. 69) — จำลองโมเดล ไม่ยิง API จริง
//   A. สวิตช์ปิดค่าเริ่มต้น · ต่อท่อเฉพาะสาย TEXT หลังตรวจแก้ ก่อน grounding
//   B. เกลา 1 ฉบับ: สั้นพอ = เรียกครั้งเดียว · ยาวเกิน = ตัดซ้ำ · สั้นกว่า 146 คำ = คงฉบับก่อนหน้า · ตอบข้อความล้วน (ไม่ห่อ JSON)
//   C. ทั้งชุด: ฉบับที่ล้ม = ฉบับเดิมทุกไบต์ + คำเตือน · title/provenance ไม่เปลี่ยน · เก็บฉบับก่อนเกลา
//   E. เวลา: เหลือน้อยหลังกันเวลาให้ด่านหลัง = ข้าม · หมดเวลาทั้งขั้น = เก็บฉบับที่เสร็จแล้ว (ผู้ตรวจอิสระ 27 ต.ค. ข้อ 1/3/6)
//   D. เลือกโพสต์ตัวอย่าง: ต้นทางการ์ด → หมวดเดียวกัน · ไม่ใช้โพสต์ของคนเดียวกับในข่าว
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': `${ROOT}src` }, interopDefault: true });
const AV = await jiti.import(`${ROOT}src/lib/services/adminVoiceEditor.js`);
// เส้นตายรวมตัวเดียวกับที่ adminVoiceEditor อ่าน (โหลดผ่าน jiti ตัวเดียวกัน = โมดูลเดียวกัน)
const { createPipelineDeadline, runWithPipelineDeadline } = await jiti.import(`${ROOT}src/lib/utils/pipelineDeadline.js`);

// "แมว" = 1 คำตามตัวนับคำไทย (ICU) — n คำจริง ไม่บวมจากการตัดคำ
const longThai = (n) => Array.from({ length: n }, () => 'แมว').join(' ');
const withEnv = async (vars, fn) => {
  const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('A1 สวิตช์ปิดค่าเริ่มต้น · เปิดเฉพาะ ADMIN_VOICE_EDIT=1', async () => {
  await withEnv({ ADMIN_VOICE_EDIT: undefined }, () => assert.equal(AV.isAdminVoiceEditEnabled(), false));
  await withEnv({ ADMIN_VOICE_EDIT: 'true' }, () => assert.equal(AV.isAdminVoiceEditEnabled(), false));
  await withEnv({ ADMIN_VOICE_EDIT: '1' }, () => assert.equal(AV.isAdminVoiceEditEnabled(), true));
  await withEnv({ ADMIN_VOICE_EDIT: ' "1" ' }, () => assert.equal(AV.isAdminVoiceEditEnabled(), true, 'ทนช่องว่าง/อัญประกาศแบบสวิตช์อื่นของระบบ'));
});

test('A2 ต่อท่อ: หลัง correction ก่อน grounding · เฉพาะ text/plain_text · ส่งการ์ดของมุม', () => {
  const src = readFileSync(`${ROOT}src/lib/services/autoFlowServiceText.js`, 'utf8');
  const at = src.indexOf('isAdminVoiceEditEnabled() &&');
  assert.ok(at > 0, 'ต้องเรียกหลังเช็คสวิตช์');
  assert.ok(at > src.indexOf('runCorrectionPipeline('), 'ต้องอยู่หลังตรวจแก้');
  assert.ok(at < src.indexOf('let grounding = assessRawTextSafety('), 'ต้องอยู่ก่อน grounding');
  assert.match(src.slice(at, at + 200), /detectedType === 'text' \|\| detectedType === 'plain_text'/);
  assert.match(src.slice(at, at + 700), /runAdminVoiceEdit\(finalVersions, \{ rawText, cards: anglePrompts, reserveMs: isRawFactCompletenessGateEnabled\(\) \? 200_000 : 30_000 \}\)/);
});

test('B1 เกลาแล้วสั้นพอ = เรียกโมเดลครั้งเดียว (ขั้นเสียงแอดมิน)', async () => {
  const calls = [];
  const out = longThai(170);
  const r = await AV.editOneAdminVoice({ text: longThai(250), exemplarBlock: 'EX', callModel: async (a) => { calls.push(a); return out; }, max: 5000 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /ภาษาแอดมินเพจ/);
  assert.match(calls[0].system, /ห้ามเดาเพศ/, 'กฎบ้านห้ามเดาเพศต้องอยู่ในคำสั่ง บก.');
  assert.match(calls[0].prompt, /^EX/);
  assert.equal(AV.ADMIN_VOICE_MODEL, 'claude-opus-4-8');
  assert.equal(r.text, out);
});

test('B2 ยังยาวเกิน = ตัดซ้ำด้วยบก.ตัดอย่างเดียว (ไม่แนบตัวอย่างซ้ำ)', async () => {
  const calls = [];
  const long = longThai(400), short = longThai(160);
  const r = await AV.editOneAdminVoice({ text: long, exemplarBlock: 'EX', callModel: async (a) => { calls.push(a); return calls.length === 1 ? long : short; }, max: 1500 });
  assert.equal(calls.length, 2);
  assert.match(calls[1].system, /ตัดอย่างเดียว/);
  assert.doesNotMatch(calls[1].prompt, /^EX/);
  assert.equal(r.text, short);
});

test('B3 ผลสั้นกว่า 146 คำ = คงฉบับก่อนหน้า (ไม่ส่งของสั้นเข้าด่านความยาว)', async () => {
  const orig = longThai(200);
  const r = await AV.editOneAdminVoice({ text: orig, callModel: async () => longThai(100) });
  assert.equal(r.text, orig);
  assert.equal(r.steps.length, 1);
  // ขอบพอดี: 146 คำ = รับ · 145 คำ = ไม่รับ
  assert.equal(AV.ADMIN_VOICE_MIN_WORDS, 146);
  assert.equal((await AV.editOneAdminVoice({ text: orig, callModel: async () => longThai(146) })).text, longThai(146));
  assert.equal((await AV.editOneAdminVoice({ text: orig, callModel: async () => longThai(145) })).text, orig);
});

test('E1 เวลางานเหลือน้อย (หลังกันเวลาให้ด่านหลัง) = ข้ามทั้งขั้น ไม่เรียกโมเดล ฉบับเดิมทุกตัว', async () => {
  let n = 0;
  const v = { title: 'T', content: longThai(220), promptId: 'p1' };
  const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 60_000 });
  const r = await runWithPipelineDeadline(deadline, () => AV.runAdminVoiceEdit([v], { callModel: async () => { n++; return longThai(180); }, reserveMs: 30_000 }));
  assert.equal(n, 0);
  assert.equal(r.versions[0], v);
  assert.equal(r.applied, 0);
  assert.match(r.summaryLine, /ข้าม/);
});

test('E3 ไม่ถึงเกณฑ์ข้าม: เพดานขั้น = เวลาที่เหลือ − กันไว้ (ไม่ใช่เพดานเต็ม) · หลังขั้นยังเหลือเวลาให้ด่านหลังตามที่กัน', async () => {
  const timers = [];
  const callModel = () => new Promise((resolve) => { timers.push(setTimeout(() => resolve(longThai(170)), 3_000)); }); // โมเดลช้ากว่าเวลาที่มี
  try {
    await withEnv({ DEADLINE_MIN_START_DEFAULT_MS: '100' }, async () => {
      const deadline = createPipelineDeadline({ deadlineAt: Date.now() + 1_500 });
      const v = { title: 'T', content: longThai(220), promptId: 'p1' };
      const r = await runWithPipelineDeadline(deadline, async () => {
        const out = await AV.runAdminVoiceEdit([v], { callModel, timeoutMs: 150_000, reserveMs: 1_000, minStageMs: 100 });
        return { out, left: deadline.remainingMs() };
      });
      assert.equal(r.out.versions[0], v, 'หมดเวลา = ฉบับเดิม');
      assert.ok(r.left >= 850, `ต้องเหลือเวลาให้ด่านหลังราว 1,000ms (เหลือ ${r.left}ms)`);
    });
  } finally { for (const t of timers) clearTimeout(t); }
});

test('E4 เกลาเสียงผ่านแล้ว แต่หมดเวลาระหว่างรอบตัด = ใช้ฉบับที่เกลาแล้ว (ไม่ทิ้งกลับเป็นฉบับเดิม)', async () => {
  const timers = [];
  const voiced = longThai(400); // ยาวเกิน max → ต้องเข้ารอบตัด
  let n = 0;
  const callModel = () => new Promise((resolve) => { n++; timers.push(setTimeout(() => resolve(n === 1 ? voiced : longThai(170)), n === 1 ? 5 : 1_000)); });
  try {
    const v = { title: 'T', content: longThai(500), promptId: 'p1' };
    const r = await AV.runAdminVoiceEdit([v], { callModel, timeoutMs: 200 });
    assert.equal(r.versions[0].content, voiced, 'ต้องได้ฉบับเกลาเสียง');
    assert.equal(r.applied, 1);
  } finally { for (const t of timers) clearTimeout(t); }
});

test('E2 หมดเวลาทั้งขั้น: ฉบับที่เสร็จก่อนยังใช้ · ฉบับที่ค้าง = ตัวเดิม + คำเตือน · ไม่โยน error', async () => {
  const v1 = { title: 'T1', content: longThai(220), promptId: 'p1' };
  const v2 = { title: 'T2', content: `${longThai(230)} ช้าง`, promptId: 'p2' };
  const fast = longThai(170);
  const timers = [];
  const callModel = (a) => new Promise((resolve) => {
    // ฉบับ "ช้าง" ตอบช้ากว่าเพดานขั้น (timer ref + เคลียร์ท้ายเทส กัน event loop ว่าง/ค้าง)
    timers.push(setTimeout(() => resolve(fast), a.prompt.includes('ช้าง') ? 1_000 : 5));
  });
  try {
    const r = await AV.runAdminVoiceEdit([v1, v2], { callModel, timeoutMs: 200 });
    assert.equal(r.versions[0].content, fast, 'ฉบับที่เสร็จก่อนต้องได้ใช้');
    assert.equal(r.versions[1], v2, 'ฉบับที่ค้างต้องเป็นตัวเดิม');
    assert.equal(r.applied, 1);
    assert.match(r.warning, /V2/);
  } finally { for (const t of timers) clearTimeout(t); }
});

test('C1 ทั้งชุด: ฉบับที่ล้ม = ตัวเดิม + คำเตือน · ฉบับที่สำเร็จ = เนื้อใหม่ title/provenance เดิม', async () => {
  const v1 = { title: 'T1', content: longThai(220), usedModel: 'claude-opus-4-8', _source: 'classic', _sourceLabel: 'มุม 1', promptId: 'p1' };
  const v2 = { title: 'T2', content: `${longThai(230)} ช้าง`, usedModel: 'claude-opus-4-8', _source: 'classic', _sourceLabel: 'มุม 2', promptId: 'p2' };
  const edited = longThai(180);
  const callModel = async (a) => { if (a.prompt.includes('ช้าง')) throw new Error('boom'); return edited; };
  const r = await AV.runAdminVoiceEdit([v1, v2], { rawText: 'ข่าวทดสอบ', cards: [{ id: 'p1', category: 'อบอุ่นใจ' }], callModel });
  assert.equal(r.applied, 1);
  assert.equal(r.versions[1], v2, 'ฉบับที่ล้มต้องเป็นตัวเดิม');
  assert.match(r.warning, /V2/);
  const a = r.versions[0];
  assert.equal(a.content, edited);
  assert.equal(a._preAdminVoiceContent, v1.content);
  for (const k of ['title', 'usedModel', '_source', '_sourceLabel', 'promptId']) assert.equal(a[k], v1[k], k);
  assert.equal(a._adminVoice.applied, true);
});

test('C2 ไม่มีฉบับ = คืนตามเดิม ไม่เรียกโมเดล', async () => {
  let n = 0;
  const r = await AV.runAdminVoiceEdit([], { callModel: async () => { n++; return ''; } });
  assert.deepEqual(r.versions, []);
  assert.equal(n, 0);
});

test('D1 เลือกโพสต์ตัวอย่าง: ต้นทางการ์ดก่อน แล้วหมวดเดียวกัน · ไม่ใช้โพสต์ของคนเดียวกับในข่าว', () => {
  const posts = [
    { id: '1', views: 5e6, category: 'ความรัก', caption: 'โพสต์ต้นทางการ์ด เรื่องหนึ่ง' },
    { id: '2', views: 9e6, category: 'ความรัก', caption: 'โพสต์ความรักอีกเรื่อง' },
    { id: '3', views: 8e6, category: 'ความรัก', caption: 'ข่าวของสมศรีสุขใจ คนเดียวกับในข่าว' },
    { id: '4', views: 7e6, category: 'ความรัก', caption: 'โพสต์ความรักเรื่องที่สาม' },
    { id: '5', views: 9.9e6, category: 'ข่าวเตือนใจ', caption: 'หมวดอื่นยอดสูงสุด' },
  ];
  const picked = AV.pickAdminVoiceExemplars({ sourceContentId: 'fb_1', category: 'ความรัก' }, 'สมศรีสุขใจ ทำความดี', 3, posts).map((p) => p.id);
  assert.deepEqual(picked, ['1', '2', '4']);
  const noCard = AV.pickAdminVoiceExemplars(null, '', 2, posts).map((p) => p.id);
  assert.deepEqual(noCard, ['5', '2'], 'ไม่มีการ์ด = ยอดสูงสุดทั้งคลัง');
});

test('D2 คลังตัวอย่างจริง: โพสต์ 254 ชิ้น มีหมวดครบ', () => {
  const data = JSON.parse(readFileSync(`${ROOT}data/admin-voice-exemplars.json`, 'utf8'));
  assert.equal(data.length, 254);
  assert.ok(data.every((p) => p.id && p.caption && p.category && p.views > 0));
});

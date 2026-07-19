// ============================================================
// 🧪 Research Interview Lane (เฟส 6 — เลนสัมภาษณ์คนดัง) — offline unit test
// Target: src/lib/services/deskV2/researchInterview.js
//   • planInterviewQueries        — สร้างคำค้นเลนสัมภาษณ์ (bucket:'people', lane:'interview')
//   • confirmObservedName         — 🔴 หัวใจกฎห้ามเดาชื่อ/สรรพนามระบุเพศ
//   • classifyInterviewCandidate  — แปะ field interview ลง candidate (default nameStatus='expected')
// pure: import ผ่าน dnaContract (crypto builtin) เท่านั้น — ไม่ต้อง stub persistStore/openai/aiRouter
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OPENERS,
  SECONDARY,
  ANGLES,
  planInterviewQueries,
  confirmObservedName,
  classifyInterviewCandidate,
} from '../src/lib/services/deskV2/researchInterview.js';

const INTERVIEW_PATH = new URL('../src/lib/services/deskV2/researchInterview.js', import.meta.url);
const WATCHLIST_PATH = new URL('../src/lib/services/deskV2/researchWatchlist.js', import.meta.url);

function peopleOf(n, prefix = 'คน') {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `${prefix}${i}` }));
}

// ── constants ตามสเปก ──
test('constants: OPENERS/SECONDARY/ANGLES ตรงสเปก (ค่า/น้ำหนัก)', () => {
  assert.deepEqual(OPENERS.map((o) => o.text), ['เผย', 'เปิดใจ']);
  assert.equal(OPENERS[0].weight, 31);
  assert.equal(OPENERS[1].weight, 12);
  assert.deepEqual(SECONDARY.map((o) => o.text), ['ควง', 'แฉ']);
  assert.equal(SECONDARY[0].weight, 2);
  assert.equal(SECONDARY[1].weight, 1);
  assert.equal(ANGLES.length, 7);
  assert.equal(ANGLES[0].text, 'น้ำตา');
  assert.equal(ANGLES[0].weight, 6);
  assert.ok(ANGLES.slice(1).every((a) => a.weight === undefined));
});

// ── planInterviewQueries ──
test('planInterviewQueries: ชื่อมี quote รอบ + opener + angle ในทุกใบ, bucket/lane ถูกต้อง', () => {
  const plan = planInterviewQueries({ people: ['แพท ณปภา'], channels: ['youtube'], runSeed: 'r1' });
  assert.ok(plan.length > 0);
  for (const q of plan) {
    assert.equal(q.bucket, 'people');
    assert.equal(q.lane, 'interview');
    assert.match(q.text, /^"[^"]+"\s.+\s.+/, `รูปแบบต้องเป็น "ชื่อ(หรือรายการ+ชื่อ)" opener angle ได้ "${q.text}"`);
    assert.ok(q.text.includes(`"แพท ณปภา"`), 'ต้องมีชื่อคนใน quote');
    assert.equal(q.expectedName, 'แพท ณปภา');
  }
});

test('planInterviewQueries: ตัวอย่างรูปแบบ program+person มี quote 2 ชั้น', () => {
  const plan = planInterviewQueries({ people: ['แพท ณปภา'], programs: ['แฉ'], channels: ['youtube'], runSeed: 'r1' });
  const programQ = plan.find((q) => q.program === 'แฉ');
  assert.ok(programQ, 'ต้องมี query ที่ผูกกับ program');
  assert.match(programQ.text, /^"แฉ"\s"แพท ณปภา"\s/);
  assert.equal(programQ.expectedName, 'แพท ณปภา');
});

test('planInterviewQueries: รวมจำนวนทั้งหมด ไม่เกิน maxCalls เสมอ (คน 27 × channel 4 × program 2)', () => {
  const plan = planInterviewQueries({
    people: peopleOf(27),
    programs: ['แฉ', 'Sad Bar'],
    channels: ['youtube', 'tiktok', 'facebook', 'google'],
    variantsPerPerson: 2,
    maxCalls: 40,
    runSeed: 'cap-test',
  });
  assert.ok(plan.length <= 40, `ยาว ${plan.length} ต้อง <= 40`);
  assert.ok(plan.length > 0);
});

test('planInterviewQueries: ครอบทุก channel ที่ส่งมา (เมื่องบพอ) แต่ไม่เกิน cap', () => {
  const channels = ['youtube', 'tiktok', 'facebook', 'google'];
  const plan = planInterviewQueries({ people: peopleOf(27), programs: ['แฉ'], channels, maxCalls: 40, runSeed: 'ch-test' });
  const seen = new Set(plan.map((q) => q.targetChannel));
  for (const ch of channels) assert.ok(seen.has(ch), `ต้องเห็น channel ${ch} อย่างน้อย 1 ใบ`);
  assert.ok(plan.length <= 40);
});

test('planInterviewQueries: ห้ามสร้าง Cartesian เต็ม (27×สูตร×แพลตฟอร์ม) — maxCalls เล็กต้องตัดจริง ไม่ล้น', () => {
  const plan = planInterviewQueries({
    people: peopleOf(27),
    programs: ['แฉ', 'Sad Bar'],
    channels: ['youtube', 'tiktok', 'facebook', 'google'],
    variantsPerPerson: 2,
    maxCalls: 5,
    runSeed: 'small-cap',
  });
  assert.equal(plan.length, 5, 'ต้องตัดพอดีที่ 5 ไม่ใช่สร้างเต็ม 200+ ใบแล้วค่อย slice');
});

test('planInterviewQueries: opener กระจายตามน้ำหนัก (เผย มากกว่า เปิดใจ อย่างชัดเจน)', () => {
  const plan = planInterviewQueries({ people: peopleOf(27), channels: [], variantsPerPerson: 2, maxCalls: 500, runSeed: 'dist' });
  const counts = { เผย: 0, เปิดใจ: 0 };
  for (const q of plan) {
    if (q.opener === 'เผย') counts['เผย']++;
    else if (q.opener === 'เปิดใจ') counts['เปิดใจ']++;
  }
  assert.ok(counts['เผย'] > 0 && counts['เปิดใจ'] > 0, 'ต้องมีทั้งสองแบบปรากฏ');
  assert.ok(counts['เผย'] > counts['เปิดใจ'], `เผย(${counts['เผย']}) ต้องมากกว่า เปิดใจ(${counts['เปิดใจ']})`);
});

test('planInterviewQueries: runSeed เดิม (แม้คนละ object reference) → ผลเดิมเป๊ะ (deterministic)', () => {
  const input = { people: ['แพท ณปภา', 'อั้ม พัชราภา'], programs: ['แฉ'], channels: ['youtube', 'tiktok'], runSeed: 'stable-seed' };
  const p1 = planInterviewQueries(input);
  const p2 = planInterviewQueries(input);
  assert.deepEqual(p1, p2);
  const p3 = planInterviewQueries(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(p1, p3);
});

test('planInterviewQueries: ไม่ mutate people/programs/channels ที่ส่งเข้ามา', () => {
  const people = ['แพท ณปภา'];
  const programs = ['แฉ'];
  const channels = ['youtube'];
  const before = JSON.stringify({ people, programs, channels });
  planInterviewQueries({ people, programs, channels, runSeed: 'x' });
  assert.equal(JSON.stringify({ people, programs, channels }), before);
});

test('planInterviewQueries: input ว่าง/ไม่ส่ง → ไม่ throw คืน []', () => {
  assert.deepEqual(planInterviewQueries(), []);
  assert.deepEqual(planInterviewQueries({}), []);
  assert.deepEqual(planInterviewQueries({ people: [] }), []);
});

// ── confirmObservedName — 🔴 หัวใจกฎห้ามเดาชื่อ ──
test('confirmObservedName: title มีชื่อ exact → matched/title', () => {
  const r = confirmObservedName({ expectedName: 'แพท ณปภา', title: 'แพท ณปภา เผยความในใจครั้งแรก' });
  assert.equal(r.nameStatus, 'matched');
  assert.equal(r.nameEvidence, 'title');
  assert.equal(r.observedName, 'แพท ณปภา');
});

test('confirmObservedName: snippet มีชื่อ exact (title ไม่มี) → matched/snippet', () => {
  const r = confirmObservedName({ expectedName: 'อั้ม พัชราภา', title: 'นักแสดงดังเปิดใจกลางรายการ', snippet: 'อั้ม พัชราภา ให้สัมภาษณ์พิเศษ' });
  assert.equal(r.nameStatus, 'matched');
  assert.equal(r.nameEvidence, 'snippet');
  assert.equal(r.observedName, 'อั้ม พัชราภา');
});

test('confirmObservedName: speakers[] มีชื่อ (title/snippet ไม่มี) → matched/speaker', () => {
  const r = confirmObservedName({
    expectedName: 'บุ๋ม ปนัดดา',
    title: 'พิธีกรคุยกับแขกรับเชิญ',
    snippet: '',
    speakers: ['บุ๋ม ปนัดดา', 'พิธีกร'],
  });
  assert.equal(r.nameStatus, 'matched');
  assert.equal(r.nameEvidence, 'speaker');
  assert.equal(r.observedName, 'บุ๋ม ปนัดดา');
});

test('confirmObservedName: transcript มีชื่อ exact (ฟิลด์อื่นไม่มี) → matched/transcript', () => {
  const r = confirmObservedName({
    expectedName: 'ตูน Bodyslam',
    transcript: 'วันนี้พูดคุยกับ ตูน Bodyslam เรื่องราวชีวิตนักดนตรี',
  });
  assert.equal(r.nameStatus, 'matched');
  assert.equal(r.nameEvidence, 'transcript');
  assert.equal(r.observedName, 'ตูน Bodyslam');
});

test('confirmObservedName: headline ทั่วไปไม่มีชื่อ exact → expected + observedName:null (ห้ามบอกว่าเป็นใคร)', () => {
  const r = confirmObservedName({ expectedName: 'แอน ทองประสม', title: 'นักแสดงชายในคลิปเผยความในใจกลางงาน' });
  assert.equal(r.nameStatus, 'expected');
  assert.equal(r.observedName, null);
  assert.equal(r.nameEvidence, null);
});

test('confirmObservedName: ไม่มีอะไรตรงเลย (ไม่มีเนื้อหาให้ตรวจ) → unknown', () => {
  const r = confirmObservedName({ expectedName: 'แอน ทองประสม' });
  assert.equal(r.nameStatus, 'unknown');
  assert.equal(r.observedName, null);
  assert.equal(r.nameEvidence, null);
});

test('confirmObservedName: ชื่อฝังเป็น substring ไม่มีขอบเขต (ไม่มีช่องว่างคั่น) → ไม่ matched', () => {
  const r = confirmObservedName({ expectedName: 'คิว', title: 'ประเทศคิวบามีเมืองหลวงคือฮาวานา' });
  assert.notEqual(r.nameStatus, 'matched');
});

// 🔴 ยืนยันไม่มีการสร้าง เขา/เธอ/ชาย/หญิง จากชื่อ (ห้ามเดาเพศ) — ใช้ชื่อที่รู้เพศชัดเจน + title ไม่มีชื่อ
test('confirmObservedName: ไม่สร้างสรรพนามระบุเพศจากชื่อ — ทั้งเคส expected และ unknown', () => {
  const genderedNames = ['แอน ทองประสม', 'อั้ม พัชราภา', 'ตูน Bodyslam', 'เสก โลโซ'];
  const genericTitles = [
    'นักแสดงสาวรายหนึ่งเปิดใจกลางงาน',
    'นักร้องหนุ่มเผยเรื่องราวชีวิต',
    '',
  ];
  for (const expectedName of genderedNames) {
    for (const title of genericTitles) {
      const r = confirmObservedName({ expectedName, title, snippet: '' });
      assert.notEqual(r.nameStatus, 'matched', `ไม่ควร matched (expectedName=${expectedName}, title="${title}")`);
      assert.equal(r.observedName, null, `observedName ต้องเป็น null (expectedName=${expectedName})`);
      const dump = JSON.stringify(r);
      assert.ok(!/เธอ|หญิง|ชาย|เขา/.test(dump), `ห้ามมีคำสรรพนามระบุเพศในผลลัพธ์ ได้ ${dump}`);
    }
  }
});

// ── classifyInterviewCandidate ──
test('classifyInterviewCandidate: nameStatus default = expected เมื่อไม่มีหลักฐาน', () => {
  const queryPlan = { id: 'interview-0', expectedName: 'แพท ณปภา', program: null, opener: 'เผย', angle: 'จุดเปลี่ยน' };
  const candidate = { title: 'ข่าวทั่วไปไม่เกี่ยวข้องกับใคร', snippet: '', url: 'https://example.com/a' };
  const out = classifyInterviewCandidate(candidate, queryPlan);
  assert.equal(out.interview.nameStatus, 'expected');
  assert.equal(out.interview.observedName, null);
  assert.equal(out.interview.expectedName, 'แพท ณปภา');
  assert.equal(out.interview.queryId, 'interview-0');
  assert.equal(out.interview.opener, 'เผย');
  assert.equal(out.interview.angle, 'จุดเปลี่ยน');
  assert.equal(out.interview.program, null);
  // candidate เดิมต้องอยู่ครบ (ไม่ mutate/ไม่หาย)
  assert.equal(out.url, 'https://example.com/a');
});

test('classifyInterviewCandidate: มีหลักฐานจริงใน title → nameStatus matched ไม่ใช่ expected', () => {
  const queryPlan = { id: 'interview-1', expectedName: 'อั้ม พัชราภา', program: 'แฉ', opener: 'เผย', angle: 'มรสุม' };
  const candidate = { title: 'อั้ม พัชราภา เผยเรื่องราวมรสุมชีวิต', snippet: '' };
  const out = classifyInterviewCandidate(candidate, queryPlan);
  assert.equal(out.interview.nameStatus, 'matched');
  assert.equal(out.interview.nameEvidence, 'title');
  assert.equal(out.interview.observedName, 'อั้ม พัชราภา');
});

test('classifyInterviewCandidate: ไม่ mutate candidate เดิม (คืน object ใหม่)', () => {
  const queryPlan = { id: 'interview-2', expectedName: 'แพท ณปภา' };
  const candidate = { title: 'เฉยๆ' };
  const before = JSON.stringify(candidate);
  const out = classifyInterviewCandidate(candidate, queryPlan);
  assert.equal(JSON.stringify(candidate), before);
  assert.notEqual(out, candidate);
});

// ── ยืนยันไม่มี import ต้องห้าม (deskV2 rule) — อ่านทั้ง 2 ไฟล์ ──
test('researchInterview.js + researchWatchlist.js ต้องไม่มีคำว่า openai/aiRouter/persistStore/callAI/interviewMiner', () => {
  for (const path of [INTERVIEW_PATH, WATCHLIST_PATH]) {
    const src = readFileSync(path, 'utf8');
    assert.ok(!/openai/i.test(src), `${path}: ห้ามมีคำว่า openai`);
    assert.ok(!/aiRouter/i.test(src), `${path}: ห้ามมีคำว่า aiRouter`);
    assert.ok(!/persistStore/i.test(src), `${path}: ห้ามมีคำว่า persistStore`);
    assert.ok(!/callAI/i.test(src), `${path}: ห้ามมีคำว่า callAI`);
    assert.ok(!/interviewMiner/i.test(src), `${path}: ห้ามมีคำว่า interviewMiner`);
  }
});

test('researchInterview.js + researchWatchlist.js: import ได้เฉพาะ dnaContract.js + ห้าม import * / Math.random / Date.now', () => {
  for (const path of [INTERVIEW_PATH, WATCHLIST_PATH]) {
    const src = readFileSync(path, 'utf8');
    const importSpecs = [...src.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const spec of importSpecs) {
      assert.ok(spec.endsWith('dnaContract.js'), `${path}: import ต้องห้าม: ${spec}`);
    }
    assert.ok(!/import\s*\*/.test(src), `${path}: ห้าม import *`);
    assert.ok(!/Math\.random/.test(src), `${path}: ห้ามใช้ Math.random`);
    assert.ok(!/Date\.now/.test(src), `${path}: ห้ามใช้ Date.now`);
  }
});

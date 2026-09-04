// ข้อสอบสคริปต์นำเข้าชุดครู writers-v1 (scripts/import-writer-teachers.mjs) — WF5 · 4 ก.ย. 69
// รัน: node --test tests/import-writer-teachers.test.mjs (ไม่ต้องตั้ง env · ห้ามแตะ DB — pure functions + spawn dry-run จริง 1 ครั้ง)
// ข้อมูลจริงล้วน อ่านอย่างเดียว: data/teachers-writers-v1.json + data/viral-likes-real.json + data/viral-essences.json
// ไฟล์ที่เขียนอยู่ใน tmpdir เท่านั้น
// เขียวทั้ง "ก่อน" และ "หลัง" นำเข้าจริง: ข้อ 1-7/9-10 ใช้ "ภาพก่อนนำเข้า" ที่สร้างในหน่วยความจำ (ตัดรายการ writers-v1 ออกจากไฟล์จริง)
// ข้อ 11 ตรวจสภาพหลังนำเข้า (วงจรซ้ำต้องเป็นศูนย์) · ข้อ 8/14 spawn บนไฟล์จริงตามสภาพปัจจุบัน
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ID_NAMESPACE, POOL_TAG, MATCHED_BY, SOURCE, MANIFEST_KIND, INSERT_COLUMNS, ESSENCE_KEYS, LIKES_FLOOR, MIN_CONTENT, SHELVES,
  deriveTeacherId, normalizeContentKey, parseTags, rowHasPoolTag, validateTeacher, selectTeachers, buildInsertRow,
  buildLikesEntry, buildEssenceCard, detectJsonFormat, serializeJson, assertRoundTrip, mergeLikes, mergeEssences,
  planImport, buildManifest, restoreDataFiles, buildVerifyReport, runApply, summarizePlan, assertInsertReturned, isUsablePriorManifest, assertRollbackIds, runRollback,
} from '../scripts/import-writer-teachers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = ROOT + '-run';
const SCRIPT = path.join(ROOT, 'scripts', 'import-writer-teachers.mjs');
const readRoot = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── ข้อมูลจริง (อ่านครั้งเดียว — เทสห้ามเขียนไฟล์พวกนี้) ──
const dataFile = JSON.parse(readRoot('data/teachers-writers-v1.json'));
const teachers = dataFile.teachers;
// ไฟล์จริง "ตามสภาพปัจจุบัน" (ก่อนหรือหลัง --apply ก็ได้) — ใช้เฉพาะข้อที่ต้องดูสภาพจริง (8, 11, 14)
const likesRealRaw = readRoot('data/viral-likes-real.json');
const essencesRealRaw = readRoot('data/viral-essences.json');
const likesRealData = JSON.parse(likesRealRaw);
const essRealData = JSON.parse(essencesRealRaw);
// "ภาพก่อนนำเข้า" ในหน่วยความจำ: ตัดรายการของ writers-v1 (matchedBy = ป้ายชุด หรือ id อยู่ในชุด) ออกจากไฟล์จริง
// แล้ว serialize กลับด้วย format เดิมของไฟล์ → ไม่ขึ้นกับว่าเจ้าของรัน --apply ไปแล้วหรือยัง
const TEACHER_IDS = new Set(teachers.map((t) => t.id));
function stripWritersV1(raw, kind) {
  const { data, fmt } = assertRoundTrip(raw, 'ไฟล์จริง ' + kind);
  if (kind === 'likes') {
    const byId = {};
    for (const [id, e] of Object.entries(data.byId)) if (!(e?.matchedBy === MATCHED_BY || TEACHER_IDS.has(id))) byId[id] = e;
    const out = {};
    for (const k of Object.keys(data)) out[k] = k === 'byId' ? byId : data[k];
    return serializeJson(out, fmt);
  }
  const out = {};
  for (const [id, card] of Object.entries(data)) if (!TEACHER_IDS.has(id)) out[id] = card;
  return serializeJson(out, fmt);
}
const likesRaw = stripWritersV1(likesRealRaw, 'likes');
const essencesRaw = stripWritersV1(essencesRealRaw, 'essences');
const likesData = JSON.parse(likesRaw);
const essData = JSON.parse(essencesRaw);
// สภาพไฟล์จริงตอนนี้: จำนวนใบของชุดที่อยู่ในไฟล์จริงแล้ว (ครบ = นำเข้าแล้ว · 0 = ยังไม่นำเข้า · อื่นๆ = งานค้าง ข้อ 11 จะแดง)
const inLikesReal = teachers.filter((t) => likesRealData.byId[t.id]).length;
const inEssReal = teachers.filter((t) => essRealData[t.id]).length;

// ค่าคงที่ของชุด (เขียนซ้ำอิสระจากสคริปต์ — ใครแก้ฝั่งสคริปต์ต้องแดงที่นี่)
const EXPECTED_TOTAL = 28;
const IMPORTED = inLikesReal === EXPECTED_TOTAL && inEssReal === EXPECTED_TOTAL;
const EXPECTED_AUTHORS = { 'Nisada Jaraket': 17, 'Po Ny': 11 };
const EXPECTED_MASTERS = 4;
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const freshPlan = (extra = {}) => planImport({ teachers: dataFile, likesRaw, essencesRaw, ...extra });
const clone = (v) => JSON.parse(JSON.stringify(v));

test('1) ไฟล์ข้อมูล 28 ใบผ่าน validateTeacher ทุกใบ · id ตรง deriveTeacherId · ไม่ซ้ำ · ไม่ชนคลังเดิม', () => {
  assert.equal(dataFile.kind, 'teachers-writers-v1');
  assert.equal(dataFile.source, 'igdara-writers-v1');
  assert.equal(teachers.length, EXPECTED_TOTAL);
  assert.equal(ID_NAMESPACE, 'igdara-writers-v1');
  assert.equal(POOL_TAG, 'igdara-writers-v1');
  assert.equal(MATCHED_BY, 'igdara-writers-v1');
  assert.equal(SOURCE, 'igdara-writers-v1');
  assert.equal(LIKES_FLOOR, 30000);
  assert.equal(MIN_CONTENT, 200);
  assert.equal(SHELVES.length, 14);
  const byAuthor = {};
  let masters = 0;
  for (const t of teachers) {
    assert.doesNotThrow(() => validateTeacher(t), `ใบ ${t.id.slice(0, 8)} ต้องผ่าน`);
    assert.equal(validateTeacher(t), t, 'ผ่าน = คืนใบเดิม');
    const id = deriveTeacherId(t.sourceUrl);
    assert.match(id, V4);
    assert.equal(id, t.id, `id ในไฟล์ต้องคำนวณซ้ำได้จาก sha256('${ID_NAMESPACE}:' + sourceUrl)`);
    assert.equal(deriveTeacherId(t.sourceUrl), id, 'เรียกซ้ำต้องได้ค่าเดิม');
    assert.ok(t.content.length > MIN_CONTENT && t.engagement_likes >= LIKES_FLOOR);
    assert.ok(SHELVES.includes(t.category));
    assert.ok(!essData[t.id], 'ห้ามชนบัตรลักษณะเดิม: ' + t.id);
    assert.ok(!likesData.byId[t.id], 'ห้ามชน likes เดิม: ' + t.id);
    byAuthor[t.author] = (byAuthor[t.author] || 0) + 1;
    if (t.tier === 'master') { masters++; assert.ok(t.engagement_likes >= 80000, 'master ต้อง ≥ 80,000'); }
  }
  assert.deepEqual(byAuthor, EXPECTED_AUTHORS);
  assert.equal(masters, EXPECTED_MASTERS);
  assert.equal(new Set(teachers.map((t) => t.id)).size, EXPECTED_TOTAL, 'id ห้ามซ้ำ');
  assert.equal(new Set(teachers.map((t) => normalizeContentKey(t.content))).size, EXPECTED_TOTAL, 'เนื้อห้ามซ้ำ');
  assert.equal(selectTeachers(dataFile).length, EXPECTED_TOTAL);
  assert.equal(selectTeachers(teachers).length, EXPECTED_TOTAL, 'รับอาเรย์ตรงๆ ได้');
  // สูตร id ต้องไม่ใช่สูตรชุด 3 ก.ย. (เกลือคนละตัว) และปฏิเสธคีย์ที่ไม่ใช่ URL
  assert.throws(() => deriveTeacherId('1566277485525968'), /ไม่ถูกต้อง/);
  assert.throws(() => deriveTeacherId(''), /ไม่ถูกต้อง/);
  assert.notEqual(deriveTeacherId(teachers[0].sourceUrl), deriveTeacherId(teachers[0].sourceUrl + 'x'));
});

test('1b) validateTeacher กัดจริง: ทุกเกณฑ์ในสเปกต้องโยนเมื่อเพี้ยน', () => {
  const base = teachers[0];
  const mut = (patch) => ({ ...clone(base), ...patch });
  const cases = [
    [{ id: teachers[1].id }, /id ไม่ตรงสูตร/],
    [{ sourceUrl: base.sourceUrl + '?x', source_url: base.sourceUrl + '?x' }, /id ไม่ตรงสูตร/],
    [{ source_url: 'https://other' }, /source_url/],
    [{ content: base.content.slice(0, 150), title: base.content.slice(0, 80) }, /content ยาว/],
    [{ engagement_likes: 29999 }, /engagement_likes/],
    [{ engagement_likes: 33000.5 }, /engagement_likes/],
    [{ category: 'หมวดแปลก' }, /category/],
    [{ title: base.content.slice(0, 79) }, /title/],
    [{ tags: ['author:' + base.author, 'tier:' + base.tier] }, /ป้ายพูล/],
    [{ tags: [POOL_TAG, 'tier:' + base.tier] }, /author:/],
    [{ tags: [POOL_TAG, 'author:' + base.author] }, /tier:/],
    [{ tags: 'igdara-writers-v1' }, /tags/],
    [{ essence: { structure: base.essence.structure, emotion: base.essence.emotion, themes: base.essence.themes, tone: base.essence.tone } }, /ลำดับคีย์/],
    [{ essence: { ...base.essence, extra: 1 } }, /แปลกปลอม/],
    [{ essence: { ...base.essence, emotion: [] } }, /emotion/],
    [{ writing_notes: '   ' }, /writing_notes/],
    [{ source: 'proposal-3sep69' }, /source/],
    [{ tier: 'junior' }, /tier/],
    [{ author: '' }, /author/],
  ];
  for (const [patch, re] of cases) assert.throws(() => validateTeacher(mut(patch)), re, 'ต้องโยน: ' + JSON.stringify(Object.keys(patch)));
  // ซ้ำกันเองในชุด = error (id / เนื้อ / URL)
  assert.throws(() => selectTeachers([base, clone(base)]), /ซ้ำกันเองในชุด/);
  assert.throws(() => selectTeachers({ kind: 'teachers-writers-v1', source: SOURCE, teachers: [] }), /ว่าง/);
  assert.throws(() => selectTeachers({ kind: 'other', source: SOURCE, teachers: [base] }), /kind/);
});

test('2) buildInsertRow ตรง INSERT_COLUMNS เป๊ะ — ไม่มี essence/author/tier/reactions หลุดเข้าตาราง · tags อาเรย์สตริง', () => {
  assert.deepEqual([...INSERT_COLUMNS], ['id', 'category', 'title', 'content', 'source_url', 'writing_notes', 'engagement_likes', 'tags']);
  for (const t of teachers) {
    const row = buildInsertRow(t);
    assert.deepEqual(Object.keys(row), [...INSERT_COLUMNS], 'คีย์+ลำดับต้องตรง INSERT_COLUMNS เป๊ะ');
    for (const k of ['essence', 'author', 'tier', 'reactions', 'comments', 'shares', 'capturedTime', 'sourceUrl', 'source']) assert.ok(!(k in row), 'ห้ามคีย์ ' + k);
    assert.equal(row.id, t.id);
    assert.equal(row.source_url, t.sourceUrl, 'source_url ต้องเป็น URL โพสต์เต็ม');
    assert.equal(typeof row.engagement_likes, 'number');
    assert.equal(row.engagement_likes, t.engagement_likes);
    assert.equal(row.content, t.content, 'content ยกตรงตัว ห้ามแก้');
    assert.ok(Array.isArray(row.tags) && row.tags.every((x) => typeof x === 'string'));
    assert.deepEqual(row.tags, [POOL_TAG, 'author:' + t.author, 'tier:' + t.tier]);
    assert.ok(rowHasPoolTag(row));
  }
  // สัญญากับผู้อ่านจริง: คอลัมน์ที่ viralFewshot.js select ต้องเป็นส่วนย่อยของคอลัมน์ที่เรา insert
  // หาสตริงคอลัมน์ตรงๆ ไม่ผูกกับรูปบรรทัด select (เลน B ห่อเป็น _poolSelect(POOL_SELECT_BASE) ได้) · เทียบทั้ง worktree และ HEAD
  const COLS_RE = /['`](id, title, content, writing_notes, category, engagement_likes[^'`]*)['`]/;
  const sources = [['worktree', readRoot('src/lib/services/viralFewshot.js')]];
  const head = spawnSync('git', ['show', 'HEAD:src/lib/services/viralFewshot.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (head.status === 0 && head.stdout) sources.push(['HEAD', head.stdout]);
  for (const [label, src] of sources) {
    const m = src.match(COLS_RE);
    assert.ok(m, `ต้องเจอสตริงคอลัมน์ select ของ viral_examples ใน viralFewshot.js (${label})`);
    for (const c of m[1].split(',').map((s) => s.trim()).filter((s) => /^[a-z_]+$/.test(s))) assert.ok(INSERT_COLUMNS.includes(c), `ระบบอ่านคอลัมน์ ${c} (${label}) แต่แถวนำเข้าไม่มี`);
  }
  // และคอลัมน์ tags ที่พูล writers-v1 ใช้กรอง ต้องอยู่ในแถวนำเข้า
  assert.ok(INSERT_COLUMNS.includes('tags'));
  // parseTags/rowHasPoolTag รับทั้งอาเรย์ · สตริง JSON · text[] literal
  assert.ok(rowHasPoolTag({ tags: '["igdara-writers-v1","tier:master"]' }));
  assert.ok(rowHasPoolTag({ tags: '{igdara-writers-v1,"author:Po Ny"}' }));
  assert.ok(!rowHasPoolTag({ tags: [] }) && !rowHasPoolTag({ tags: null }) && !rowHasPoolTag({}) && !rowHasPoolTag({ tags: 'x' }));
  assert.deepEqual(parseTags('[bad'), []);
});

test('3) likes entry / essence card โครง+ลำดับคีย์ตรงไฟล์จริง', () => {
  const sampleLikes = likesData.byId[Object.keys(likesData.byId)[0]];
  const sampleCard = essData[Object.keys(essData)[0]];
  assert.deepEqual(Object.keys(sampleLikes), ['likes', 'matchedBy'], 'โครง entry ไฟล์จริงเปลี่ยน — ต้องมาแก้ที่นี่');
  assert.deepEqual(Object.keys(sampleCard), [...ESSENCE_KEYS], 'ลำดับคีย์บัตรไฟล์จริงเปลี่ยน — ต้องมาแก้ที่นี่');
  for (const t of teachers) {
    const le = buildLikesEntry(t);
    assert.equal(JSON.stringify(le), `{"likes":${t.engagement_likes},"matchedBy":"igdara-writers-v1"}`);
    const card = buildEssenceCard(t.essence);
    assert.deepEqual(Object.keys(card), [...ESSENCE_KEYS]);
    assert.deepEqual(card, t.essence);
    assert.notEqual(card.themes, t.essence.themes, 'ต้องคัดลอกอาเรย์ ไม่แชร์ reference');
    for (const th of card.themes) assert.ok(Array.from(th).length >= 4, `ธีมสั้นกว่า 4 ตัวอักษรจะไม่ถูกให้คะแนน (SL.MIN_LEN): "${th}"`);
  }
  assert.throws(() => buildLikesEntry({ engagement_likes: 0 }), /ไลก์/);
  assert.throws(() => buildEssenceCard(null), /object/);
  assert.throws(() => buildEssenceCard({ emotion: ['a'], structure: '', themes: ['ยาวพอ'], tone: 't' }), /structure/);
});

test('4) mergeLikes/mergeEssences round-trip ไบต์เดิมกับไฟล์จริงปัจจุบัน + เติมท้ายเท่านั้น + ห้ามทับ', () => {
  const likes = assertRoundTrip(likesRaw, 'likes');
  const ess = assertRoundTrip(essencesRaw, 'essences');
  assert.equal(serializeJson(mergeLikes(likes.data, {}).data, likes.fmt), likesRaw, 'merge ว่างต้องคืนไบต์ไฟล์เดิมเป๊ะ');
  assert.equal(serializeJson(mergeEssences(ess.data, {}).data, ess.fmt), essencesRaw, 'merge ว่างต้องคืนไบต์ไฟล์เดิมเป๊ะ');
  const plan = freshPlan();
  const afterLikes = JSON.parse(plan.likes.after);
  const afterEss = JSON.parse(plan.essences.after);
  const oldLikeIds = Object.keys(likesData.byId);
  const oldEssIds = Object.keys(essData);
  assert.equal(Object.keys(afterLikes.byId).length, oldLikeIds.length + EXPECTED_TOTAL);
  assert.equal(Object.keys(afterEss).length, oldEssIds.length + EXPECTED_TOTAL);
  assert.deepEqual(Object.keys(afterLikes.byId).slice(0, oldLikeIds.length), oldLikeIds, 'likes ของเดิมอยู่ครบตามลำดับเดิม (ต่อท้ายเท่านั้น)');
  assert.deepEqual(Object.keys(afterEss).slice(0, oldEssIds.length), oldEssIds, 'บัตรเดิมอยู่ครบตามลำดับเดิม');
  assert.deepEqual(Object.keys(afterLikes.byId).slice(oldLikeIds.length), teachers.map((t) => t.id), 'ต่อท้ายตามลำดับไฟล์ข้อมูล');
  for (const id of oldLikeIds) assert.deepEqual(afterLikes.byId[id], likesData.byId[id]);
  for (const id of oldEssIds) assert.deepEqual(afterEss[id], essData[id]);
  assert.deepEqual(afterLikes.byKey, likesData.byKey, 'byKey ห้ามแตะ');
  for (const t of teachers) {
    assert.deepEqual(afterLikes.byId[t.id], { likes: t.engagement_likes, matchedBy: 'igdara-writers-v1' });
    assert.deepEqual(afterEss[t.id], t.essence);
  }
  // format คงเดิม + round-trip ต่อได้รอบหน้า
  for (const [f, before] of [[plan.likes, likesRaw], [plan.essences, essencesRaw]]) {
    assert.deepEqual(detectJsonFormat(f.after), detectJsonFormat(before));
    assert.doesNotThrow(() => assertRoundTrip(f.after, 'หลังเติม'));
  }
  assert.deepEqual(detectJsonFormat(likesRaw), { eol: '\r\n', indent: 2, trailing: '\r\n' });
  assert.deepEqual(detectJsonFormat(essencesRaw), { eol: '\r\n', indent: 1, trailing: '' });
  // ห้ามทับ + ห้ามกลายพันธุ์ input
  const victim = oldLikeIds[0];
  const hostile = mergeLikes(likes.data, { [victim]: { likes: 1, matchedBy: 'x' } });
  assert.deepEqual(hostile.skippedExisting, [victim]);
  assert.deepEqual(hostile.data.byId[victim], likesData.byId[victim]);
  const hostileEss = mergeEssences(ess.data, { [oldEssIds[0]]: teachers[0].essence });
  assert.deepEqual(hostileEss.skippedExisting, [oldEssIds[0]]);
  assert.deepEqual(hostileEss.data[oldEssIds[0]], essData[oldEssIds[0]]);
  assert.equal(JSON.stringify(likes.data), JSON.stringify(JSON.parse(likesRaw)));
  assert.equal(JSON.stringify(ess.data), JSON.stringify(JSON.parse(essencesRaw)));
  assert.throws(() => assertRoundTrip(likesRaw + ' ', 'เพี้ยน'), /round-trip/);
  assert.throws(() => assertRoundTrip('\uFEFF' + likesRaw, 'บอม'), /BOM/);
});

test('5) planImport: ตารางว่าง → insert 28 · ตารางมีครบ → insert 0 เติมไฟล์ที่ขาด · เนื้อซ้ำคนละ id → ข้าม+เตือน', () => {
  // ก) offline (ไม่มีตาราง) และตารางว่าง → insert 28 ทั้งคู่
  for (const existingRows of [null, []]) {
    const plan = freshPlan({ existingRows });
    assert.equal(plan.insertRows.length, EXPECTED_TOTAL);
    assert.equal(plan.skipped.length, 0);
    assert.deepEqual(plan.warnings, []);
    assert.deepEqual(plan.likes.added, teachers.map((t) => t.id));
    assert.deepEqual(plan.essences.added, teachers.map((t) => t.id));
    for (const r of plan.insertRows) assert.deepEqual(Object.keys(r), [...INSERT_COLUMNS]);
  }
  // ข) ตารางมีครบทั้ง 28 (id เดิม) → insert 0 · ไฟล์ยังต้องเติมตามที่ขาด (28 เพราะไฟล์จริงยังไม่มี)
  const full = teachers.map((t) => buildInsertRow(t));
  const planB = freshPlan({ existingRows: full });
  assert.equal(planB.insertRows.length, 0);
  assert.equal(planB.skipped.length, EXPECTED_TOTAL);
  assert.ok(planB.skipped.every((e) => e.skip.reason === 'id-in-table'));
  assert.equal(planB.likes.added.length, EXPECTED_TOTAL, 'งานค้างต้องเติมไฟล์ต่อได้');
  assert.equal(planB.essences.added.length, EXPECTED_TOTAL);
  // ข2) ไฟล์มีบางใบแล้ว → เติมเฉพาะที่ขาด
  const likesHalf = { ...likesData, byId: { ...likesData.byId } };
  for (const t of teachers.slice(0, 10)) likesHalf.byId[t.id] = { likes: t.engagement_likes, matchedBy: MATCHED_BY };
  const likesHalfRaw = serializeJson(likesHalf, detectJsonFormat(likesRaw));
  const planB2 = freshPlan({ existingRows: full, likesRaw: likesHalfRaw });
  assert.equal(planB2.likes.added.length, EXPECTED_TOTAL - 10);
  assert.deepEqual(planB2.likes.skippedExisting, teachers.slice(0, 10).map((t) => t.id));
  assert.equal(planB2.essences.added.length, EXPECTED_TOTAL);
  // ค) เนื้อชนแถวเดิมคนละ id (เช่น import มือไว้ก่อน) → ข้ามทั้งใบ + เตือน · ห้ามเติมไฟล์ด้วย id เรา
  const first = teachers[0];
  const foreign = [{ id: 'ffffffff-0000-4000-8000-000000000000', content: '  ' + first.content.replace(/\n/g, ' \n ') + ' ', tags: [] }];
  const planC = freshPlan({ existingRows: foreign });
  const e0 = planC.entries.find((e) => e.id === first.id);
  assert.equal(e0.skip?.reason, 'content-in-table');
  assert.equal(e0.skip.foreignId, 'ffffffff-0000-4000-8000-000000000000');
  assert.equal(planC.insertRows.length, EXPECTED_TOTAL - 1);
  assert.equal(planC.warnings.length, 1);
  assert.match(planC.warnings[0], /เนื้อชนแถวเดิม/);
  assert.ok(!planC.likes.added.includes(first.id), 'ห้ามเติม likes ด้วย id ที่ไม่มีจริงในตาราง');
  assert.ok(!planC.essences.added.includes(first.id));
  assert.equal(normalizeContentKey(' ก .ข '), normalizeContentKey('ก.ข'));
  // ง) offline + manifest เดิมมี id → skip:manifest-prior (ของจริงตัดสินตอน --apply)
  const planD = freshPlan({ existingRows: null, priorManifest: { kind: MANIFEST_KIND, ids: [first.id] } });
  assert.equal(planD.entries.find((e) => e.id === first.id).skip?.reason, 'manifest-prior');
  assert.equal(planD.insertRows.length, EXPECTED_TOTAL - 1);
  // จ) ซ้ำกันเองในชุด = error
  assert.throws(() => planImport({ teachers: [first, { ...clone(first) }], likesRaw, essencesRaw }), /ซ้ำกันเองในชุด/);
});

test('6) TEACHER_IMPORT_APPLY=0 → runApply โยนก่อนแตะอะไร (ไม่มี backup/manifest เกิด)', async () => {
  const before = fs.existsSync(RUN_DIR) ? fs.readdirSync(RUN_DIR) : [];
  // เข็มขัด 1: ยามต้องอยู่ในซอร์สจริง (กันถดถอย) · เข็มขัด 2: client ที่โยนทันที = พิสูจน์ว่ายามมาก่อน IO ทุกชนิด
  assert.match(readRoot('scripts/import-writer-teachers.mjs'), /env\.TEACHER_IMPORT_APPLY === '0'/, 'ยาม TEACHER_IMPORT_APPLY=0 หายจากสคริปต์');
  let clientCalls = 0;
  const bomb = async () => { clientCalls++; throw new Error('BOOM: ห้ามแตะ client ก่อนยาม'); };
  await assert.rejects(runApply({ env: { TEACHER_IMPORT_APPLY: '0' }, client: bomb }), /TEACHER_IMPORT_APPLY=0/);
  assert.equal(clientCalls, 0, 'ยามต้องโยนก่อนสร้าง client');
  // และแบบ env จริง (เส้นที่ CLI ใช้)
  const prev = process.env.TEACHER_IMPORT_APPLY;
  process.env.TEACHER_IMPORT_APPLY = '0';
  try {
    await assert.rejects(runApply({ client: bomb }), /TEACHER_IMPORT_APPLY=0/);
  } finally {
    if (prev === undefined) delete process.env.TEACHER_IMPORT_APPLY; else process.env.TEACHER_IMPORT_APPLY = prev;
  }
  assert.equal(clientCalls, 0);
  const after = fs.existsSync(RUN_DIR) ? fs.readdirSync(RUN_DIR) : [];
  assert.deepEqual(after, before, 'ห้ามมีไฟล์ใหม่ใน run-dir');
  assert.ok(!after.some((f) => f.startsWith('backup-writer-teachers-')) || before.some((f) => f.startsWith('backup-writer-teachers-')));
});

test('7) restoreDataFiles คืนไบต์ตรง backup (tmpdir) · backup ไม่ครบ = ไม่แตะไฟล์ไหนเลย', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-writer-teachers-test-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const backupDir = path.join(tmp, 'backup');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    for (const [name, raw] of [['viral-likes-real.json', likesRaw], ['viral-essences.json', essencesRaw]]) {
      fs.writeFileSync(path.join(dataDir, name), raw, 'utf8');
      fs.writeFileSync(path.join(backupDir, name), raw, 'utf8');
    }
    const plan = freshPlan();
    fs.writeFileSync(path.join(dataDir, 'viral-likes-real.json'), plan.likes.after, 'utf8');
    fs.writeFileSync(path.join(dataDir, 'viral-essences.json'), plan.essences.after, 'utf8');
    assert.notEqual(fs.readFileSync(path.join(dataDir, 'viral-likes-real.json'), 'utf8'), likesRaw);
    // backup ขาด 1 ไฟล์ → ต้องปฏิเสธก่อนแตะไฟล์แรก
    const half = path.join(tmp, 'half');
    fs.mkdirSync(half);
    fs.writeFileSync(path.join(half, 'viral-likes-real.json'), likesRaw, 'utf8');
    assert.throws(() => restoreDataFiles({ backupDir: half, root: tmp }), /ไม่พบไฟล์ backup/);
    assert.equal(fs.readFileSync(path.join(dataDir, 'viral-likes-real.json'), 'utf8'), plan.likes.after, 'backup ไม่ครบ = ห้ามคืนไฟล์ไหนเลย');
    const results = restoreDataFiles({ backupDir, root: tmp });
    assert.equal(results.length, 2);
    assert.ok(Buffer.from(likesRaw, 'utf8').equals(fs.readFileSync(path.join(dataDir, 'viral-likes-real.json'))), 'likes ต้องกลับไบต์เดิมเป๊ะ');
    assert.ok(Buffer.from(essencesRaw, 'utf8').equals(fs.readFileSync(path.join(dataDir, 'viral-essences.json'))), 'บัตรต้องกลับไบต์เดิมเป๊ะ');
    assert.throws(() => restoreDataFiles({ backupDir: path.join(tmp, 'no-such'), root: tmp }), /ไม่พบไฟล์ backup/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('8) dry-run จริง (spawn): exit 0 · มีคำว่า dry-run · ไม่มี "insert แล้ว" · ไม่มี backup/manifest ใหม่ · ไฟล์ data ไบต์เดิม', () => {
  const snap = () => (fs.existsSync(RUN_DIR) ? fs.readdirSync(RUN_DIR).filter((f) => f.startsWith('backup-writer-teachers-') || f === 'writer-teachers-import-manifest.json') : []);
  const before = snap();
  const likesBytes = fs.readFileSync(path.join(ROOT, 'data', 'viral-likes-real.json'));
  const essBytes = fs.readFileSync(path.join(ROOT, 'data', 'viral-essences.json'));
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, TEACHER_IMPORT_APPLY: '0', TEACHER_IMPORT_OFFLINE: '1' } });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, 'dry-run ต้อง exit 0\n' + out.slice(-1500));
  assert.match(out, /dry-run/);
  assert.ok(!out.includes('insert แล้ว'), 'dry-run ห้ามพิมพ์ว่า insert แล้ว');
  assert.ok(!out.includes('backup แล้ว'));
  assert.match(out, /ชุดครู writers-v1 28 ใบ/);
  assert.match(out, /Nisada Jaraket 17/);
  assert.match(out, /Po Ny 11/);
  assert.match(out, /สรุป: insert \d+ แถว/);
  assert.match(out, /data\/viral-likes-real\.json: \+\d+ key/);
  assert.match(out, /data\/viral-essences\.json: \+\d+ key/);
  assert.match(out, /offline/, 'TEACHER_IMPORT_OFFLINE=1 ต้องบอกว่า offline');
  assert.match(out, /ในชุดทั้งหมด master \d+ · senior \d+/);
  for (const t of teachers) assert.ok(out.includes(t.id.slice(0, 8) + ' · ' + t.author), 'ต้องพิมพ์ทุกใบ: ' + t.id.slice(0, 8));
  assert.deepEqual(snap(), before, 'dry-run ห้ามสร้าง backup/manifest');
  assert.ok(likesBytes.equals(fs.readFileSync(path.join(ROOT, 'data', 'viral-likes-real.json'))), 'dry-run ห้ามแตะ likes');
  assert.ok(essBytes.equals(fs.readFileSync(path.join(ROOT, 'data', 'viral-essences.json'))), 'dry-run ห้ามแตะบัตร');
  // arg เพี้ยน → exit 1 + usage
  const bad = spawnSync(process.execPath, [SCRIPT, '--nuke'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /ใช้:/);
});

test('9) manifest: kind ของงานนี้ · id ครบ 28 · backupDir ชี้สำเนา "ก่อนนำเข้าครั้งแรก" เสมอ · rows มี author/tier', () => {
  const plan = freshPlan();
  const at = '2026-09-04T00:00:00.000Z';
  const m1 = buildManifest({ at, phase: 'complete', backupDir: 'X:/bk-first', entries: plan.fileEntries });
  assert.equal(m1.kind, 'writer-teachers-import-manifest');
  assert.equal(m1.poolTag, POOL_TAG);
  assert.equal(m1.idNamespace, ID_NAMESPACE);
  assert.deepEqual([...m1.ids].sort(), teachers.map((t) => t.id).sort());
  assert.equal(m1.backupDir, 'X:/bk-first');
  assert.equal(m1.rows.length, EXPECTED_TOTAL);
  assert.deepEqual(m1.files, ['data/viral-likes-real.json', 'data/viral-essences.json']);
  for (const r of m1.rows) {
    const t = teachers.find((x) => x.id === r.id);
    assert.ok(t && r.author === t.author && r.tier === t.tier && r.sourceUrl === t.sourceUrl && r.likes === t.engagement_likes && r.category === t.category && r.title === t.title);
  }
  const m2 = buildManifest({ prior: m1, at, phase: 'complete', backupDir: 'X:/bk-second', entries: plan.fileEntries });
  assert.equal(m2.backupDir, 'X:/bk-first', 'backupDir ต้องเป็นสำเนาก่อนนำเข้าครั้งแรกเสมอ');
  assert.equal(m2.lastBackupDir, 'X:/bk-second');
  assert.equal(m2.ids.length, EXPECTED_TOTAL, 'merge ซ้ำห้ามได้ id เกิน 28');
  assert.equal(m2.runs.length, 2);
});

test('10) buildVerifyReport: ครบ = ok · ขาดในตาราง/ไฟล์/ไม่มีป้าย = ไม่ ok พร้อมรายการ · offline ตรวจเฉพาะไฟล์', () => {
  const plan = freshPlan();
  const full = teachers.map((t) => buildInsertRow(t));
  const ok = buildVerifyReport({ teachers: dataFile, likesRaw: plan.likes.after, essencesRaw: plan.essences.after, existingRows: [...full, { id: 'zzz', content: 'x', tags: [] }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.table.taggedRows, EXPECTED_TOTAL);
  assert.equal(ok.table.totalRows, EXPECTED_TOTAL + 1);
  assert.deepEqual(ok.table.strangers, []);
  const missing = buildVerifyReport({ teachers: dataFile, likesRaw: plan.likes.after, essencesRaw: plan.essences.after, existingRows: full.slice(1) });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.table.missing, [teachers[0].id]);
  const untagged = buildVerifyReport({ teachers: dataFile, likesRaw: plan.likes.after, essencesRaw: plan.essences.after, existingRows: [{ ...full[0], tags: [] }, ...full.slice(1)] });
  assert.equal(untagged.ok, false);
  assert.deepEqual(untagged.table.untagged, [teachers[0].id]);
  const noFiles = buildVerifyReport({ teachers: dataFile, likesRaw, essencesRaw, existingRows: full });
  assert.equal(noFiles.ok, false);
  assert.equal(noFiles.likesMissing.length, EXPECTED_TOTAL);
  assert.equal(noFiles.essMissing.length, EXPECTED_TOTAL);
  const offline = buildVerifyReport({ teachers: dataFile, likesRaw: plan.likes.after, essencesRaw: plan.essences.after, existingRows: null });
  assert.equal(offline.ok, true);
  assert.equal(offline.table, null);
  const wrongLikes = JSON.parse(plan.likes.after);
  wrongLikes.byId[teachers[0].id] = { likes: 1, matchedBy: MATCHED_BY };
  const wrong = buildVerifyReport({ teachers: dataFile, likesRaw: JSON.stringify(wrongLikes), essencesRaw: plan.essences.after, existingRows: full });
  assert.deepEqual(wrong.likesWrong, [teachers[0].id]);
  assert.equal(wrong.ok, false);
});

test('11) สภาพหลังนำเข้าแล้ว: planImport บนไฟล์ที่เติมครบ + ตารางครบ → insert 0 · เติมไฟล์ 0 · ไฟล์ไบต์เดิม · verify ok (ไฟล์จริงปัจจุบันต้องเป็น "ครบ 28" หรือ "ไม่มีเลย" เท่านั้น)', () => {
  const full = teachers.map((t) => buildInsertRow(t));
  const after = freshPlan(); // ภาพก่อนนำเข้า + เติม 28 = ภาพหลังนำเข้า (จำลองในหน่วยความจำ)
  const check = (likesR, essR, label) => {
    const plan = planImport({ teachers: dataFile, likesRaw: likesR, essencesRaw: essR, existingRows: full });
    assert.equal(plan.insertRows.length, 0, label + ': insert ต้อง 0');
    assert.equal(plan.skipped.length, EXPECTED_TOTAL);
    assert.ok(plan.skipped.every((e) => e.skip.reason === 'id-in-table'), label + ': ทุกใบต้องข้ามเพราะ id อยู่ในตาราง');
    assert.deepEqual(plan.warnings, []);
    assert.deepEqual(plan.likes.added, [], label + ': likes ห้ามเติมซ้ำ');
    assert.deepEqual(plan.essences.added, [], label + ': บัตรห้ามเติมซ้ำ');
    assert.deepEqual(plan.likes.skippedExisting, teachers.map((t) => t.id));
    assert.deepEqual(plan.essences.skippedExisting, teachers.map((t) => t.id));
    assert.equal(plan.likes.after, likesR, label + ': likes ต้องไบต์เดิม (ไม่มีอะไรเติม)');
    assert.equal(plan.essences.after, essR, label + ': บัตรต้องไบต์เดิม');
    const v = buildVerifyReport({ teachers: dataFile, likesRaw: likesR, essencesRaw: essR, existingRows: full });
    assert.deepEqual([v.likesMissing, v.likesWrong, v.essMissing], [[], [], []], label + ': ไฟล์ต้องครบ+ค่าตรง');
    assert.equal(v.ok, true, label + ': verify ต้อง ok');
    assert.equal(v.table.taggedRows, EXPECTED_TOTAL);
    const offline = buildVerifyReport({ teachers: dataFile, likesRaw: likesR, essencesRaw: essR, existingRows: null });
    assert.equal(offline.ok, true, label + ': verify offline ต้อง ok');
  };
  check(after.likes.after, after.essences.after, 'ภาพจำลองหลังนำเข้า');
  // ไฟล์จริงปัจจุบัน: ต้องครบ 28 ทั้งสองไฟล์ (นำเข้าแล้ว) หรือไม่มีเลย (ยังไม่นำเข้า) — ครึ่งๆ = งานค้าง ต้องมาดู
  assert.ok(IMPORTED || (inLikesReal === 0 && inEssReal === 0), `ไฟล์จริงค้างครึ่งทาง: likes ${inLikesReal}/${EXPECTED_TOTAL} · บัตร ${inEssReal}/${EXPECTED_TOTAL} — รัน --verify/--apply ให้จบ`);
  if (IMPORTED) {
    check(likesRealRaw, essencesRealRaw, 'ไฟล์จริงปัจจุบัน (นำเข้าแล้ว)');
    for (const t of teachers) assert.deepEqual(likesRealData.byId[t.id], { likes: t.engagement_likes, matchedBy: MATCHED_BY });
    for (const t of teachers) assert.deepEqual(essRealData[t.id], t.essence);
  } else {
    assert.equal(likesRealRaw, likesRaw, 'ยังไม่นำเข้า: ภาพก่อนนำเข้าต้องเท่าไฟล์จริงไบต์ต่อไบต์');
    assert.equal(essencesRealRaw, essencesRaw);
  }
});

test('12) assertInsertReturned: ครบ = คืน id เรียง · ขาด/เกิน/แปลกปลอม/null = โยน', () => {
  const rows = [{ id: 'b' }, { id: 'a' }];
  assert.deepEqual(assertInsertReturned([{ id: 'a' }, { id: 'b' }], rows), ['a', 'b']);
  assert.throws(() => assertInsertReturned([{ id: 'a' }], rows), /ได้ 1\/2/);
  assert.throws(() => assertInsertReturned([{ id: 'a' }, { id: 'b' }, { id: 'c' }], rows), /ได้ 3\/2/);
  assert.throws(() => assertInsertReturned([{ id: 'a' }, { id: 'x' }], rows), /ไม่ครบ/);
  assert.throws(() => assertInsertReturned(null, rows), /ได้ 0\/2/);
});

test('13) summarizePlan: วงเล็บหลัง insert นับเฉพาะใบไม่ skip · "ในชุด" นับทั้งไฟล์', () => {
  const plan = planImport({ teachers, likesRaw, essencesRaw, existingRows: null, priorManifest: null });
  const all = summarizePlan(plan);
  assert.equal(all.insert.master + all.insert.senior, EXPECTED_TOTAL);
  assert.deepEqual(all.set, all.insert);
  const master = teachers.find((x) => x.tier === 'master');
  const partial = planImport({ teachers, likesRaw, essencesRaw, existingRows: [{ id: master.id, content: master.content, tags: [POOL_TAG] }], priorManifest: null });
  const p = summarizePlan(partial);
  assert.equal(p.insert.master, all.set.master - 1, 'ใบ master ที่ตารางมีแล้วต้องหายจากวงเล็บ insert');
  assert.equal(p.insert.master + p.insert.senior, partial.insertRows.length, 'วงเล็บต้องเท่าจำนวน insert เสมอ');
  assert.deepEqual(p.set, all.set, 'ในชุดไม่เปลี่ยน');
});

test('14) dry-run --verbose (spawn · offline): exit 0 · พิมพ์แถวเต็ม · ไม่มี insert แล้ว', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--verbose'], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, TEACHER_IMPORT_APPLY: '0', TEACHER_IMPORT_OFFLINE: '1' } });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, out.slice(-1500));
  assert.match(out, /dry-run/);
  assert.match(out, /แถวเต็ม:/);
  assert.ok(!out.includes('insert แล้ว'));
});

// ── mock Supabase ในหน่วยความจำสำหรับเส้น rollback (select id,tags / delete().in / select id) ──
function mockSb(table, calls) {
  return {
    from: (name) => {
      const q = { _op: 'select', _cols: '', _in: null };
      q.select = (cols) => { if (q._op === 'delete') q._ret = cols; else q._cols = cols; return q; };
      q.delete = () => { q._op = 'delete'; return q; };
      q.in = (col, ids) => { q._in = ids.map(String); return q; };
      q.then = (res, rej) => {
        calls.push({ table: name, op: q._op, cols: q._cols, in: q._in });
        let data;
        if (q._op === 'delete') { const gone = table.filter((r) => q._in.includes(String(r.id))); for (const g of gone) table.splice(table.indexOf(g), 1); data = gone.map((r) => ({ id: r.id })); }
        else data = table.filter((r) => q._in.includes(String(r.id))).map((r) => (q._cols.includes('tags') ? { id: r.id, tags: r.tags } : { id: r.id }));
        return Promise.resolve({ data, error: null }).then(res, rej);
      };
      return q;
    },
  };
}
function rollbackFixture({ phase = 'db-done', ids = null, untaggedFirst = false, dropBackup = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-writer-rollback-'));
  const root = path.join(tmp, 'root'); fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const backupDir = path.join(tmp, 'backup'); fs.mkdirSync(backupDir);
  const plan = freshPlan({ existingRows: null, priorManifest: null });
  for (const [name, f] of [['viral-likes-real.json', plan.likes], ['viral-essences.json', plan.essences]]) {
    if (!dropBackup) fs.writeFileSync(path.join(backupDir, name), f.before, 'utf8');
    fs.writeFileSync(path.join(root, 'data', name), f.after, 'utf8'); // สภาพหลัง --apply
  }
  const m = buildManifest({ prior: null, at: '2026-09-04T00:00:00.000Z', phase, backupDir, entries: plan.entries, runNote: 'เทส' });
  if (ids) m.ids = ids;
  m.phase = phase;
  if (phase === 'rolled-back') m.rolledBackAt = '2026-09-04T01:00:00.000Z';
  const manifestPath = path.join(tmp, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  const table = teachers.map((x, i) => ({ id: x.id, tags: untaggedFirst && i === 0 ? ['อื่น'] : [POOL_TAG, 'author:' + x.author] }));
  table.push({ id: 'ครูเดิม-นอกชุด', tags: [] });
  return { tmp, root, backupDir, manifestPath, table, plan };
}
const bombClient = async () => { throw new Error('BOOM: ห้ามแตะ client'); };

test('15) isUsablePriorManifest: ถอยไปแล้ว = ไม่ใช้ต่อวงจร (backupDir ต้องเป็นของรอบใหม่)', () => {
  const base = { kind: MANIFEST_KIND, phase: 'db-done', backupDir: 'B1', rows: [], runs: [] };
  assert.equal(isUsablePriorManifest(base), true);
  assert.equal(isUsablePriorManifest({ ...base, phase: 'rolled-back' }), false);
  assert.equal(isUsablePriorManifest({ ...base, kind: 'อื่น' }), false);
  assert.equal(isUsablePriorManifest(null), false);
  // ต่อวงจรเมื่อ prior ใช้ได้ = ชี้สำเนาแรก · เริ่มใหม่ (prior=null) = ชี้สำเนารอบนี้
  const plan = freshPlan({ existingRows: null, priorManifest: null });
  const cont = buildManifest({ prior: base, at: 'x', phase: 'db-done', backupDir: 'B2', entries: plan.entries });
  assert.equal(cont.backupDir, 'B1');
  const fresh = buildManifest({ prior: null, at: 'x', phase: 'db-done', backupDir: 'B2', entries: plan.entries });
  assert.equal(fresh.backupDir, 'B2');
});

test('16) assertRollbackIds: id ทุกตัวต้องคำนวณได้จาก sourceUrl ในชุด — แปลกปลอม = โยน', () => {
  const plan = freshPlan({ existingRows: null, priorManifest: null });
  const m = buildManifest({ prior: null, at: 'x', phase: 'db-done', backupDir: 'B', entries: plan.entries });
  assert.deepEqual(assertRollbackIds(m.ids, m), m.ids.map(String));
  assert.throws(() => assertRollbackIds([...m.ids, 'ครูเดิม-นอกชุด'], m), /นอกชุด 1 ตัว/);
  assert.throws(() => assertRollbackIds(m.ids, { rows: [] }), /พิสูจน์ id ไม่ได้/);
  assert.deepEqual(assertRollbackIds([teachers[0].id], { rows: [] }, [teachers[0].id]), [teachers[0].id], 'ไฟล์ชุดใช้เป็นหลักฐานได้');
});

test('17) runRollback: manifest ถอยไปแล้ว → ปฏิเสธก่อนแตะ client/ไฟล์ · id นอกชุด → ปฏิเสธก่อน delete · backup ไม่ครบ → ไม่แตะ', async () => {
  const a = rollbackFixture({ phase: 'rolled-back' });
  await assert.rejects(runRollback(a.manifestPath, { client: bombClient, root: a.root }), /ถอยไปแล้ว/);
  const b = rollbackFixture({ ids: [...teachers.map((x) => x.id), 'ครูเดิม-นอกชุด'] });
  const bCalls = [];
  await assert.rejects(runRollback(b.manifestPath, { client: async () => mockSb(b.table, bCalls), root: b.root }), /นอกชุด/);
  assert.equal(bCalls.length, 0, 'ห้ามยิงคำสั่งใดก่อนพิสูจน์ id');
  assert.equal(b.table.length, teachers.length + 1, 'ตารางต้องไม่ถูกแตะ');
  const c = rollbackFixture({ dropBackup: true });
  await assert.rejects(runRollback(c.manifestPath, { client: bombClient, root: c.root }), /backup ไม่ครบ/);
  for (const d of [a, b, c]) fs.rmSync(d.tmp, { recursive: true, force: true });
});

test('18) runRollback (mock client): ลบเฉพาะ id ในชุดที่มีป้าย · แถวไม่มีป้ายไม่ลบ · แถวนอกชุดไม่ถูกแตะ · คืนไฟล์ไบต์ตรง backup · manifest → rolled-back', async () => {
  const f = rollbackFixture({ untaggedFirst: true });
  const calls = [];
  await runRollback(f.manifestPath, { client: async () => mockSb(f.table, calls), root: f.root });
  const del = calls.find((x) => x.op === 'delete');
  assert.ok(del && del.table === 'viral_examples');
  assert.equal(del.in.length, teachers.length - 1, 'ลบเฉพาะที่มีป้าย (28-1)');
  assert.ok(!del.in.includes(teachers[0].id), 'ใบไม่มีป้ายต้องไม่ถูกลบ');
  assert.ok(!del.in.includes('ครูเดิม-นอกชุด'));
  assert.deepEqual(f.table.map((r) => r.id).sort(), [teachers[0].id, 'ครูเดิม-นอกชุด'].sort(), 'เหลือเฉพาะใบไม่มีป้าย + แถวนอกชุด');
  for (const name of ['viral-likes-real.json', 'viral-essences.json']) {
    assert.ok(fs.readFileSync(path.join(f.root, 'data', name)).equals(fs.readFileSync(path.join(f.backupDir, name))), name + ' ต้องตรง backup ไบต์ต่อไบต์');
  }
  const m = JSON.parse(fs.readFileSync(f.manifestPath, 'utf8'));
  assert.equal(m.phase, 'rolled-back');
  assert.ok(m.rolledBackAt);
  // ถอยซ้ำ = ปฏิเสธ
  await assert.rejects(runRollback(f.manifestPath, { client: bombClient, root: f.root }), /ถอยไปแล้ว/);
  fs.rmSync(f.tmp, { recursive: true, force: true });
});

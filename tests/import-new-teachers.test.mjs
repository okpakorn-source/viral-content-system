// ข้อสอบสคริปต์นำเข้าครูใหม่ชุด 8 ใบ (scripts/import-new-teachers.mjs) — 3 ก.ย. 69
// รัน: node --test tests/import-new-teachers.test.mjs (ไม่ต้องตั้ง env · ห้ามแตะ DB — ยิงเฉพาะ pure functions)
// ข้อมูลจริงล้วน: ไฟล์ proposal 2 ไฟล์ + data/viral-likes-real.json + data/viral-essences.json (อ่านอย่างเดียว)
//
// ชุด 8 ใบใน EXPECTED_* ด้านล่าง "จงใจเขียนซ้ำกับในสคริปต์" — คือคำเคาะเจ้าของ 3 ก.ย. 69
// (ข้อเสนอข้อ 4: มี #1 อาร์เมเนีย + #10 พาย่า · ไม่มี #13 พี่หนุ่ม) ใครแก้ฝั่งสคริปต์ต้องแดงที่นี่
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SELECTED_SOURCE_IDS, ID_NAMESPACE, MATCHED_BY, INSERT_COLUMNS, ESSENCE_KEYS,
  deriveTeacherId, normalizeContentKey, selectTeacherRows, buildInsertRow, buildLikesEntry,
  buildEssenceCard, detectJsonFormat, serializeJson, assertRoundTrip, mergeLikes, mergeEssences,
  planImport, buildManifest, restoreDataFiles,
} from '../scripts/import-new-teachers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRoot = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── ข้อมูลจริง (อ่านครั้งเดียว ใช้ร่วมทุกข้อ — เทสห้ามเขียนไฟล์พวกนี้) ──
const importRows = JSON.parse(readRoot('docs/proposals/new-teachers-15-import-2sep69.json'));
const essencesBySource = JSON.parse(readRoot('docs/proposals/new-teachers-15-essences-2sep69.json'));
const likesRaw = readRoot('data/viral-likes-real.json');
const essencesRaw = readRoot('data/viral-essences.json');
const likesData = JSON.parse(likesRaw);
const essData = JSON.parse(essencesRaw);

// คำเคาะเจ้าของ (อิสระจากค่าคงที่ในสคริปต์ — ห้าม import มาใช้แทน)
const EXPECTED_SOURCE_IDS = [
  '1566277485525968', // #1 ฮลุนอาร์เมเนีย
  '1565194475634269', // #10 ฮลุนพาย่า
  '1517110340442683', // #5 ภูฏาน
  '1560145569472493', // #6 พ่อเดิน 28 กิโล
  '1504220288398355', // #9 มิกโก
  '1516280530525664', // #11 เด็กหญิงกระปุก
  '1562486582571725', // #14 ฮีโร่-อาเธอร์
  '1510528697767514', // #15 เจ๊แห้ง
];
const EXCLUDED_SOURCE_IDS = [
  '1564136869073363', // #2 แหลม (ฮลุนเกินโควตา — สำรอง)
  '1515032073983843', // #3 พระองค์ภา (ซ้ำครูเดิม)
  '1565689568918093', // #4 ซมโปะ (ฮลุน+กึ่งชมแบรนด์)
  '1565224385631278', // #7 ขวัญพิมพ์อัปสร (ฮลุน)
  '1558108696342847', // #8 วิมล (เหตุเดียวกับจ่ายุทธ)
  '1566302968856753', // #12 กรมทรัพย์สินฯ (ฮลุน)
  '1563228362497547', // #13 พี่หนุ่ม (เจ้าของสั่งไม่เอา)
];
// id คงที่ที่ derive จาก sha256(namespace + sourcePostId) — ล็อกค่าไว้เลย: รันเครื่องไหน/รอบไหนต้องได้ชุดนี้เป๊ะ
const EXPECTED_IDS = {
  '1566277485525968': 'b40b3e83-1376-493f-a42a-4ef41c0f7a81',
  '1565194475634269': '970c01b7-dcf2-4ee1-a3a7-7501df16f7f1',
  '1517110340442683': '4c7a77d8-cfa7-441f-9956-4efe183a12ab',
  '1560145569472493': '87a7d09c-ec97-46bf-9428-d5e9cb8a5d25',
  '1504220288398355': '7323c255-6669-4cf5-a60a-38f768366f7b',
  '1516280530525664': '42cef733-fc3e-41ae-b63d-205db8b70d5b',
  '1562486582571725': 'b966128f-a02a-4204-94c4-4e53af806368',
  '1510528697767514': 'ea51432d-81b6-46f0-9b4d-98de32a8f424',
};

const freshPlan = (extra = {}) => planImport({ importRows, essencesBySource, likesRaw, essencesRaw, ...extra });

test('1) เลือก 8 ใบตรงคำเคาะ: มี #1+#10 · ไม่มี #13 และใบชะลอทุกใบ · คุณสมบัติผ่านเกณฑ์ระบบ', () => {
  const rows = selectTeacherRows(importRows);
  assert.equal(rows.length, 8, 'ต้องได้ 8 ใบพอดี');
  const got = rows.map((r) => String(r._sourcePostId));
  assert.deepEqual([...got].sort(), [...EXPECTED_SOURCE_IDS].sort(), 'ชุดใบต้องตรงคำเคาะเจ้าของทุกใบ');
  for (const sid of EXCLUDED_SOURCE_IDS) assert.ok(!got.includes(sid), `ห้ามมีใบชะลอ ${sid}`);
  assert.ok(got.includes('1566277485525968') && got.includes('1565194475634269'), 'ต้องมี #1 อาร์เมเนีย + #10 พาย่า');
  for (const r of rows) {
    assert.ok(String(r.content).length > 200, `content ต้องยาว > 200 (viralFewshot กรองทิ้ง): ${r._sourcePostId}`);
    assert.ok(Number(r._realLikes) >= 50000, `ไลก์ต้องถึงพื้น rank-v2: ${r._sourcePostId}`);
    assert.equal(Number(r.engagement_likes), Number(r._realLikes), 'engagement_likes ต้องเท่ายอดจริง');
  }
  // SELECTED_SOURCE_IDS ในสคริปต์ต้องเป็นชุดเดียวกัน (กันคนแก้ค่าคงที่โดยไม่ผ่านเจ้าของ)
  assert.deepEqual([...SELECTED_SOURCE_IDS].sort(), [...EXPECTED_SOURCE_IDS].sort());
});

test('2) id คงที่รูปแบบ uuid v4 — ตรงค่าล็อกทุกใบ ไม่ชนของเดิมในคลัง', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const [sid, want] of Object.entries(EXPECTED_IDS)) {
    const id = deriveTeacherId(sid);
    assert.match(id, V4, 'ต้องเป็นรูปแบบ uuid v4');
    assert.equal(id, want, `id ของ ${sid} ต้องคงที่ (namespace=${ID_NAMESPACE} ห้ามเปลี่ยนหลังนำเข้า)`);
    assert.equal(deriveTeacherId(sid), id, 'เรียกซ้ำต้องได้ค่าเดิม (ห้ามสุ่ม/ห้ามอิงเวลา)');
  }
  const derived = Object.values(EXPECTED_IDS);
  assert.equal(new Set(derived).size, 8, 'ห้ามซ้ำกันเอง');
  for (const id of derived) {
    assert.ok(!essData[id], `ห้ามชนบัตรลักษณะเดิม: ${id}`);
    assert.ok(!likesData.byId[id], `ห้ามชน likes เดิม: ${id}`);
  }
  assert.throws(() => deriveTeacherId('abc'), /ไม่ถูกต้อง/);
});

test('3) โครงแถว insert = คอลัมน์จริงที่ระบบเขียน/อ่าน (viral_examples) — ไม่มีคีย์ _... หลุดไป DB', async () => {
  const rows = selectTeacherRows(importRows);
  for (const r of rows) {
    const row = buildInsertRow(r, EXPECTED_IDS[r._sourcePostId]);
    assert.deepEqual(Object.keys(row), [...INSERT_COLUMNS], 'คีย์+ลำดับต้องตรง INSERT_COLUMNS เป๊ะ');
    assert.ok(!Object.keys(row).some((k) => k.startsWith('_')), 'ห้ามคีย์ metadata หลุดเข้าแถว insert');
    assert.equal(row.source_url, null, 'CSV มีแค่ post id — source_url ต้อง null');
    assert.equal(typeof row.engagement_likes, 'number');
    assert.equal(row.engagement_likes, Number(r._realLikes), 'ตารางต้องได้ยอดไลก์จริง (คำเคาะข้อ 4 ของเจ้าของ)');
  }
  // สัญญากับผู้อ่านจริง: คอลัมน์ที่ viralFewshot.js select ต้องเป็นส่วนย่อยของคอลัมน์ที่เรา insert
  const src = readRoot('src/lib/services/viralFewshot.js');
  const m = src.match(/from\(\s*'viral_examples'\s*\)[\s\r\n]*\.select\('([^']+)'\)/) || src.match(/const POOL_SELECT_BASE = '([^']+)'/); // ★ 4 ก.ย. 69 (WF5): select ผ่าน _poolSelect — ปิดสวิตช์ = POOL_SELECT_BASE (สตริงเดิม)
  assert.ok(m, 'ต้องเจอบรรทัด select ของ viral_examples ใน viralFewshot.js (สัญญาคอลัมน์เปลี่ยน = มาแก้ที่นี่)');
  const readCols = m[1].split(',').map((s) => s.trim());
  for (const c of readCols) assert.ok(INSERT_COLUMNS.includes(c), `ระบบอ่านคอลัมน์ ${c} แต่แถวนำเข้าไม่มี`);
  // หมวดของครูใหม่ต้องเป็นชั้นหอสมุดที่ระบบรู้จัก (โหมดแคบ query ตามหมวด — หมวดแปลก = ครูเข้าถึงยาก)
  try {
    const vf = await import('../src/lib/services/viralFewshot.js');
    for (const r of rows) assert.ok(vf.LIB_SHELVES.includes(r.category), `หมวด "${r.category}" ไม่อยู่ใน LIB_SHELVES`);
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    console.log('ข้าม LIB_SHELVES check (โหลด viralFewshot ไม่ได้: ' + err.message.slice(0, 80) + ')');
  }
});

test('4) เติม likes: ของเดิม 100% ไบต์เดิม · entry ใหม่ {likes, matchedBy:"proposal-3sep69"} ต่อท้าย · ห้ามทับของเดิม', () => {
  const { data: parsed, fmt } = assertRoundTrip(likesRaw, 'likes');
  // merge ว่าง = เอกลักษณ์ไบต์เป๊ะ (คือหลักประกันว่า "ของเดิมไม่โดนแตะ")
  const noop = mergeLikes(parsed, {});
  assert.equal(serializeJson(noop.data, fmt), likesRaw, 'merge ว่างต้องคืนไบต์ไฟล์เดิมเป๊ะ');
  // เติม 8 ใบจริง
  const plan = freshPlan();
  const after = JSON.parse(plan.likes.after);
  const oldIds = Object.keys(likesData.byId);
  const newIds = Object.keys(after.byId);
  assert.equal(newIds.length, oldIds.length + 8);
  assert.deepEqual(newIds.slice(0, oldIds.length), oldIds, 'ของเดิมต้องอยู่ครบตามลำดับเดิม (ต่อท้ายเท่านั้น)');
  for (const id of oldIds) assert.deepEqual(after.byId[id], likesData.byId[id], 'ค่าเดิมห้ามเปลี่ยน: ' + id);
  assert.deepEqual(after.byKey, likesData.byKey, 'byKey ห้ามแตะ');
  for (const [sid, id] of Object.entries(EXPECTED_IDS)) {
    const row = importRows.find((r) => r._sourcePostId === sid);
    assert.deepEqual(after.byId[id], { likes: Number(row._realLikes), matchedBy: 'proposal-3sep69' });
    assert.equal(JSON.stringify(after.byId[id]), `{"likes":${Number(row._realLikes)},"matchedBy":"proposal-3sep69"}`, 'ลำดับคีย์ entry ต้องเหมือนของเดิม');
  }
  assert.equal(MATCHED_BY, 'proposal-3sep69');
  // ห้ามทับ: จงใจยัด id ที่มีอยู่แล้วด้วยค่าปลอม → ต้องถูกข้าม ไม่ใช่ถูกทับ
  const victim = oldIds[0];
  const hostile = mergeLikes(parsed, { [victim]: { likes: 1, matchedBy: 'x' } });
  assert.deepEqual(hostile.skippedExisting, [victim]);
  assert.deepEqual(hostile.data.byId[victim], likesData.byId[victim], 'entry เดิมต้องรอดจากการทับ');
  // ต้องไม่กลายพันธุ์ input
  assert.equal(JSON.stringify(parsed), JSON.stringify(JSON.parse(likesRaw)), 'mergeLikes ห้ามแก้ object ต้นทาง');
});

test('5) เติมบัตรลักษณะ: สคีมา/ลำดับคีย์เดิมเป๊ะ · เนื้อบัตรตรงไฟล์ proposal · ธีมยาว >= 4 ตัวอักษร', () => {
  const { data: parsed, fmt } = assertRoundTrip(essencesRaw, 'essences');
  const noop = mergeEssences(parsed, {});
  assert.equal(serializeJson(noop.data, fmt), essencesRaw, 'merge ว่างต้องคืนไบต์ไฟล์เดิมเป๊ะ');
  const plan = freshPlan();
  const after = JSON.parse(plan.essences.after);
  const oldIds = Object.keys(essData);
  const newIds = Object.keys(after);
  assert.equal(newIds.length, oldIds.length + 8);
  assert.deepEqual(newIds.slice(0, oldIds.length), oldIds, 'บัตรเดิมอยู่ครบตามลำดับเดิม');
  for (const id of oldIds) assert.deepEqual(after[id], essData[id], 'บัตรเดิมห้ามเปลี่ยน: ' + id);
  for (const [sid, id] of Object.entries(EXPECTED_IDS)) {
    const card = after[id];
    assert.deepEqual(Object.keys(card), [...ESSENCE_KEYS], 'ลำดับคีย์บัตรต้อง emotion,structure,themes,tone');
    assert.deepEqual(card, essencesBySource[sid], 'เนื้อบัตรต้องตรงไฟล์ proposal (key เปลี่ยนจาก post id → uuid เท่านั้น)');
    for (const t of card.themes) assert.ok(Array.from(t).length >= 4, `ธีมสั้นกว่า 4 ตัวอักษรจะไม่ถูกให้คะแนน (SL.MIN_LEN): "${t}"`);
  }
  // ห้ามทับบัตรเดิม + บัตรเพี้ยนต้องถูกปฏิเสธ
  const victim = oldIds[0];
  const hostile = mergeEssences(parsed, { [victim]: essencesBySource[EXPECTED_SOURCE_IDS[0]] });
  assert.deepEqual(hostile.skippedExisting, [victim]);
  assert.deepEqual(hostile.data[victim], essData[victim]);
  assert.throws(() => buildEssenceCard({ emotion: [], structure: 's', themes: ['ก'], tone: 't' }), /emotion/);
  assert.throws(() => buildEssenceCard({ emotion: ['a'], structure: 's', themes: ['ยาวพอ'], tone: 't', extra: 1 }), /แปลกปลอม/);
});

test('6) planImport ของจริงทั้งชุด: insert 8 · ไฟล์ 2 ไฟล์ format เดิม round-trip ต่อได้', () => {
  const plan = freshPlan();
  assert.equal(plan.insertRows.length, 8);
  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(plan.likes.added, Object.values(EXPECTED_IDS));
  assert.deepEqual(plan.essences.added, Object.values(EXPECTED_IDS));
  // format ไฟล์หลังเติมต้องเหมือนก่อนเติม + ยัง round-trip ได้ (รอบหน้า merge ต่อได้)
  for (const [f, before] of [[plan.likes, likesRaw], [plan.essences, essencesRaw]]) {
    assert.deepEqual(detectJsonFormat(f.after), detectJsonFormat(before), 'format ต้องคงเดิม');
    assert.doesNotThrow(() => assertRoundTrip(f.after, 'หลังเติม'));
  }
  // รูปแบบไฟล์จริงวันนี้ (ล็อกไว้ — ใครเปลี่ยน format ไฟล์ data ต้องมาเจอข้อนี้ก่อนสคริปต์พัง)
  assert.deepEqual(detectJsonFormat(likesRaw), { eol: '\r\n', indent: 2, trailing: '\r\n' });
  assert.deepEqual(detectJsonFormat(essencesRaw), { eol: '\r\n', indent: 1, trailing: '' });
  assert.throws(() => assertRoundTrip(likesRaw + ' ', 'เพี้ยน'), /round-trip/);
  assert.throws(() => assertRoundTrip('\uFEFF' + likesRaw, 'บอม'), /BOM/);
});

test('7) กันซ้ำ: เนื้อชนแถวเดิมคนละ id = ข้ามทั้งใบ · id เคย insert แล้ว = ข้าม insert แต่เติมไฟล์ต่อ (งานค้าง)', () => {
  const first = importRows.find((r) => r._sourcePostId === EXPECTED_SOURCE_IDS[0]);
  // ก) เนื้อตรงกับแถวเดิมที่ใช้ id อื่น (เช่นเคย import มือ) → ห้าม insert และห้ามเติมไฟล์ด้วย id เรา
  const foreign = [{ id: 'ffffffff-0000-4000-8000-000000000000', content: first.content }];
  const planA = freshPlan({ existingRows: foreign });
  const e0 = planA.entries.find((e) => e.sourcePostId === first._sourcePostId);
  assert.equal(e0.skip?.reason, 'content-in-table');
  assert.equal(e0.skip.foreignId, 'ffffffff-0000-4000-8000-000000000000');
  assert.equal(planA.insertRows.length, 7);
  assert.ok(!planA.likes.added.includes(e0.id), 'ห้ามเติม likes ด้วย id ที่ไม่มีจริงในตาราง');
  assert.ok(!planA.essences.added.includes(e0.id), 'ห้ามเติมบัตรด้วย id ที่ไม่มีจริงในตาราง');
  // เนื้อเทียบแบบ normalize (ช่องว่าง/อีโมจิต่างกันก็ต้องจับได้)
  const spaced = [{ id: 'ffffffff-0000-4000-8000-000000000001', content: '  ' + first.content.replace(/\n/g, ' \n ') + ' ' }];
  const planA2 = freshPlan({ existingRows: spaced });
  assert.equal(planA2.entries.find((e) => e.sourcePostId === first._sourcePostId).skip?.reason, 'content-in-table');
  assert.equal(normalizeContentKey(' ก .ข '), normalizeContentKey('ก.ข'));
  // ข) id ของเราอยู่ในตารางแล้ว (รอบก่อนล้มกลางทาง) → ข้าม insert แต่ likes/บัตรต้องถูกเติมให้ครบ
  const mine = [{ id: EXPECTED_IDS[first._sourcePostId], content: 'คนละเนื้อ' }];
  const planB = freshPlan({ existingRows: mine });
  const e1 = planB.entries.find((e) => e.sourcePostId === first._sourcePostId);
  assert.equal(e1.skip?.reason, 'id-in-table');
  assert.equal(planB.insertRows.length, 7);
  assert.ok(planB.likes.added.includes(e1.id), 'งานค้างต้องเติมไฟล์ต่อได้');
  assert.ok(planB.essences.added.includes(e1.id));
  // ค) id จากไฟล์ import (ถ้าวันหลังมี) ต้องชนะการ derive · id จาก manifest เดิมชนะเป็นลำดับสอง
  const withId = importRows.map((r) => (r._sourcePostId === first._sourcePostId ? { ...r, id: 'aaaaaaaa-1111-4111-8111-111111111111' } : r));
  const planC = freshPlan({ importRows: withId });
  assert.equal(planC.entries.find((e) => e.sourcePostId === first._sourcePostId).id, 'aaaaaaaa-1111-4111-8111-111111111111');
  const manifest = { rows: [{ sourcePostId: first._sourcePostId, id: 'bbbbbbbb-2222-4222-8222-222222222222' }] };
  const planD = freshPlan({ priorManifest: manifest });
  const e2 = planD.entries.find((e) => e.sourcePostId === first._sourcePostId);
  assert.equal(e2.id, 'bbbbbbbb-2222-4222-8222-222222222222', 'id จาก manifest เดิมต้องถูกใช้ซ้ำ (id คงที่ข้ามรอบ)');
  assert.equal(e2.skip?.reason, 'manifest-prior', 'โหมด offline ต้องบอกว่าใบนี้เคยนำเข้าตาม manifest');
});

test('8) rollback คืนสภาพ: ไฟล์ 2 ไฟล์กลับไบต์เดิมเป๊ะหลังถูกเติม', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-teachers-test-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const backupDir = path.join(tmp, 'backup');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    for (const [name, raw] of [['viral-likes-real.json', likesRaw], ['viral-essences.json', essencesRaw]]) {
      fs.writeFileSync(path.join(dataDir, name), raw, 'utf8');   // สภาพก่อนนำเข้า
      fs.writeFileSync(path.join(backupDir, name), raw, 'utf8'); // backup ที่ --apply เก็บไว้
    }
    // จำลองขั้น --apply เขียนไฟล์ที่เติมแล้ว
    const plan = freshPlan();
    fs.writeFileSync(path.join(dataDir, 'viral-likes-real.json'), plan.likes.after, 'utf8');
    fs.writeFileSync(path.join(dataDir, 'viral-essences.json'), plan.essences.after, 'utf8');
    assert.notEqual(fs.readFileSync(path.join(dataDir, 'viral-likes-real.json'), 'utf8'), likesRaw, 'ก่อน rollback ไฟล์ต้องเปลี่ยนแล้วจริง');
    // rollback
    const results = restoreDataFiles({ backupDir, root: tmp });
    assert.equal(results.length, 2);
    assert.equal(fs.readFileSync(path.join(dataDir, 'viral-likes-real.json'), 'utf8'), likesRaw, 'likes ต้องกลับไบต์เดิมเป๊ะ');
    assert.equal(fs.readFileSync(path.join(dataDir, 'viral-essences.json'), 'utf8'), essencesRaw, 'บัตรลักษณะต้องกลับไบต์เดิมเป๊ะ');
    // backup หาย = ต้องปฏิเสธก่อนแตะอะไร
    assert.throws(() => restoreDataFiles({ backupDir: path.join(tmp, 'no-such'), root: tmp }), /ไม่พบไฟล์ backup/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('9) manifest: id ครบ 8 · merge กับของเดิมแล้ว backupDir ชี้สำเนา "ก่อนนำเข้าครั้งแรก" เสมอ', () => {
  const plan = freshPlan();
  const at = '2026-09-03T00:00:00.000Z';
  const m1 = buildManifest({ at, phase: 'complete', backupDir: 'X:/bk-first', entries: plan.entries });
  assert.equal(m1.kind, 'teachers-import-manifest');
  assert.deepEqual([...m1.ids].sort(), Object.values(EXPECTED_IDS).sort());
  assert.equal(m1.backupDir, 'X:/bk-first');
  assert.equal(m1.rows.length, 8);
  for (const r of m1.rows) {
    assert.ok(EXPECTED_IDS[r.sourcePostId] === r.id);
    assert.ok(r.likes >= 50000 && r.category && r.title);
  }
  // รันซ้ำรอบสอง: backupDir ต้องคงของรอบแรก (rollback ต้องพากลับก่อนมีครูชุดนี้) · ids ไม่บวม
  const m2 = buildManifest({ prior: m1, at, phase: 'complete', backupDir: 'X:/bk-second', entries: plan.entries });
  assert.equal(m2.backupDir, 'X:/bk-first', 'backupDir ต้องเป็นสำเนาก่อนนำเข้าครั้งแรกเสมอ');
  assert.equal(m2.lastBackupDir, 'X:/bk-second');
  assert.equal(m2.ids.length, 8, 'merge ซ้ำห้ามได้ id เกิน 8');
  assert.equal(m2.runs.length, 2);
});

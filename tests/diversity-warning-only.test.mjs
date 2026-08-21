import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PATH = new URL('../src/lib/services/autoFlowServiceText.js', import.meta.url);
const VIEW_PATH = new URL('../src/components/content/ResultVersions.js', import.meta.url);

function makeAnnotate(source = readFileSync(PATH, 'utf8')) {
  const start = source.indexOf('export function annotateDiversityWarning(');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'ต้องพบบล็อก annotateDiversityWarning ตัวจริง');
  const declaration = source.slice(start, end + 2).replace('export function', 'function');
  return new Function(`${declaration}; return annotateDiversityWarning;`)();
}

const originals = [
  {
    title: 'ฉบับหนึ่ง',
    content: 'เนื้อหาฉบับหนึ่ง',
    usedModel: 'claude-fable-5',
    promptId: 'card-a',
    _source: 'writer',
    _sourceLabel: 'มุมหนึ่ง',
  },
  {
    title: 'ฉบับสอง',
    content: 'เนื้อหาฉบับสอง',
    usedModel: 'claude-fable-5',
    promptId: 'card-b',
    _source: 'writer',
    _sourceLabel: 'มุมสอง',
  },
];

const similar = {
  ok: false,
  pairs: [{ left: 0, right: 1, similarity: 0.72, sameOpening: true, sameClosing: false, tooSimilar: true }],
};

test('ข่าวคล้ายกันต้องคง 2 ฉบับเดิมทุกฟิลด์และเพิ่มเพียงคำเตือน ไม่เรียกเขียนซ้ำ', () => {
  const annotate = makeAnnotate();
  const result = annotate(originals, similar);

  assert.match(result.warning, /72%/u);
  assert.match(result.warning, /ไม่เขียนซ้ำ/u);
  assert.equal(result.versions.length, 2);
  for (let index = 0; index < originals.length; index += 1) {
    const { _diversityWarning, ...unchanged } = result.versions[index];
    assert.deepEqual(unchanged, originals[index]);
    assert.equal(_diversityWarning, result.warning);
  }
});

test('ข่าวไม่คล้ายต้องส่ง array เดิมกลับโดยไม่เพิ่มคำเตือน', () => {
  const annotate = makeAnnotate();
  const result = annotate(originals, { ok: true, maxSimilarity: 0.2, pairs: [] });
  assert.equal(result.versions, originals);
  assert.equal(result.warning, '');
});

test('production flow ต้องไม่มีวงจร AI สำหรับซ่อมความคล้ายหลงเหลือ', () => {
  const source = readFileSync(PATH, 'utf8');
  for (const forbidden of [
    'rewriteDiverseVersion',
    'repairVersionDiversityOnce',
    'selectDiversityRepairPrompt',
    'diversity_repair_',
    "addLog('DiversityRepair'",
  ]) {
    assert.equal(source.includes(forbidden), false, `ห้ามเหลือ ${forbidden}`);
  }
  assert.match(source, /annotateDiversityWarning\(finalVersions, diversity\)/u);
  const viewSource = readFileSync(VIEW_PATH, 'utf8');
  assert.match(viewSource, /v\._diversityWarning/u, 'พนักงานต้องเห็นคำเตือนจริงบนหน้าผลลัพธ์');
});

test('mutation: ถอดคำเตือนหรือเปลี่ยนเนื้อข่าวแล้ว oracle ต้องแดง', () => {
  const source = readFileSync(PATH, 'utf8');
  const noWarning = source.replace(
    'versions: list.map(version => ({ ...version, _diversityWarning: warning }))',
    'versions: list',
  );
  assert.throws(() => {
    const result = makeAnnotate(noWarning)(originals, similar);
    assert.equal(result.versions[0]._diversityWarning, result.warning);
  });

  const rewritesContent = source.replace(
    'versions: list.map(version => ({ ...version, _diversityWarning: warning }))',
    "versions: list.map(version => ({ ...version, content: 'เขียนใหม่', _diversityWarning: warning }))",
  );
  assert.throws(() => {
    const result = makeAnnotate(rewritesContent)(originals, similar);
    for (let index = 0; index < originals.length; index += 1) {
      const { _diversityWarning, ...unchanged } = result.versions[index];
      assert.deepEqual(unchanged, originals[index]);
    }
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync(new URL('../src/app/api/auto/process/route.js', import.meta.url), 'utf8');
const helperStart = routeSource.indexOf('async function saveToArchiveServerSide');
const helperEnd = routeSource.indexOf('\nexport async function POST', helperStart);

assert.ok(helperStart >= 0 && helperEnd > helperStart, 'ต้องหา saveToArchiveServerSide ใน route จริงได้');

const helperSource = routeSource.slice(helperStart, helperEnd).trim();

function makeSave({ existing = [], add = async (item) => item, callAI = async () => ({}) } = {}) {
  const createStore = () => ({
    getAll: async () => existing,
    add,
  });
  return new Function(
    'createStore',
    'callAI',
    'MODEL_FAST',
    `return (${helperSource});`,
  )(createStore, callAI, 'test-model');
}

const args = {
  newsData: { newsTitle: 'หัวข้อทดสอบ', newsBody: 'เนื้อข่าวทดสอบสำหรับคลัง' },
  breakdownData: {},
  sourceType: 'plain_text',
  sourceUrl: '',
  workflowId: 'wf-test',
  archivedBy: 'test',
  coverImage: null,
};

async function captureWarnings(fn) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...parts) => warnings.push(parts.map(String).join(' '));
  try {
    return { value: await fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

test('save สำเร็จจริงจึงคืน true', async () => {
  let added = null;
  const save = makeSave({ add: async (item) => { added = item; return item; } });
  const result = await save(args);
  assert.equal(result, true);
  assert.equal(added?.title, args.newsData.newsTitle);
});

test('AI classify ค้างต้องถูกตัดตาม budget และยัง save ด้วยค่า fallback', async () => {
  let added = null;
  let classifySignal = null;
  const save = makeSave({
    callAI: ({ signal }) => new Promise((_, reject) => {
      classifySignal = signal;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    add: async (item) => { added = item; return item; },
  });
  let watchdog;
  const result = await Promise.race([
    save({ ...args, classifyTimeoutMs: 10 }),
    new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('classify timeout guard did not fire')), 500); }),
  ]).finally(() => clearTimeout(watchdog));
  assert.equal(result, true);
  assert.equal(classifySignal?.aborted, true);
  assert.equal(added?.category, 'ทั่วไป');
});

test('store.add ล้มต้องคืน false และมี failure log', async () => {
  const save = makeSave({ add: async () => { throw new Error('db unavailable'); } });
  const { value, warnings } = await captureWarnings(() => save(args));
  assert.equal(value, false);
  assert.ok(warnings.some((line) => line.includes('[Archive-Server] Save failed') && line.includes('workflow=wf-test') && line.includes('db unavailable')));
});

test('ไม่มี title/body ต้องคืน false และมี skip log', async () => {
  const save = makeSave();
  const { value, warnings } = await captureWarnings(() => save({ ...args, newsData: {} }));
  assert.equal(value, false);
  assert.ok(warnings.some((line) => line.includes('workflow=wf-test') && line.includes('missing news title/body')));
});

test('พบข่าวซ้ำในคลังถือว่า archive state สำเร็จและไม่ add ซ้ำ', async () => {
  let addCalls = 0;
  const save = makeSave({
    existing: [{ title: args.newsData.newsTitle, body: args.newsData.newsBody, archived_at: new Date().toISOString() }],
    add: async (item) => { addCalls++; return item; },
  });
  assert.equal(await save(args), true);
  assert.equal(addCalls, 0);
});

test('หัวข้อซ้ำแต่เนื้อคนละข่าวต้องบันทึกรายการใหม่', async () => {
  let added = null;
  const save = makeSave({
    existing: [{ title: args.newsData.newsTitle, body: 'เนื้ออีกข่าวหนึ่ง', archived_at: new Date().toISOString() }],
    add: async (item) => { added = item; return item; },
  });
  assert.equal(await save(args), true);
  assert.equal(added?.body, args.newsData.newsBody);
});

test('response ทั้งสอง branch รอผลจริงและไม่ผูก archiveSaved กับ isFromQueue', () => {
  const awaitedAssignments = routeSource.match(/archiveSaved\s*=\s*await\s+saveToArchiveServerSide\(\{/g) || [];
  assert.equal(awaitedAssignments.length, 2, 'enhanced และ local branch ต้อง await save ทั้งคู่');
  assert.doesNotMatch(routeSource, /archiveSaved\s*:\s*isFromQueue/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

// ★ 2 ก.ย. 69 — เทสแดงค้าง 6 เคส ("SyntaxError: Unexpected token 'async'") · สาเหตุราก = สัญญาเปลี่ยน ไม่ใช่โค้ดผิด
//   สัญญาเปลี่ยนที่ a56d011a (21 ส.ค. 69 "stabilize raw-text pipeline") → กลับขึ้น main ที่ 554d0286 (24 ส.ค. 69):
//   (1) POST ถูกแยกเป็น handlePost / reportHardDeadlineFailure / runProcessWithDeadline → ระหว่าง saveToArchiveServerSide
//       กับ "export async function POST" มีฟังก์ชันคั่น 3 ตัว การ slice ถึง POST จึงได้หลายฟังก์ชันซ้อนกัน = SyntaxError
//   (2) saveToArchiveServerSide ไม่ dedup/classify เองแล้ว — มอบให้ saveNewsArchive (src/lib/services/newsArchiveService.js)
//       ซึ่งเป็นตัวเขียนคลังร่วมกับ /api/news-archive (createStore/callAI/MODEL_FAST ย้ายไปอยู่ที่นั่น)
//   → ตัดฟังก์ชันด้วย AST (@babel/parser แบบเดียวกับ text-queue-handoff-contract) แล้วประกอบ 2 ชั้นจริง:
//     route helper (จริง) → saveNewsArchive (จริง) → store/callAI (stub) — โจทย์ 6 เคสเดิมยังพิสูจน์พฤติกรรมเดิมครบ
//   อ่านซอร์สแบบ normalize CRLF→LF (เครื่อง Windows autocrlf=true ทำ working tree เป็น CRLF ขณะ index เป็น LF)
// ผลทุบโค้ด (2 ก.ย. 69 — ทุบแล้วคืนโค้ดเดิมทุกไบต์):
//   M1 route: `return true;` หลัง save → `return false;`            ⇒ แดง 4 เคส (save/timeout/dedup/หัวข้อซ้ำ)
//   M2 service: ตัด `if (recentMatch) return { item: recentMatch, deduped: true };` ⇒ แดง "พบข่าวซ้ำ…ไม่ add ซ้ำ" (addCalls=1)
//   M3 service: ตัดการส่ง `signal` เข้า callAI                       ⇒ แดง "AI classify ค้าง…" (classifySignal ไม่มี)
//   M4 (รอบ 2 ผู้ตรวจไขว้ข้อ 7) ตัด 'MODEL_FAST' ออกจาก INJECTED_BINDINGS ⇒ แดงตั้งแต่โหลดไฟล์ "newsArchiveService.js มี import ต่างจากที่ makeSave ฉีด…"
//      (เดิมถ้า service เพิ่ม import ใหม่ เทสจะล้มเป็น ReferenceError อ่านไม่รู้เรื่อง — ตอนนี้บอกชัดว่าต้องแก้ makeSave)

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function extractTopLevel(source, predicate, label) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const hits = [];
  for (const node of ast.program.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (declaration && predicate(declaration)) hits.push(declaration);
  }
  assert.equal(hits.length, 1, `ต้องพบ ${label} ระดับบนสุดพอดี 1 ตัว (พบ ${hits.length})`);
  return source.slice(hits[0].start, hits[0].end);
}

const functionNamed = name => node => node.type === 'FunctionDeclaration' && node.id?.name === name;
const constNamed = name => node => node.type === 'VariableDeclaration'
  && node.declarations.some(declarator => declarator.id?.name === name);

const routeSource = readSource('../src/app/api/auto/process/route.js');
const serviceSource = readSource('../src/lib/services/newsArchiveService.js');
const helperSource = extractTopLevel(routeSource, functionNamed('saveToArchiveServerSide'), 'saveToArchiveServerSide');
const serviceSlice = [
  extractTopLevel(serviceSource, constNamed('STORE'), 'STORE'),
  extractTopLevel(serviceSource, constNamed('DUPLICATE_KEY_RE'), 'DUPLICATE_KEY_RE'),
  extractTopLevel(serviceSource, functionNamed('saveNewsArchive'), 'saveNewsArchive'),
].join('\n');

assert.match(helperSource, /await saveNewsArchive\(\{/, 'route helper ต้องมอบงานให้ saveNewsArchive (สัญญาตั้งแต่ a56d011a)');

// ★ 2 ก.ย. 69 (ผู้ตรวจไขว้ข้อ 7): makeSave ฉีดตัวแปรอิสระให้ saveNewsArchive ตายตัวตามรายการนี้ — ถ้า newsArchiveService.js
//   เพิ่ม/ลด import เทสจะล้มด้วย ReferenceError ที่อ่านไม่รู้เรื่อง → เทียบรายชื่อ import กับรายการฉีดตรงนี้ให้บอกชัดว่าต้องแก้อะไร
const INJECTED_BINDINGS = ['createHash', 'createStore', 'callAI', 'MODEL_FAST'];
function importedBindings(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  return ast.program.body
    .filter(node => node.type === 'ImportDeclaration')
    .flatMap(node => node.specifiers.map(specifier => specifier.local.name))
    .sort();
}
assert.deepEqual(
  importedBindings(serviceSource),
  [...INJECTED_BINDINGS].sort(),
  `newsArchiveService.js มี import ต่างจากที่ makeSave ฉีด (${INJECTED_BINDINGS.join('/')}) — เพิ่ม/ลด import แล้วต้องอัปเดต new Function ใน makeSave ให้ตรง`,
);

function makeSave({
  existing = [],
  add = async (item) => item,
  callAI = async () => ({}),
  findById = async () => null,
} = {}) {
  const createStore = () => ({
    getAll: async () => existing,
    add,
    findById,
  });
  const saveNewsArchive = new Function(
    'createHash',
    'createStore',
    'callAI',
    'MODEL_FAST',
    `${serviceSlice}\nreturn saveNewsArchive;`,
  )(createHash, createStore, callAI, 'test-model');
  return new Function('saveNewsArchive', `return (${helperSource});`)(saveNewsArchive);
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
  const { value: result } = await captureWarnings(() => Promise.race([
    save({ ...args, classifyTimeoutMs: 10 }),
    new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('classify timeout guard did not fire')), 500); }),
  ]).finally(() => clearTimeout(watchdog)));
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

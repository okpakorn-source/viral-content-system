// ★ 8 พ.ย. 69 — ตัวบันทึกคลังผลงานยุค มิ.ย. (src/lib/services/era/generationLogger.js) กับคิวขนานปัจจุบัน
// ยุค มิ.ย. เขียนข่าวทีละงาน · ตอนนี้คิวเขียนพร้อมกันหลายงาน → เลขเคสชนกันได้ (23505)
// ตรวจ: ชน = จองเลขใหม่ (ทุกงานได้เลขไม่ซ้ำและเลขที่คืนตรงกับแถวจริง) · บันทึกลง Supabase ไม่ได้บน Vercel = ไม่คืนเลขเคส
// ไม่ยิง Supabase จริง · ไม่เขียนไฟล์ใน repo (ไฟล์ fallback ไปอยู่ใต้ os.tmpdir())
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPatchedModule } from './helpers/temp-module.mjs';

const SRC_URL = new URL('../src/lib/services/era/generationLogger.js', import.meta.url);

async function loadLogger(fakeSb) {
  const tmp = mkdtempSync(join(tmpdir(), 'era-genlog-'));
  globalThis.__eraGenLogFake = fakeSb;
  globalThis.__eraGenLogTmp = tmp;
  let src = readFileSync(SRC_URL, 'utf8');
  const before = src;
  src = src.replace(
    "import { getSupabase, isSupabaseReady } from '@/lib/supabase';",
    'const { getSupabase, isSupabaseReady } = globalThis.__eraGenLogFake;',
  );
  src = src.replace("const LOCAL_DIR = join(process.cwd(), 'data');", 'const LOCAL_DIR = globalThis.__eraGenLogTmp;');
  assert.notEqual(src, before, 'ต้องพบจุด stub ในซอร์สจริง');
  assert.match(src, /globalThis\.__eraGenLogTmp/, 'ต้องย้ายไฟล์ fallback ออกจาก repo');
  const mod = await importPatchedModule(src, SRC_URL, 'era-generation-logger');
  return { mod, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function fakeSupabase({ failWith = null } = {}) {
  const rows = [];
  const sb = {
    from() {
      return {
        select() {
          return {
            order() {
              return {
                async limit() {
                  await tick(); // ให้ 2 งานอ่านเลขล่าสุดก่อนกันจะ insert = ชนจริง
                  const ids = rows.map((r) => r.case_id).sort().reverse();
                  return { data: ids.length ? [{ case_id: ids[0] }] : [], error: null };
                },
              };
            },
          };
        },
        async insert(row) {
          await tick();
          if (failWith) return { error: failWith };
          if (rows.some((r) => r.case_id === row.case_id)) {
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          rows.push(row);
          return { error: null };
        },
      };
    },
  };
  return { rows, api: { getSupabase: () => sb, isSupabaseReady: () => true } };
}

const entry = (title) => ({ newsTitle: title, sourceType: 'plain_text', sourceText: 'ข่าวทดสอบ', versions: [{ content: 'เนื้อข่าว' }], userId: 'discord-test' });

test('เขียนพร้อมกัน 3 งาน: เลขเคสชน → จองใหม่ ทุกงานได้เลขไม่ซ้ำและตรงกับแถวที่บันทึก', async () => {
  const fake = fakeSupabase();
  const { mod, cleanup } = await loadLogger(fake.api);
  try {
    const results = await Promise.all([mod.logGeneration(entry('ก')), mod.logGeneration(entry('ข')), mod.logGeneration(entry('ค'))]);
    assert.ok(results.every((r) => r.success === true), JSON.stringify(results));
    const returned = results.map((r) => r.caseId).sort();
    const saved = fake.rows.map((r) => r.case_id).sort();
    assert.equal(new Set(returned).size, 3, `เลขเคสต้องไม่ซ้ำ: ${returned}`);
    assert.deepEqual(returned, saved, 'เลขที่คืนให้บอทต้องเป็นเลขที่บันทึกจริง');
  } finally { cleanup(); }
});

test('Supabase ล้มแบบไม่ใช่เลขชน บน Vercel: ไม่คืนเลขเคส (บอทจะไม่ลิงก์ไปเคสที่ไม่มีจริง)', async () => {
  const fake = fakeSupabase({ failWith: { code: '57014', message: 'statement timeout' } });
  const { mod, cleanup } = await loadLogger(fake.api);
  const prev = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    const r = await mod.logGeneration(entry('ง'));
    assert.equal(r.success, false);
    assert.equal(r.caseId, null);
  } finally {
    if (prev === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev;
    cleanup();
  }
});

test('บันทึกปกติ 1 งาน: พฤติกรรมเดิมยุค มิ.ย. (คืนเลขเคส success true)', async () => {
  const fake = fakeSupabase();
  const { mod, cleanup } = await loadLogger(fake.api);
  try {
    const r = await mod.logGeneration(entry('จ'));
    assert.deepEqual(r, { caseId: '00001', success: true });
    assert.equal(fake.rows[0].case_id, '00001');
  } finally { cleanup(); }
});

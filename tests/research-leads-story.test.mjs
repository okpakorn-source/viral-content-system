// ============================================================
// 🧪 Research Leads × Story Grouping (เฟส 5) — offline unit test
// Target: saveLeads() ใน researchLeads.js — รวมเรื่องเดียวหลาย URL + เก็บ storyKey (flag-gated)
// stub persistStore (globalThis.__STORES__) แบบเดียวกับ research-trace-discovery.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const _mod = (body) => 'data:text/javascript,' + encodeURIComponent(body);
const STUB_PERSIST = _mod(`
function reg(){ if(!globalThis.__STORES__) globalThis.__STORES__=new Map(); return globalThis.__STORES__; }
function arr(n){ const r=reg(); if(!r.has(n)) r.set(n,[]); return r.get(n); }
export function createStore(name){
  return {
    async getAll(){ return arr(name).slice(); },
    async add(it){ arr(name).push(it); return it; },
    async addMany(items){ const a=arr(name); for(const it of items) a.push(it); return items; },
    async remove(id){ const a=arr(name); const i=a.findIndex(r=>r&&r.id===id); if(i>=0) a.splice(i,1); },
  };
}`);
const hook = `
export async function resolve(spec, ctx, next){
  if(spec.endsWith('persistStore.js')) return { url:${JSON.stringify(STUB_PERSIST)}, shortCircuit:true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { saveLeads } = await import('../src/lib/services/deskV2/researchLeads.js');

function reset() { globalThis.__STORES__ = new Map(); }
function leads() { return globalThis.__STORES__.get('research-leads') || []; }

async function withStory(on, fn) {
  const M = 'DESK_V2_DISCOVERY_V2'; const S = 'DESK_V2_STORY_GROUPING';
  const sm = process.env[M]; const ss = process.env[S];
  if (on) { process.env[M] = '1'; process.env[S] = '1'; } else { delete process.env[M]; delete process.env[S]; }
  try { return await fn(); } finally {
    if (sm === undefined) delete process.env[M]; else process.env[M] = sm;
    if (ss === undefined) delete process.env[S]; else process.env[S] = ss;
  }
}

const cand = (url, names, action, extra = {}) => ({
  url, title: `ข่าว ${url}`, snippet: 's', channel: extra.channel || 'google', sourceHost: 'x.com',
  matchScore: 80, fingerprint: { names, action, timeHint: '', numbers: [] }, ...extra,
});

test('flag OFF → เรื่องเดียวกัน 2 URL = 2 ลีดแยก (พฤติกรรมเดิม, ไม่มี storyKey)', async () => {
  reset();
  await withStory(false, async () => {
    const r = await saveLeads([cand('https://a.com/1', ['ก้อย'], 'บริจาค'), cand('https://b.com/2', ['ก้อย'], 'บริจาค')], { runId: 'r1' });
    assert.equal(r.saved, 2);
    assert.equal(r.mergedIntoStory, undefined);
    assert.equal(leads()[0].storyKey, undefined); // ปิด flag = ไม่มี field storyKey
  });
});

test('flag ON → เรื่องเดียวกัน 2 URL = 1 ลีด + 1 altSource (mergedIntoStory=1)', async () => {
  reset();
  await withStory(true, async () => {
    const r = await saveLeads([
      cand('https://a.com/1', ['ก้อย'], 'บริจาค', { channel: 'google' }),
      cand('https://b.com/2', ['ก้อย'], 'บริจาค', { channel: 'facebook' }),
    ], { runId: 'r2' });
    assert.equal(r.saved, 1);
    assert.equal(r.mergedIntoStory, 1);
    const L = leads();
    assert.equal(L.length, 1);
    assert.equal(L[0].url, 'https://a.com/1'); // canonical = ใบแรก
    assert.equal(L[0].sourceCount, 2);
    assert.equal(L[0].altSources.length, 1);
    assert.equal(L[0].altSources[0].url, 'https://b.com/2');
    assert.ok(L[0].channels.includes('google') && L[0].channels.includes('facebook'));
    assert.ok(L[0].storyKey.includes('ก้อย'));
  });
});

test('flag ON → คนละเรื่อง (การกระทำต่าง) = 2 ลีดแยก', async () => {
  reset();
  await withStory(true, async () => {
    const r = await saveLeads([
      cand('https://a.com/1', ['เบสท์'], 'เปิดใจเรื่องพ่อ'),
      cand('https://b.com/2', ['เบสท์'], 'เปิดตัวแฟนใหม่'),
    ], { runId: 'r3' });
    assert.equal(r.saved, 2);
    assert.equal(r.mergedIntoStory, 0);
  });
});

test('flag ON → previouslyCovered tag เก็บในลีด', async () => {
  reset();
  await withStory(true, async () => {
    await saveLeads([cand('https://a.com/1', ['ตูน'], 'วิ่ง', { previouslyCovered: true, storyRelation: 'archive' })], { runId: 'r4' });
    const L = leads();
    assert.equal(L[0].previouslyCovered, true);
    assert.equal(L[0].storyRelation, 'archive');
  });
});

// ── เฟส 6.2: lead เลนสัมภาษณ์ (gated ด้วย lane==='interview' ตรงๆ ไม่ต้องเปิด flag) ──
test('เฟส 6: candidate เลนสัมภาษณ์ → lead เก็บ lane + interview (sanitized, ไม่เดาชื่อ)', async () => {
  reset();
  await withStory(false, async () => {
    await saveLeads([{
      url: 'https://yt.com/iv1', title: 'คลิปสัมภาษณ์', channel: 'youtube', sourceHost: 'yt.com', matchScore: 72,
      fingerprint: { names: ['แพท ณปภา'], action: 'เปิดใจ', timeHint: '', numbers: [] },
      lane: 'interview',
      interview: { expectedName: 'แพท ณปภา', observedName: null, nameStatus: 'expected', nameEvidence: null, program: 'แฉ', opener: 'เผย', angle: 'น้ำตา', queryId: 'people-0' },
    }], { runId: 'riv' });
    const L = leads();
    assert.equal(L[0].lane, 'interview');
    assert.equal(L[0].interview.expectedName, 'แพท ณปภา');
    assert.equal(L[0].interview.nameStatus, 'expected');
    assert.equal(L[0].interview.observedName, null); // 🔴 ไม่เดาว่าเป็นใคร
  });
});

test('เฟส 6: candidate ปกติ (ไม่มี lane) → lead ไม่มี field interview (เดิมเป๊ะ)', async () => {
  reset();
  await withStory(false, async () => {
    await saveLeads([cand('https://a.com/1', ['x'], 'y')], { runId: 'rn' });
    assert.equal(leads()[0].interview, undefined);
    assert.equal(leads()[0].lane, undefined);
  });
});

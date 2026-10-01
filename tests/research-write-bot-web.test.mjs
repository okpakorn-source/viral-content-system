// ============================================================
// 🧪 tests/research-write-bot-web.test.mjs — ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3 สัญญา 8.2 · เลน W2)
// ------------------------------------------------------------
// ฝั่งเว็บของ "ใบที่สอง" (ผลบรรณาธิการ) ที่บอทต้องพึ่ง — แก้แบบ additive ในไฟล์เดิม 3 จุด:
//   1) store.saveBotPosted เก็บ editorMsgId (src/lib/research-agent/store.js) — บอทจดไว้กันโพสต์ใบที่สองซ้ำหลังรีสตาร์ต
//      (route /api/bot/posted รับช่องนี้แล้ว — เทสใน tests/bot-research-card.test.mjs · ถ้า store ไม่เก็บ = route รับแล้วทิ้งเงียบ)
//   2) store.addFeedback({…, kind:'editor'}) — ลงช่อง research-cards.feedback เดิมติดป้าย kind:'editor'
//      แทนที่เฉพาะโหวตชนิดเดียวกัน (โหวตใบที่สองไม่ทับโหวตใบแรกของคนเดิม · เดิมทั้งคู่ใช้ cardId 'all' = ทับกัน)
//   3) route POST /api/research/feedback รับ kind 'editor' (ค่าอื่น = 400) · ไม่ส่ง kind = คำขอ/ที่เก็บ/คำตอบเดิมทุกไบต์
// Supabase = ตัวปลอมในหน่วยความจำ (tests/helpers/research-web-fakes.mjs) · ไม่ต่อเน็ต ไม่แตะ DB จริง ไม่เขียนไฟล์ใน repo
// mutation (ข้อท้าย): store ไม่เก็บ editorMsgId · ตัดซ้ำไม่ดูชนิดโหวต · ไม่ติดป้าย kind · route ไม่ส่ง kind ต่อ · route ไม่ตรวจ kind
// ============================================================
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentResultOut1, createFakeSupabase, importSource, installResearchHooks, replaceOnce, ROOT, srcUrl,
} from './helpers/research-web-fakes.mjs';

installResearchHooks({
  stubs: {
    '@/lib/supabase': 'export const isSupabaseReady = () => globalThis.__RA_SB_READY !== false; export const getSupabase = () => globalThis.__RA_SB;',
  },
});

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const STORE_SOURCE = read('src/lib/research-agent/store.js');
const FEEDBACK_SOURCE = read('src/app/api/research/feedback/route.js');
const store = await import(srcUrl('lib/research-agent/store.js'));
const feedbackRoute = await import(srcUrl('app/api/research/feedback/route.js'));

const BOT_KEY = 'bot-K3Y-w2-0001';
const T0 = Date.parse('2026-10-01T06:00:00.000Z');

function newStorage(mod = store) {
  const sb = createFakeSupabase();
  let t = T0;
  return { sb, storage: mod.createResearchStorage({ sb, now: () => (t += 1000) }) };
}

// ใบขอ → lease → report (ผลจริงของเอเจนต์ แล็บ out) = มีแถว research-cards ให้โหวต
async function seedCards(storage, jobId) {
  await storage.createRequest({ jobId, rawText: 'ข่าวดิบ', sourceUrls: [] });
  await storage.leaseNext({ workerId: 'w1' });
  const res = await storage.report({ jobId, workerId: 'w1', result: agentResultOut1(), mode: 'write' });
  assert.equal(res.outcome, 'stored', 'ต้องมีแถวการ์ดก่อนโหวต');
}

const shape = (list) => list.map((f) => [f.userId, f.cardId, f.vote, f.kind ?? null]);

// ── 1) bot-posted.editorMsgId ─────────────────────────────────────
async function assertEditorMsgId(mod) {
  const { sb, storage } = newStorage(mod);
  await storage.saveBotPosted({ jobId: 'q_e', channelId: '111', sourceMessageId: '222', researchCardMsgId: '555' });
  await storage.saveBotPosted({ jobId: 'q_e', editorMsgId: '777' });
  let doc = sb.doc('bposted_q_e');
  assert.equal(doc.editorMsgId, '777', 'store ต้องเก็บ editorMsgId (บอทใช้กันโพสต์ใบที่สองซ้ำหลังรีสตาร์ต)');
  assert.deepEqual([doc.channelId, doc.sourceMessageId, doc.researchCardMsgId], ['111', '222', '555'], 'ช่องเดิมคงค่า');
  await storage.saveBotPosted({ jobId: 'q_e', editorMsgId: 'bad id!' });
  doc = sb.doc('bposted_q_e');
  assert.equal(doc.editorMsgId, '777', 'id ผิดรูป = ทิ้งเงียบ คงค่าเดิม (กติกาเดียวกับช่อง id อื่น)');
  assert.equal(doc.revision, 3);
  await storage.saveBotPosted({ jobId: 'q_plain', channelId: '1', processingMsgId: '2' });
  assert.equal('editorMsgId' in sb.doc('bposted_q_plain'), false, 'ไม่ส่ง editorMsgId = แถวไม่มีคีย์งอก (รูปเดิม)');
}

test('store.saveBotPosted (W2 · สัญญา 8.2): เก็บ editorMsgId + รวมกับแถวเดิม (ช่องเดิมคงค่า) · id ผิดรูปทิ้งเงียบ · ไม่ส่ง = รูปเดิม', () => assertEditorMsgId(store));

// ── 2) feedback ติดป้าย kind:'editor' ────────────────────────────
async function assertEditorFeedback(mod) {
  const { sb, storage } = newStorage(mod);
  await seedCards(storage, 'q_fb');
  await storage.addFeedback({ jobId: 'q_fb', cardId: 'all', vote: 'up', userId: 'discord-1' });
  await storage.addFeedback({ jobId: 'q_fb', cardId: 'all', vote: 'down', userId: 'discord-1', kind: 'editor' });
  assert.deepEqual(shape(sb.doc('rcard_q_fb').feedback), [
    ['discord-1', 'all', 'up', null],
    ['discord-1', 'all', 'down', 'editor'],
  ], 'โหวตใบที่สองลงช่อง feedback เดิมติด kind:editor และไม่ทับโหวตใบแรกของคนเดิม');
  await storage.addFeedback({ jobId: 'q_fb', cardId: 'all', vote: 'up', userId: 'discord-1', kind: 'editor' });
  await storage.addFeedback({ jobId: 'q_fb', cardId: 'all', vote: 'down', userId: 'discord-1' });
  const feedback = sb.doc('rcard_q_fb').feedback;
  assert.deepEqual(shape(feedback), [
    ['discord-1', 'all', 'up', 'editor'],
    ['discord-1', 'all', 'down', null],
  ], 'เปลี่ยนใจ = แทนที่เฉพาะโหวตชนิดเดียวกัน');
  for (const f of feedback.filter((x) => x.kind !== 'editor')) {
    assert.deepEqual(Object.keys(f).sort(), ['at', 'cardId', 'userId', 'vote'], 'โหวตใบแรกรูปเดิมทุกช่อง (ไม่มีคีย์ kind)');
  }
}

test('store.addFeedback (W2 · สัญญา 8.2): kind "editor" = ช่อง feedback เดิมติดป้าย · ไม่ทับโหวตใบแรก · เปลี่ยนใจแทนที่เฉพาะชนิดเดียวกัน · ใบแรกรูปเดิม', () => assertEditorFeedback(store));

// ── 3) route POST /api/research/feedback ─────────────────────────
async function withBotEnv(fn) {
  const saved = process.env.DISCORD_API_SECRET;
  process.env.DISCORD_API_SECRET = BOT_KEY;
  const sb = createFakeSupabase();
  globalThis.__RA_SB = sb;
  globalThis.__RA_SB_READY = true;
  try {
    return await fn(sb);
  } finally {
    if (saved === undefined) delete process.env.DISCORD_API_SECRET;
    else process.env.DISCORD_API_SECRET = saved;
  }
}

async function assertFeedbackRoute(route) {
  await withBotEnv(async (sb) => {
    await seedCards(store.createResearchStorage({ sb }), 'q_rt');
    const send = async (body) => {
      const res = await route.POST(new Request('http://localhost/api/research/feedback', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': BOT_KEY }, body: JSON.stringify(body),
      }));
      return { status: res.status, body: await res.json() };
    };
    const card = await send({ jobId: 'q_rt', cardId: 'all', vote: 'up', userId: 'discord-1' });
    assert.equal(card.status, 200);
    assert.deepEqual(Object.keys(card.body).sort(), ['cardId', 'jobId', 'revision', 'success', 'vote', 'votes'], 'ไม่ส่ง kind = คำตอบรูปเดิม');
    assert.deepEqual(card.body.votes, { up: 1, down: 0 });
    const editor = await send({ jobId: 'q_rt', cardId: 'all', vote: 'down', userId: 'discord-1', kind: 'editor' });
    assert.equal(editor.status, 200, JSON.stringify(editor.body));
    assert.equal(editor.body.kind, 'editor');
    assert.deepEqual(editor.body.votes, { up: 0, down: 1 }, 'นับเฉพาะโหวตใบที่สอง');
    const card2 = await send({ jobId: 'q_rt', cardId: 'all', vote: 'up', userId: 'discord-2' });
    assert.deepEqual(card2.body.votes, { up: 2, down: 0 }, 'โหวตใบแรกไม่ถูกโหวตใบที่สองทับ/ปน');
    for (const kind of ['card', 'EDITOR', '', 1, null]) {
      const bad = await send({ jobId: 'q_rt', cardId: 'all', vote: 'up', userId: 'discord-3', kind });
      assert.equal(bad.status, 400, `kind ${JSON.stringify(kind)} ต้องไม่ผ่าน`);
      assert.equal(bad.body.errorType, 'VALIDATION_ERROR');
    }
    assert.deepEqual(shape(sb.doc('rcard_q_rt').feedback), [
      ['discord-1', 'all', 'up', null],
      ['discord-1', 'all', 'down', 'editor'],
      ['discord-2', 'all', 'up', null],
    ]);
  });
}

test('route /api/research/feedback (W2): kind "editor" → ช่อง feedback เดิมติดป้าย + นับแยก · kind อื่น = 400 · ไม่ส่ง kind = คำตอบ/ที่เก็บเดิม', () => assertFeedbackRoute(feedbackRoute));

// ── mutation (ต้องแดงจริง · ของจริงเขียวกับข้อสอบชุดเดียวกัน) ──────────
test('mutation (W2): ทุบจุดที่เพิ่มแล้วข้อสอบต้องแดง — store ×3 · route ×2', async () => {
  const storeMutations = [
    ['store ไม่เก็บ editorMsgId',
      "for (const key of ['channelId', 'sourceMessageId', 'processingMsgId', 'researchCardMsgId', 'editorMsgId']) {",
      "for (const key of ['channelId', 'sourceMessageId', 'processingMsgId', 'researchCardMsgId']) {", assertEditorMsgId],
    ['ตัดซ้ำไม่ดูชนิดโหวต (ใบที่สองทับใบแรก)',
      ".filter((f) => !(f.userId === userId && f.cardId === cardId && (f.kind === 'editor') === editorVote));",
      '.filter((f) => !(f.userId === userId && f.cardId === cardId));', assertEditorFeedback],
    ['ไม่ติดป้าย kind ตอนเก็บ',
      "feedback.push(editorVote ? { userId, cardId, vote, at, kind: 'editor' } : { userId, cardId, vote, at });",
      'feedback.push({ userId, cardId, vote, at });', assertEditorFeedback],
  ];
  for (const [index, [label, search, replacement, check]] of storeMutations.entries()) {
    const mutated = await importSource(replaceOnce(STORE_SOURCE, search, replacement, label), `w2-store-mut-${index}`);
    await assert.rejects(Promise.resolve().then(() => check(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  const routeMutations = [
    ['route ไม่ส่ง kind ต่อให้ store',
      "const result = await storage.addFeedback({ jobId, cardId, vote, userId, ...(kind === 'editor' ? { kind } : {}) });",
      'const result = await storage.addFeedback({ jobId, cardId, vote, userId });'],
    ['route ไม่ตรวจค่า kind',
      "if (kind !== undefined && kind !== 'editor') return jsonFail(400, \"kind ต้องเป็น 'editor' หรือไม่ส่ง\", 'VALIDATION_ERROR'); // ★ W2",
      ''],
  ];
  for (const [index, [label, search, replacement]] of routeMutations.entries()) {
    const mutated = await importSource(replaceOnce(FEEDBACK_SOURCE, search, replacement, label), `w2-feedback-mut-${index}`);
    await assert.rejects(Promise.resolve().then(() => assertFeedbackRoute(mutated)), `${label}: ข้อสอบต้องแดง`);
  }
  await assertEditorMsgId(store);
  await assertEditorFeedback(store);
  await assertFeedbackRoute(feedbackRoute);
});
